// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { createApiApp } from "../app";
import { NodeFairAdmission } from "../runtime/node-fair-admission";
import { NodeVideoRuntime } from "../runtime/node-video-runtime";

const migrationsDir = path.resolve(
  import.meta.dirname,
  "../../../../../packages/control-plane/migrations",
);

const FIXTURE_CONTROL = { "X-VideoForge-Fixture-Control": "v2-provider-free-fixture-v1" };

async function composedApp() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "videoforge-video-runtime-routes-"));
  onTestFinished(() => rm(dataDir, { force: true, recursive: true }));
  const fairAdmission = new NodeFairAdmission(path.join(dataDir, "pglite"), migrationsDir);
  await fairAdmission.reset();
  return createApiApp({
    configuration: { commit: "v2-05-routes", environment: "test", mode: "fixture" },
    bindings: {
      platform: "node",
      fixturePreview: { read: async () => "<svg>fixture preview</svg>" },
      fixtureFairAdmission: fairAdmission,
      fixtureVideoRuntime: new NodeVideoRuntime(fairAdmission),
    },
  });
}

/** Admits one account through the invite flow and returns its session headers. */
async function admit(app: Awaited<ReturnType<typeof composedApp>>, email: string, session: string) {
  const headers = {
    "Content-Type": "application/json",
    "X-VideoForge-Fixture-Session": session,
    ...FIXTURE_CONTROL,
  };
  const invite = await app.request("/api/dev/shared-app/invites", {
    method: "POST",
    headers,
    body: JSON.stringify({ email }),
  });
  const issued = (await invite.json()) as { code: string; emailPassword: string };
  const authenticated = await app.request("/api/v2/auth/fixture", {
    method: "POST",
    headers,
    body: JSON.stringify({
      method: "EMAIL_PASSWORD",
      email,
      emailPassword: issued.emailPassword,
      inviteCode: issued.code,
    }),
  });
  expect(authenticated.status).toBe(200);
  return headers;
}

async function generate(
  app: Awaited<ReturnType<typeof composedApp>>,
  headers: Record<string, string>,
  projectId: string,
  title: string,
) {
  const response = await app.request("/api/v2/generation-requests", {
    method: "POST",
    headers,
    body: JSON.stringify({ projectId, title }),
  });
  expect(response.status).toBe(200);
  return response;
}

async function queue(
  app: Awaited<ReturnType<typeof composedApp>>,
  headers: Record<string, string>,
) {
  const response = await app.request("/api/v2/queue", { headers });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    requests: {
      projectId: string;
      stage: string;
      state: string;
      lanes?: { lane: string; state: string }[];
    }[];
  };
}

describe("V2-05 runtime-backed queue routes", () => {
  it("reports factual per-video stages and never exposes another account's video", async () => {
    const app = await composedApp();
    const alice = await admit(app, "alice@example.test", "session-alice");
    const bob = await admit(app, "bob@example.test", "session-bob");

    await generate(app, alice, "alice-one", "Alice one");
    await generate(app, bob, "bob-one", "Bob one");

    // A newly admitted video is QUEUED: no preparation, lane, or worker state exists yet.
    const initial = await queue(app, alice);
    expect(initial.requests).toHaveLength(1);
    expect(initial.requests[0]!.projectId).toBe("alice-one");
    expect(initial.requests[0]!.stage).toBe("QUEUED");

    // Each advance step is a durable observation, surfaced verbatim to the owner.
    const observed: string[] = [];
    for (let step = 0; step < 12; step += 1) {
      const advanced = await app.request("/api/v2/videos/alice-one/advance", {
        method: "POST",
        headers: alice,
      });
      expect(advanced.status).toBe(200);
      const state = (await advanced.json()) as {
        stage: string;
        providerCallsAuthorized: boolean;
        authorizedSpendUsd: number;
        settledCostUsd: number;
      };
      expect(state.providerCallsAuthorized).toBe(false);
      expect(state.authorizedSpendUsd).toBe(0);
      expect(state.settledCostUsd).toBe(0);
      observed.push(state.stage);
      if (["COMPLETE", "FAILED", "CANCELED"].includes(state.stage)) break;
    }
    expect(observed[0]).toBe("PREPARING");
    expect(observed).toContain("WAITING_FOR_WORKER");
    expect(observed).toContain("RENDERING");
    expect(observed.at(-1)).toBe("COMPLETE");

    // Terminal work releases admission capacity and leaves the active queue. Its exact private MP4
    // remains durable and downloadable only by the owner.
    const finished = await queue(app, alice);
    expect(finished.requests).toEqual([]);
    const download = await app.request("/api/v2/videos/alice-one/download", { headers: alice });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("video/mp4");
    expect(download.headers.get("x-videoforge-artifact-kind")).toBe("tenant-private-final-mp4");
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(9_000);

    // Bob's own video is untouched and still queued; he can never address Alice's video.
    const bobQueue = await queue(app, bob);
    expect(bobQueue.requests.map((request) => request.projectId)).toEqual(["bob-one"]);
    expect(bobQueue.requests[0]!.stage).toBe("QUEUED");
    const foreign = await app.request("/api/v2/videos/alice-one/advance", {
      method: "POST",
      headers: bob,
    });
    expect(foreign.status).toBe(404);
    expect((await app.request("/api/v2/videos/alice-one/download", { headers: bob })).status).toBe(
      404,
    );
  }, 120_000);

  it("cancels an owned video and refuses every later advance", async () => {
    const app = await composedApp();
    const carol = await admit(app, "carol@example.test", "session-carol");
    await generate(app, carol, "carol-one", "Carol one");

    const prepared = await app.request("/api/v2/videos/carol-one/advance", {
      method: "POST",
      headers: carol,
    });
    expect(((await prepared.json()) as { stage: string }).stage).toBe("PREPARING");

    const canceled = await app.request("/api/v2/videos/carol-one/cancel", {
      method: "POST",
      headers: carol,
    });
    expect(canceled.status).toBe(200);
    const state = (await canceled.json()) as { stage: string; terminalReason: string };
    expect(state.stage).toBe("CANCELED");
    expect(state.terminalReason).toBe("OWNER_CANCELLED");

    const late = await app.request("/api/v2/videos/carol-one/advance", {
      method: "POST",
      headers: carol,
    });
    expect(late.status).toBe(409);
    expect((await queue(app, carol)).requests).toEqual([]);
  }, 60_000);
});
