import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * 0187 exists because 0177 re-binds the prompt run row on redispatch but leaves the superseded
 * `prompt:scene-batch:<n>` generation_task at required=true/FAILED, and the V2-09 dispatch
 * admission refuses any revision with a required scene-batch task that is not COMPLETE. One
 * dispatch timeout then poisons every later generation attempt of that revision. This guard keeps
 * the demotion, its ordering, and the manifest binding from regressing.
 */
const migrationUrl = new URL(
  "../migrations/0187_hosted_prompt_redispatch_supersedes_scene_batch_tasks.sql",
  import.meta.url,
);

test("0187 demotes the superseded scene-batch task before inserting the redispatch task", () => {
  const migration = readFileSync(migrationUrl, "utf8");
  const insertAt = migration.indexOf("INSERT INTO public.generation_tasks");
  const demotionAt = migration.indexOf("IF redispatch THEN");
  assert.ok(demotionAt >= 0, "the demotion branch is missing");
  assert.ok(insertAt > demotionAt, "the demotion must run before the superseding insert");

  const demotion = migration.slice(demotionAt, insertAt);
  assert.match(demotion, /UPDATE public\.generation_tasks task/u);
  assert.match(demotion, /task\.task_key LIKE 'prompt:scene-batch:%'/u);
  assert.match(demotion, /task\.state<>'COMPLETE' AND task\.required/u);
  assert.match(demotion, /SET required=false/u);
  assert.match(demotion, /task\.account_id=account_id AND task\.workspace_id=workspace_id/u);
  assert.match(demotion, /task\.project_revision_id=revision_id/u);

  // The superseding insert keeps its per-attempt key and stays required.
  assert.match(
    migration,
    /'prompt:scene-batch:1'\|\|CASE WHEN redispatch THEN ':'\|\|attempt_id::text ELSE '' END/u,
  );

  // The live owner body is re-created whole: the admission-critical guards survive.
  assert.match(migration, /hosted prompt authority is invalid/u);
  assert.match(migration, /redispatch_count=run\.redispatch_count\+1/u);
});

test("0187 is the manifest tail and its file hash matches the committed sha256", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"),
  );
  const tail = manifest.migrations.at(-1);
  assert.equal(tail.version, 187);
  assert.equal(tail.name, "hosted_prompt_redispatch_supersedes_scene_batch_tasks");
  assert.equal(
    tail.filename,
    "0187_hosted_prompt_redispatch_supersedes_scene_batch_tasks.sql",
  );
  const digest = `sha256:${createHash("sha256").update(readFileSync(migrationUrl)).digest("hex")}`;
  assert.equal(tail.sha256, digest);
});
