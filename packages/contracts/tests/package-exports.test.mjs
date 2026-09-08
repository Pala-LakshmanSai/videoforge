import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("the package root resolves for CommonJS-powered TypeScript loaders", () => {
  const require = createRequire(import.meta.url);
  const expected = fileURLToPath(new URL("../dist/src/index.js", import.meta.url));

  assert.equal(require.resolve("@videoforge/contracts"), expected);
});
