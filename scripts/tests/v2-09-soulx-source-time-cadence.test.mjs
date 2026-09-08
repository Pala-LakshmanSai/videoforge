import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const read = (path) => readFileSync(resolve(root, path), "utf8");
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("0092 derives SoulX cadence from canonical source time rather than 30 fps timeline frames", () => {
  const migration = read(
    "packages/control-plane/migrations/0092_hosted_v209_soulx_source_time_cadence.sql",
  );
  assert.match(migration, /effective_selected_start:=\(span_row\.selected_start_ms\/40\)\*40/u);
  assert.match(
    migration,
    /effective_selected_end:=\(\(span_row\.selected_end_ms_exclusive\+39\)\/40\)\*40/u,
  );
  assert.doesNotMatch(migration, /effective_selected_start:=span_row\.start_frame\*40/u);
  assert.doesNotMatch(migration, /effective_selected_end:=span_row\.end_frame_exclusive\*40/u);
  assert.match(
    migration,
    /span_row\.selected_end_ms_exclusive\+39[\s\S]*span_row\.selected_start_ms\/40/u,
  );
  assert.doesNotMatch(
    migration,
    /<>\(task_row\.end_frame_exclusive-task_row\.start_frame\)\*1920/u,
  );
  assert.match(
    migration,
    /a\.task_key=task_row\.required_slots->'avatar'->>'span_audio_task_key'/u,
  );
  assert.doesNotMatch(migration, /a\.task_key=task_row\.task_key/u);
});

test("0092 is the sole manifest successor and preserves both runtime function signatures", () => {
  const manifest = JSON.parse(read("packages/control-plane/migrations/manifest.json"));
  const entry = manifest.migrations.find(({ version }) => version === 92);
  assert.ok(entry);
  assert.deepEqual(
    [entry.version, entry.filename],
    [92, "0092_hosted_v209_soulx_source_time_cadence.sql"],
  );
  assert.equal(
    entry.sha256,
    digest(
      readFileSync(
        resolve(
          root,
          "packages/control-plane/migrations/0092_hosted_v209_soulx_source_time_cadence.sql",
        ),
      ),
    ),
  );
  const migration = read(
    "packages/control-plane/migrations/0092_hosted_v209_soulx_source_time_cadence.sql",
  );
  assert.equal(
    (
      migration.match(/CREATE OR REPLACE FUNCTION public\.videoforge_materialize_hosted_v209_/gu) ||
      []
    ).length,
    2,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.videoforge_materialize_hosted_v209_ordinary_dispatch/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.videoforge_materialize_hosted_v209_span_audio_jobs/u,
  );
});
