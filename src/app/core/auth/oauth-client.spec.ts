import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OAuthClient, OAuthError, type OAuthProviderConfig } from './oauth-client';

const CONFIG: OAuthProviderConfig = {
  id: 'test',
  displayName: 'Test Provider',
  authorizeUrl: 'https://example.test/authorize',
  tokenUrl: 'https://example.test/token',
  clientId: 'client-123',
  scopes: ['files.read', 'files.write'],
  redirectUri: 'http://localhost:4200/auth/callback',
};

/** Pull the state parameter back out of a generated authorize URL. */
function stateOf(url: string): string {
  return new URL(url).searchParams.get('state') ?? '';
}

describe('OAuthClient authorization request', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('refuses to start when no client ID is configured', async () => {
    const client = new OAuthClient({ ...CONFIG, clientId: '' });

    expect(client.isConfigured).toBe(false);
    await expect(client.beginAuthorization()).rejects.toThrow(OAuthError);
  });

  it('builds an authorize URL carrying an S256 challenge and no secret', async () => {
    const client = new OAuthClient(CONFIG);

    const url = new URL(await client.beginAuthorization());

    expect(url.origin + url.pathname).toBe('https://example.test/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9\-_]{43}$/);
    expect(url.searchParams.get('scope')).toBe('files.read files.write');

    // A browser client has no secret to send, and sending the verifier here
    // would defeat PKCE entirely.
    expect(url.searchParams.get('client_secret')).toBeNull();
    expect(url.searchParams.get('code_verifier')).toBeNull();
  });

  it('keeps the verifier out of the URL but available for the exchange', async () => {
    const client = new OAuthClient(CONFIG);
    const url = await client.beginAuthorization();

    const stored = JSON.parse(sessionStorage.getItem('sar-vault.oauth.pending') ?? '{}') as {
      verifier?: string;
    };

    expect(stored.verifier).toBeTruthy();
    expect(url).not.toContain(stored.verifier ?? 'unreachable');
  });
});

describe('OAuthClient token exchange', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okToken = (expiresIn = 3600) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ access_token: 'token-abc', expires_in: expiresIn }),
    } as Response);

  it('exchanges a code and reports connected', async () => {
    const client = new OAuthClient(CONFIG);
    const state = stateOf(await client.beginAuthorization());
    fetchMock.mockReturnValue(okToken());

    await client.completeAuthorization('auth-code', state);

    expect(client.isConnected()).toBe(true);
    expect(client.getToken()).toBe('token-abc');

    // The verifier must be sent on the exchange — that is the half of PKCE that
    // proves this app started the flow.
    const body = String((fetchMock.mock.calls[0]?.[1] as RequestInit).body);
    expect(body).toContain('code_verifier=');
    expect(body).toContain('grant_type=authorization_code');
    expect(body).not.toContain('client_secret');
  });

  /*
   * Without this check an attacker can hand the app a code issued under *their*
   * account. The flow would succeed, and the user would quietly begin saving
   * their vault into the attacker's storage.
   */
  it('rejects a callback whose state does not match', async () => {
    const client = new OAuthClient(CONFIG);
    await client.beginAuthorization();
    fetchMock.mockReturnValue(okToken());

    await expect(client.completeAuthorization('auth-code', 'not-the-state')).rejects.toThrow(
      /state mismatch/i,
    );
    expect(client.isConnected()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a callback for a different provider', async () => {
    const client = new OAuthClient(CONFIG);
    const state = stateOf(await client.beginAuthorization());
    const other = new OAuthClient({ ...CONFIG, id: 'other' });

    await expect(other.completeAuthorization('auth-code', state)).rejects.toThrow(
      /different provider/i,
    );
  });

  it('rejects a callback when no authorization is pending', async () => {
    const client = new OAuthClient(CONFIG);

    await expect(client.completeAuthorization('code', 'state')).rejects.toThrow(
      /No authorization is in progress/,
    );
  });

  it('consumes the pending state so a code cannot be replayed', async () => {
    const client = new OAuthClient(CONFIG);
    const state = stateOf(await client.beginAuthorization());
    fetchMock.mockReturnValue(okToken());

    await client.completeAuthorization('auth-code', state);

    expect(sessionStorage.getItem('sar-vault.oauth.pending')).toBeNull();
    await expect(client.completeAuthorization('auth-code', state)).rejects.toThrow(
      /No authorization is in progress/,
    );
  });

  it('surfaces a provider rejection instead of silently staying disconnected', async () => {
    const client = new OAuthClient(CONFIG);
    const state = stateOf(await client.beginAuthorization());
    fetchMock.mockResolvedValue({ ok: false, status: 400 } as Response);

    await expect(client.completeAuthorization('bad-code', state)).rejects.toThrow(/\(400\)/);
    expect(client.isConnected()).toBe(false);
  });

  it('treats a nearly-expired token as not connected', async () => {
    const client = new OAuthClient(CONFIG);
    const state = stateOf(await client.beginAuthorization());
    // 10s of life left: inside the 30s safety margin, so requests would fail
    // mid-flight if we called this connected.
    fetchMock.mockReturnValue(okToken(10));

    await client.completeAuthorization('auth-code', state);

    expect(client.isConnected()).toBe(false);
    expect(client.getToken()).toBeUndefined();
  });

  it('forgets the token on disconnect', async () => {
    const client = new OAuthClient(CONFIG);
    const state = stateOf(await client.beginAuthorization());
    fetchMock.mockReturnValue(okToken());
    await client.completeAuthorization('auth-code', state);

    client.disconnect();

    expect(client.isConnected()).toBe(false);
    expect(client.getToken()).toBeUndefined();
  });
});
