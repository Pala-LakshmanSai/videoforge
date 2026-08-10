import assert from "node:assert/strict";
import test from "node:test";

import { withMigratedDatabase } from "./support/pglite.mjs";

async function functionDefinition(executor, signature) {
  const result = await executor.query("SELECT pg_get_functiondef($1::regprocedure) AS definition", [
    signature,
  ]);
  assert.equal(result.rows.length, 1);
  return result.rows[0].definition;
}

function assertLockPrecedesSequenceRead(definition, expectedOwnerRelation) {
  const lockPosition = definition.indexOf("FOR UPDATE");
  const sequenceReadPosition = definition.indexOf("max(sequence)");
  assert.ok(definition.includes(`public.${expectedOwnerRelation}`));
  assert.ok(lockPosition >= 0, "the sequence function must take an owner/aggregate row lock");
  assert.ok(sequenceReadPosition >= 0, "the sequence function must read the prior maximum");
  assert.ok(
    lockPosition < sequenceReadPosition,
    "the owner/aggregate row lock must be acquired before max(sequence) is read",
  );
}

test("event sequence functions serialize on public owner and aggregate rows before reading max", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    const costDefinition = await functionDefinition(
      executor,
      "public.videoforge_enforce_cost_event_sequence()",
    );
    assertLockPrecedesSequenceRead(costDefinition, "project_revisions");
    assert.ok(costDefinition.includes("public.image_style_versions"));
    assert.ok(costDefinition.includes("public.avatar_profile_versions"));

    const workflowDefinition = await functionDefinition(
      executor,
      "public.videoforge_enforce_workflow_event_sequence()",
    );
    assertLockPrecedesSequenceRead(workflowDefinition, "workflow_instances");
    assert.ok(workflowDefinition.includes("public.generation_tasks"));
    assert.ok(workflowDefinition.includes("public.attempts"));
  });
});
