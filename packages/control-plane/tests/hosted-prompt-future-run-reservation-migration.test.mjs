import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = new URL("../migrations/0204_hosted_prompt_future_run_reservation_cap.sql", import.meta.url);
const bytes = readFileSync(migration);
const sql = bytes.toString("utf8");

test("0204 bounds new prompt runs at USD 8 and retains existing run reservations", () => {
  assert.match(sql, /least\(8000000::numeric,planned_batch_count::numeric\*250000::numeric\)/u);
  assert.match(sql, /requested_reserved IS DISTINCT FROM existing\.reserved_cost_micro_usd/u);
  assert.match(sql, /reserved_cost_micro_usd BETWEEN 250000 AND 8000000/u);
  assert.match(sql, /profile_revision:=7;\s*profile_rate:=8000000/u);
  assert.match(sql, /profile_rate:=CASE WHEN profile_revision=7 THEN 8000000 ELSE 2000000 END/u);
  assert.doesNotMatch(sql, /^UPDATE public\.hosted_prompt_runs/gmu);
});

test("0204 immutable migration hash matches manifest", () => {
  const manifest = JSON.parse(readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"));
  const entry = manifest.migrations.find((item) => item.version === 204);
  assert.deepEqual([entry?.name, entry?.filename], [
    "hosted_prompt_future_run_reservation_cap",
    "0204_hosted_prompt_future_run_reservation_cap.sql",
  ]);
  assert.equal(entry.sha256, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
});
