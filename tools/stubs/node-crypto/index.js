'use strict';
// Local stub for Node's `crypto`, so kdbxweb's Node fallbacks never enter the
// browser bundle. See docs/living-spec.md D-007.
const message =
  "Node's crypto module is deliberately stubbed out (living-spec D-007): this app " +
  'uses WebCrypto only. Reaching this code means globalThis.crypto.subtle was ' +
  'unavailable, and falling back silently is not acceptable in a password manager.';
const unavailable = () => {
  throw new Error(message);
};
module.exports = {
  createHash: unavailable,
  createHmac: unavailable,
  createCipheriv: unavailable,
  createDecipheriv: unavailable,
  randomBytes: unavailable,
};
