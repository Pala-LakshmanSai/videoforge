import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL(
  "../migrations/0191_hosted_api_kie_prompt_limit.sql",
  import.meta.url,
);

test("0191 tightens only the immutable Kie prompt bind limit to 800 characters", () => {
  const sql = readFileSync(migrationUrl, "utf8");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.videoforge_bind_hosted_api_image_prompt/u);
  assert.match(sql, /length\(supplied_prompt\) NOT BETWEEN 1 AND 800/u);
  assert.match(sql, /API image prompt replay drift/u);
  assert.doesNotMatch(sql, /GRANT EXECUTE|REVOKE ALL/u);
});

test("0191 is manifest tail and digest matches migration contents", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"),
  );
  const tail = manifest.migrations.at(-1);
  assert.equal(tail.version, 191);
  assert.equal(tail.name, "hosted_api_kie_prompt_limit");
  assert.equal(tail.filename, "0191_hosted_api_kie_prompt_limit.sql");
  const digest = `sha256:${createHash("sha256").update(readFileSync(migrationUrl)).digest("hex")}`;
  assert.equal(tail.sha256, digest);
});
