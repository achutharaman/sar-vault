import { createPkcePair, createState } from './pkce';

/** Static description of a provider's OAuth endpoints. */
export interface OAuthProviderConfig {
  readonly id: string;
  readonly displayName: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly redirectUri: string;
  /** Extra parameters the provider requires on the authorize request. */
  readonly extraAuthParams?: Readonly<Record<string, string>>;
}

export interface AccessToken {
  readonly value: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export class OAuthError extends Error {
  override readonly name = 'OAuthError';
}

/** The in-flight state of a redirect, held only until the callback returns. */
interface PendingAuthorization {
  readonly providerId: string;
  readonly verifier: string;
  readonly state: string;
}

/**
 * Where the PKCE verifier lives between the redirect out and the redirect back.
 *
 * `sessionStorage` is unavoidable here: the page is destroyed by the redirect,
 * so an in-memory value cannot survive. It is scoped to the tab, cleared the
 * moment the callback is handled, and holds no access token — only a
 * single-use verifier that is worthless without the matching authorization
 * code.
 */
const PENDING_KEY = 'sar-vault.oauth.pending';

/**
 * OAuth 2.0 authorization-code flow with PKCE, with no backend.
 *
 * ## Token storage (living-spec Q-005)
 *
 * Access tokens are held **in memory only**. They are gone when the tab closes,
 * which means reconnecting each session. That is a deliberate trade: persisting
 * a token to `localStorage` would leave a credential for the user's cloud
 * storage sitting on disk, readable by any XSS — and SECURITY.md is already
 * explicit that an XSS in this origin is a total compromise. Adding a durable
 * token would widen what that compromise yields.
 *
 * Refresh tokens are not requested. Google does not issue them to public
 * browser clients without a client secret, and storing one would defeat the
 * point of keeping tokens ephemeral.
 */
export class OAuthClient {
  private token: AccessToken | undefined;

  constructor(private readonly config: OAuthProviderConfig) {}

  get isConfigured(): boolean {
    return this.config.clientId.length > 0;
  }

  get displayName(): string {
    return this.config.displayName;
  }

  /** True when a usable, unexpired token is held. */
  isConnected(now = Date.now()): boolean {
    // 30s of slack, so a token does not expire mid-request.
    return this.token !== undefined && this.token.expiresAt > now + 30_000;
  }

  /** Discard the held token. Does not revoke it at the provider. */
  disconnect(): void {
    this.token = undefined;
  }

  getToken(): string | undefined {
    return this.isConnected() ? this.token?.value : undefined;
  }

  /** Build the authorization URL and record the pending PKCE state. */
  async beginAuthorization(): Promise<string> {
    if (!this.isConfigured) {
      throw new OAuthError(`${this.config.displayName} has no client ID configured.`);
    }

    const pkce = await createPkcePair();
    const state = createState();

    const pending: PendingAuthorization = {
      providerId: this.config.id,
      verifier: pkce.verifier,
      state,
    };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      code_challenge: pkce.challenge,
      code_challenge_method: pkce.method,
      state,
      ...this.config.extraAuthParams,
    });

    return `${this.config.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Redeem an authorization code for an access token.
   *
   * The `state` check is not optional: without it, an attacker can feed the app
   * a code obtained under their own account, and the user would silently end up
   * writing their vault into the attacker's storage.
   */
  async completeAuthorization(code: string, state: string): Promise<void> {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);

    if (!raw) {
      throw new OAuthError('No authorization is in progress.');
    }

    let pending: PendingAuthorization;
    try {
      pending = JSON.parse(raw) as PendingAuthorization;
    } catch {
      throw new OAuthError('The stored authorization state is unreadable.');
    }

    if (pending.providerId !== this.config.id) {
      throw new OAuthError('This callback belongs to a different provider.');
    }
    if (pending.state !== state) {
      throw new OAuthError('Authorization state mismatch — the callback was not trusted.');
    }

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
        code,
        code_verifier: pending.verifier,
      }).toString(),
    });

    if (!response.ok) {
      throw new OAuthError(
        `${this.config.displayName} rejected the token request (${response.status}).`,
      );
    }

    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!payload.access_token) {
      throw new OAuthError(`${this.config.displayName} returned no access token.`);
    }

    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    };
  }

  /** Which provider a pending callback belongs to, if any. */
  static pendingProviderId(): string | undefined {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) {
      return undefined;
    }
    try {
      return (JSON.parse(raw) as PendingAuthorization).providerId;
    } catch {
      return undefined;
    }
  }

  static clearPending(): void {
    sessionStorage.removeItem(PENDING_KEY);
  }
}
