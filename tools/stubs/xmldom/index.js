'use strict';
// Local stub for @xmldom/xmldom, so kdbxweb's Node-only XML fallback never
// enters the browser bundle. See docs/living-spec.md D-007.
const message =
  'xmldom is deliberately stubbed out (living-spec D-007): this app requires a ' +
  'native DOMParser/XMLSerializer. Reaching this code means kdbxweb ran outside ' +
  'a browser context.';
const unavailable = function () {
  throw new Error(message);
};
module.exports = {
  DOMParser: unavailable,
  XMLSerializer: unavailable,
  DOMImplementation: unavailable,
};
