import test from "node:test";
import assert from "node:assert/strict";
import { buildViewerSecurityHeaders, resolveViewerFrameAncestors } from "../src/viewer-security.mjs";

test("viewer allows only trusted main-site frame ancestors by default", () => {
  const ancestors = resolveViewerFrameAncestors("");
  assert.deepEqual(ancestors, ["'self'", "https://topratedseotools.com", "https://www.topratedseotools.com"]);
  const headers = buildViewerSecurityHeaders("nonce-value", "");
  assert.match(headers["content-security-policy"], /frame-ancestors 'self' https:\/\/topratedseotools\.com https:\/\/www\.topratedseotools\.com/);
  assert.equal(headers["cross-origin-resource-policy"], "cross-origin");
  assert.equal("x-frame-options" in headers, false);
});

test("viewer rejects unsafe frame ancestor configuration", () => {
  assert.throws(() => resolveViewerFrameAncestors("https://topratedseotools.com/path"));
  assert.throws(() => resolveViewerFrameAncestors("http://topratedseotools.com"));
  assert.throws(() => resolveViewerFrameAncestors("https://user:pass@topratedseotools.com"));
});
