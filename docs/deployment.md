# Deployment

The app is static files. There is no server-side code, so "deploying" is copying
`dist/sar-vault/browser/` to a host and configuring two things the files cannot
configure themselves: **SPA fallback routing** and **response headers**.

Both matter more than usual here:

- The app has client-side routes (`/settings`) and an OAuth redirect URI at
  `/auth/callback`. Without a fallback rule a static host returns 404 for both:
  a bookmarked or reloaded settings page breaks, and the authorization code is
  never redeemed, so cloud storage simply cannot be connected.
- `frame-ancestors` is the one CSP directive a `<meta>` tag cannot express, so
  it has to come from a real header or the app is clickjackable. The rest of the
  policy lives in `index.html` deliberately, so `ng serve` and production
  enforce the same rules.

`npm run verify:bundle` fails the build if either file is missing from the
output, and CI runs it after every build.

---

## Cloudflare Pages (or Netlify)

Nothing to do. `public/_redirects` and `public/_headers` are copied to the
output root and are read natively.

```
Build command:      npm run build
Build output:       dist/sar-vault/browser
Node version:       from .nvmrc
```

Set the OAuth client IDs as build-time environment variables
(`NG_APP_GOOGLE_CLIENT_ID`, `NG_APP_MICROSOFT_CLIENT_ID`,
`NG_APP_OAUTH_REDIRECT_URI`) — `scripts/generate-env.mjs` reads `process.env`
before falling back to a local `.env`, so no file needs to exist on the builder.

---

## S3 + CloudFront

CloudFront ignores `_redirects` and `_headers`; the same two things must be
configured on the distribution.

**SPA fallback.** A custom error response, *not* the "default root object"
setting, which only applies to `/`:

| Setting | Value |
| --- | --- |
| HTTP error code | 403 (S3 returns 403, not 404, for missing keys on a private bucket) |
| Response page path | `/index.html` |
| HTTP response code | 200 |

Add the same for 404 if the bucket is configured as a website endpoint.

**Headers.** Attach a *response headers policy* to the default behaviour with
the values from `public/_headers`. The security ones:

```
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

**Caching.** `index.html` must be `no-cache, must-revalidate` — it names the
hashed bundles, so a stale copy pins users to an old build, including one with a
known vulnerability. Hashed `.js`/`.css` can be `immutable` for a year.

---

## Registering the OAuth apps

Neither provider is usable until an app is registered and its client ID is
built in. Both are public clients using PKCE — **there is no client secret**, and
if a provider's console insists on issuing one, the wrong application type has
been selected.

### Google

1. Google Cloud console → APIs & Services → Credentials → OAuth client ID.
2. Application type: **Web application**.
3. Authorised redirect URI: the exact deployed URL, e.g.
   `https://vault.example.com/auth/callback`. It must match byte for byte,
   trailing slash included.
4. Enable the Google Drive API for the project.
5. Scope used: `drive.file` — see living-spec Q-008/D-019 for why not
   `drive.appdata`.

### Microsoft

1. Entra ID (Azure AD) → App registrations → New registration.
2. Redirect URI platform: **Single-page application (SPA)** — *not* "Web".

   This is the most common way this flow fails. Registered as "Web", Microsoft's
   token endpoint refuses the browser's cross-origin request and expects a
   client secret, which a browser app cannot hold. The error surfaces as an
   opaque CORS or `invalid_client` failure with nothing pointing at the cause.
3. Scopes: `Files.ReadWrite.AppFolder`, `offline_access`.

---

## Not yet done

Reproducible builds and published bundle hashes are the meaningful mitigation
for the hosted-app problem described in SECURITY.md, and are **not implemented**
(living-spec Q-010). Until they are, a user who needs to eliminate that risk
should self-host from a build they verified, or use a native client.
