import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../deploy/v2-09/neon-v209-runtime-grants.sql", import.meta.url),
  "utf8",
);

test("V2-09 runtime grants rebuild a closed pre-V2-10 function allowlist", () => {
  assert.match(source, /REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public/u);
  assert.match(source, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC/u);
  assert.match(source, /v209_runtime_function_allowlist/u);
  assert.match(source, /procedure\.oid::regprocedure::text NOT IN/u);
  for (const required of [
    "videoforge_materialize_hosted_v209_ordinary_dispatch",
    "videoforge_commit_hosted_v209_ordinary_pair",
    "videoforge_begin_hosted_v209_ordinary_send",
    "videoforge_materialize_hosted_v209_span_audio_jobs",
    "videoforge_materialize_hosted_v209_system_avatar_reference",
  ])
    assert.match(source, new RegExp(required, "u"));
  assert.doesNotMatch(source, /videoforge_[A-Za-z0-9_]*v21[0-3]/u);
  assert.doesNotMatch(source, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON/u);
});

test("V2-09 runtime grant failure paths exit nonzero", () => {
  assert.doesNotMatch(source, /^\\quit\s*$/gmu);
  assert.equal(source.match(/^\\quit 1$/gmu)?.length, 3);
  assert.equal(source.match(/^ROLLBACK;\n\\quit 1$/gmu)?.length, 2);
});
