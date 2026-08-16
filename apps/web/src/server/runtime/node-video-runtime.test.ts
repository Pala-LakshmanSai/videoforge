// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { NodeFairAdmission } from "./node-fair-admission";
import { NodeVideoRuntime } from "./node-video-runtime";

const migrationsDir = path.resolve(
  import.meta.dirname,
  "../../../../../packages/control-plane/migrations",
);

async function composition() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "videoforge-node-video-runtime-"));
  onTestFinished(() => rm(dataDir, { force: true, recursive: true }));
  const admission = new NodeFairAdmission(path.join(dataDir, "pglite"), migrationsDir);
  await admission.reset();
  return { admission, runtime: new NodeVideoRuntime(admission) };
}

/** Drives one owned video to a terminal stage through the durable runtime, one step at a time. */
async function drive(
  runtime: NodeVideoRuntime,
  tenant: { accountId: string; workspaceId: string },
  publicProjectId: string,
  maximumSteps = 12,
) {
  const observed: string[] = [];
  for (let step = 0; step < maximumSteps; step += 1) {
    const view = await runtime.advance(tenant, publicProjectId);
    observed.push(view.stage);
    if (["COMPLETE", "FAILED", "CANCELED"].includes(view.stage)) break;
  }
  return observed;
}

describe("V2-05 application runtime cutover", () => {
  it("carries two tenant videos through independent provider-free stages and drains to zero workers", async () => {
    const { admission, runtime } = await composition();
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

    for (const [tenant, publicProjectId] of [
      [tenantA, "a-active"],
      [tenantA, "a-waiting"],
      [tenantB, "b-active"],
    ] as const) {
      await runtime.register(tenant, publicProjectId);
    }

    // A waiting video is inert: nothing may prepare or dispatch before admission.
    await expect(runtime.advance(tenantA, "a-waiting")).rejects.toMatchObject({
      message: expect.stringContaining("admission"),
    });

    const stagesA = await drive(runtime, tenantA, "a-active");
    const stagesB = await drive(runtime, tenantB, "b-active");
    for (const stages of [stagesA, stagesB]) {
      expect(stages[0]).toBe("PREPARING");
      expect(stages).toContain("WAITING_FOR_WORKER");
      expect(stages).toContain("RENDERING");
      expect(stages.at(-1)).toBe("COMPLETE");
    }

    const ownedA = await runtime.listOwned(tenantA, ["a-active", "a-waiting"]);
    expect(ownedA).toHaveLength(2);
    expect(ownedA.every((view) => view.providerCallsAuthorized === false)).toBe(true);
    expect(ownedA.every((view) => view.authorizedSpendUsd === 0)).toBe(true);
    expect(ownedA.some((view) => view.stage === "QUEUED")).toBe(true);
    expect(ownedA.some((view) => view.stage === "COMPLETE")).toBe(true);

    // Account B observes only its own video.
    const ownedB = await runtime.listOwned(tenantB, ["b-active"]);
    expect(ownedB).toHaveLength(1);
    expect(ownedB[0]!.stage).toBe("COMPLETE");

    const drain = await runtime.drainProof();
    expect(drain.liveAttempts).toBe(0);
    expect(drain.activeJobs).toBe(0);
    expect(drain.activeWorkers).toBe(0);
    expect(drain.settledCostUsd).toBe(0);
    expect(drain.acceptedJobs).toBeGreaterThan(0);
  }, 120_000);

  it("cancels an owned video and refuses every later transition", async () => {
    const { admission, runtime } = await composition();
    const tenant = { accountId: "fixture-c", workspaceId: "fixture-c-workspace" };
    await admission.enqueueVideo({
      tenant,
      actorEmail: "c@example.test",
      publicProjectId: "c-active",
      title: "C active",
    });
    await runtime.register(tenant, "c-active");
    expect((await runtime.advance(tenant, "c-active")).stage).toBe("PREPARING");

    const canceled = await runtime.cancel(tenant, "c-active");
    expect(canceled.stage).toBe("CANCELED");
    expect(canceled.terminalReason).toBe("OWNER_CANCELLED");
    await expect(runtime.advance(tenant, "c-active")).rejects.toMatchObject({
      code: "RUNTIME_TERMINAL",
    });
  }, 60_000);
});
