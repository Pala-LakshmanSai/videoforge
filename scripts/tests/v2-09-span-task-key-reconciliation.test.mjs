import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("../..", import.meta.url).pathname);
const read = (path) => readFileSync(resolve(root, path), "utf8");
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("0091 preserves visual task identity and resolves span audio through its required slot key", () => {
  const migration = read(
    "packages/control-plane/migrations/0091_hosted_v209_span_task_key_reconciliation.sql",
  );
  assert.match(migration, /task\.task_key=segment\.required_slots->'avatar'->>'task_key'/u);
  assert.match(migration, /s\.task_key=segment\.required_slots->'avatar'->>'span_audio_task_key'/u);
  assert.match(
    migration,
    /segment\.timeline_composition IN \('AVATAR_FULL','AVATAR_SPLIT_IMAGE'\)/u,
  );
  assert.match(migration, /jsonb_typeof\(segment\.required_slots->'avatar'\)='object'/u);
  assert.match(
    migration,
    /nullif\(segment\.required_slots->'avatar'->>'task_key',''\) IS NOT NULL/u,
  );
  assert.match(
    migration,
    /nullif\(segment\.required_slots->'avatar'->>'span_audio_task_key',''\) IS NOT NULL/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.videoforge_materialize_hosted_v209_span_audio_jobs\(uuid,uuid,uuid,uuid\) FROM PUBLIC/u,
  );
  assert.doesNotMatch(migration, /materialize_hosted_v209_ordinary_dispatch/u);
  assert.doesNotMatch(migration, /task\.task_key=s\.task_key/u);
});

test("0091 remains the exact ledger entry and keeps the existing runtime grant signature", () => {
  const manifest = JSON.parse(read("packages/control-plane/migrations/manifest.json"));
  const entry = manifest.migrations.find(({ version }) => version === 91);
  assert.equal(entry?.filename, "0091_hosted_v209_span_task_key_reconciliation.sql");
  assert.equal(
    entry.sha256,
    digest(
      readFileSync(
        resolve(
          root,
          "packages/control-plane/migrations/0091_hosted_v209_span_task_key_reconciliation.sql",
        ),
      ),
    ),
  );
  const grants = read("deploy/v2-09/neon-v209-runtime-grants.sql");
  const signature = "videoforge_materialize_hosted_v209_span_audio_jobs(uuid,uuid,uuid,uuid)";
  assert.equal(grants.includes(signature), true);
});
