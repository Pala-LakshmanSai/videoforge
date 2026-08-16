// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NodeFairAdmission } from "./node-fair-admission";

const migrationsDir = path.resolve(
  import.meta.dirname,
  "../../../../../packages/control-plane/migrations",
);

describe("active Node fair-admission composition", () => {
  it("uses the migrated repository for two-account activation, replay, reorder, and cancel", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "videoforge-node-fair-admission-"));
    const admission = new NodeFairAdmission(path.join(dataDir, "pglite"), migrationsDir);
    await admission.reset();
    const tenantA = { accountId: "fixture-a", workspaceId: "fixture-a-workspace" };
    const tenantB = { accountId: "fixture-b", workspaceId: "fixture-b-workspace" };

    const activeA = await admission.enqueueVideo({
      tenant: tenantA,
      actorEmail: "a@example.test",
      publicProjectId: "a-active",
      title: "A active",
    });
    const waitingA = await admission.enqueueVideo({
      tenant: tenantA,
      actorEmail: "a@example.test",
      publicProjectId: "a-waiting",
      title: "A waiting",
    });
    const activeB = await admission.enqueueVideo({
      tenant: tenantB,
      actorEmail: "b@example.test",
      publicProjectId: "b-active",
      title: "B active",
    });
    expect([activeA.state, waitingA.state, activeB.state]).toEqual([
      "ADMITTED",
      "WAITING",
      "ADMITTED",
    ]);

    const replay = await admission.enqueueVideo({
      tenant: tenantA,
      actorEmail: "a@example.test",
      publicProjectId: "a-waiting",
      title: "A waiting",
    });
    expect(replay.requestId).toBe(waitingA.requestId);
    expect(replay.snapshot).toHaveLength(2);

    const reordered = await admission.reorderOwned({
      tenant: tenantA,
      actorEmail: "a@example.test",
      requestId: waitingA.requestId,
      expectedVersion: waitingA.version,
      toPosition: 1,
    });
    const reorderedWaiting = reordered.find((item) => item.requestId === waitingA.requestId)!;
    expect(reorderedWaiting.version).toBe(waitingA.version + 1);
    const cancelled = await admission.cancelOwned({
      tenant: tenantA,
      actorEmail: "a@example.test",
      requestId: waitingA.requestId,
      expectedVersion: reorderedWaiting.version,
    });
    expect(cancelled.map((item) => item.requestId)).toEqual([activeA.requestId]);
    await expect(
      admission.reorderOwned({
        tenant: tenantB,
        actorEmail: "b@example.test",
        requestId: activeA.requestId,
        expectedVersion: activeA.version,
        toPosition: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
