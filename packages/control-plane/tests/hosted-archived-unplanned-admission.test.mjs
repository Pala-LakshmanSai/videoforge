import assert from "node:assert/strict";
import test from "node:test";
import {
  FairAdmissionRepository,
  trustedTenantActorScope,
  trustedTenantScope,
} from "../dist/src/index.js";
import { IDS, seedLockedProjects } from "./support/fixtures.mjs";
import { FIXED_TIME, sha256, uuid, withMigratedDatabase } from "./support/pglite.mjs";

test("archive releases only an owned unplanned admission and allows the next video", async () => {
  await withMigratedDatabase(async ({ executor }) => {
    await seedLockedProjects(executor);
    const repo = new FairAdmissionRepository(executor);
    const actor = trustedTenantActorScope(
      trustedTenantScope(IDS.accountA, IDS.workspaceA),
      IDS.userA,
    );
    const id = uuid(252001);
    await repo.enqueueVideo(actor, {
      requestId: id,
      projectId: IDS.projectA,
      projectRevisionId: IDS.revisionA,
      idempotencyKey: "unplanned",
      now: FIXED_TIME,
      auditId: uuid(252002),
    });
    await repo.promoteNext({
      leaseId: uuid(252003),
      auditId: uuid(252004),
      ownerTokenSha256: sha256("lease"),
      now: FIXED_TIME,
      expiresAt: new Date(Date.parse(FIXED_TIME) + 60000).toISOString(),
    });
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountB]);
    await assert.rejects(
      executor.query("SELECT public.videoforge_retire_archived_unplanned_admission($1,$2,$3)", [
        IDS.accountA,
        IDS.workspaceA,
        IDS.projectA,
      ]),
      /tenant mismatch/,
    );
    await executor.query("SELECT set_config('videoforge.account_id',$1,false)", [IDS.accountA]);
    assert.equal(
      (
        await executor.query(
          "SELECT public.videoforge_retire_archived_unplanned_admission($1,$2,$3) retired",
          [IDS.accountA, IDS.workspaceA, IDS.projectA],
        )
      ).rows[0].retired,
      false,
    );
    // A planned runtime makes the narrow cleanup ineligible, even on an archived project.
    await executor.query(
      "INSERT INTO video_runtime_states(id,account_id,workspace_id,project_id,project_revision_id,generation_request_id,stage,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'QUEUED',now(),now())",
      [uuid(252005), IDS.accountA, IDS.workspaceA, IDS.projectA, IDS.revisionA, id],
    );
    await executor.query("SELECT * FROM public.videoforge_archive_hosted_project($1,$2,$3)", [
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
    ]);
    assert.equal(
      (
        await executor.query(
          "SELECT state FROM provider_workload_leases WHERE generation_request_id=$1",
          [id],
        )
      ).rows[0].state,
      "ACTIVE",
    );
    await executor.query("DELETE FROM video_runtime_states WHERE id=$1", [uuid(252005)]);
    await executor.query("SELECT * FROM public.videoforge_archive_hosted_project($1,$2,$3)", [
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
    ]);
    assert.equal(
      (await executor.query("SELECT state FROM generation_requests WHERE id=$1", [id])).rows[0]
        .state,
      "CANCELLED",
    );
    assert.equal(
      (
        await executor.query(
          "SELECT state,release_reason FROM provider_workload_leases WHERE generation_request_id=$1",
          [id],
        )
      ).rows[0].release_reason,
      "ARCHIVED_UNPLANNED_VIDEO",
    );
    assert.equal(
      (await executor.query("SELECT active_lease_count FROM global_generation_capacity")).rows[0]
        .active_lease_count,
      0,
    );
    await executor.query("SELECT * FROM public.videoforge_archive_hosted_project($1,$2,$3)", [
      IDS.accountA,
      IDS.workspaceA,
      IDS.projectA,
    ]);
    assert.equal(
      (
        await executor.query(
          "SELECT count(*)::int n FROM generation_queue_audits WHERE operation='TERMINAL_RELEASE' AND request_id=$1",
          [id],
        )
      ).rows[0].n,
      1,
    );
  });
});
