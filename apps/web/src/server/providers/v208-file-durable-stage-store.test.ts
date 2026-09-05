import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  V208_FILE_DURABLE_DIRECTORY_MODE,
  V208_FILE_DURABLE_FILE_MODE,
  V208_FILE_DURABLE_LOCK_FILENAME,
  V208_FILE_DURABLE_MANIFEST_FILENAME,
  V208_FILE_DURABLE_MATERIALIZATION_STATE_FILENAME,
  V208_FILE_DURABLE_STAGE_MANIFEST_SCHEMA,
  V208_FILE_DURABLE_STAGE_STATE_FILENAME,
  V208FileDurableStageStore,
  createV208FileDurableStageStore,
  type V208FileAuthorityManifest,
  type V208FileDurableStageStoreOptions,
} from "./v208-file-durable-stage-store.js";
import type {
  V213QualificationMaterializationRequest,
  V213QualificationMaterializationRouteResult,
} from "../hosted/v213-qualification-materializer.js";

const hash = (value: unknown): `sha256:${string}` =>
  `sha256:${createHash("sha256")
    .update(canonicalizeJson(value as JsonValue), "utf8")
    .digest("hex")}`;

const manifest: V208FileAuthorityManifest = {
  schemaVersion: V208_FILE_DURABLE_STAGE_MANIFEST_SCHEMA,
  checkpoint: "V2-08",
  stage: 7,
  proposalSha256: `sha256:${"1".repeat(64)}`,
  authoritySha256: `sha256:${"2".repeat(64)}`,
  image: `ghcr.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@sha256:${"3".repeat(64)}`,
  sourceCommit: "4".repeat(40),
  planSha256: `sha256:${"5".repeat(64)}`,
};

const predecessorHandoffSha256 = `sha256:${"6".repeat(64)}`;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "videoforge-v208-file-store-"));
  roots.push(value);
  return value;
}

function options(
  journalDirectory: string,
  overrides: Partial<V208FileDurableStageStoreOptions> = {},
): V208FileDurableStageStoreOptions {
  return {
    journalDirectory,
    manifest,
    signAuthority: () => "A".repeat(88),
    now: () => new Date("2026-09-05T00:00:00.000Z"),
    nonce: () => "n".repeat(32),
    ...overrides,
  };
}

async function claimedStore(
  journalDirectory = root(),
  overrides: Partial<V208FileDurableStageStoreOptions> = {},
): Promise<{
  readonly store: V208FileDurableStageStore;
  readonly authority: Awaited<ReturnType<V208FileDurableStageStore["issueStageAuthority"]>>;
}> {
  const store = createV208FileDurableStageStore(options(journalDirectory, overrides));
  const authority = await store.issueStageAuthority({
    stage: "soulx",
    inputSha256: manifest.planSha256,
    predecessorHandoffSha256,
  });
  const claim = await store.claimStageAuthority(authority);
  expect(claim.decision).toBe("EXECUTE");
  return { store, authority };
}

function materializationRequest(authorityId: string): V213QualificationMaterializationRequest {
  const unsigned = {
    schemaVersion: "videoforge.v213-qualification-materialization-request/v1" as const,
    fullLiveAuthorityId: "00000000-0000-4000-8000-000000000208",
    operationId: "soulx-live-qualification" as const,
    stageAuthorityId: authorityId,
    outerStateSha256: `sha256:${"7".repeat(64)}`,
    inputSha256: manifest.planSha256,
    sourceCommit: manifest.sourceCommit,
    descriptor: {
      key: "soulx2s" as const,
      lane: "soulx" as const,
      id: "soulx-cold-2s",
      seconds: 2,
      mode: "complete" as const,
      cold: true,
    },
    caseSourceRef: { path: "test/case.ts", sha256: `sha256:${"8".repeat(64)}` },
    generatorRef: { path: "test/generator.ts", sha256: `sha256:${"9".repeat(64)}` },
    validatorRef: { path: "test/validator.py", sha256: `sha256:${"a".repeat(64)}` },
    deployment: { synthetic: true },
    inputs: [],
  };
  return {
    ...unsigned,
    requestSha256: hash(unsigned),
  } as unknown as V213QualificationMaterializationRequest;
}

function materializationResult(
  request: V213QualificationMaterializationRequest,
): V213QualificationMaterializationRouteResult {
  const unsigned = {
    schemaVersion: "videoforge.v213-qualification-materialization-result/v1" as const,
    fullLiveAuthorityId: request.fullLiveAuthorityId,
    operationId: request.operationId,
    stageAuthorityId: request.stageAuthorityId,
    outerStateSha256: request.outerStateSha256,
    requestSha256: request.requestSha256,
    sourceRefsSha256: hash({
      caseSourceRef: request.caseSourceRef,
      generatorRef: request.generatorRef,
      validatorRef: request.validatorRef,
    }),
    materialization: {
      schemaVersion: "videoforge.v213-qualification-case-materialization/v1",
      caseDescriptorSha256: hash(request.descriptor),
      materializationEvidenceSha256: `sha256:${"b".repeat(64)}`,
      request: { synthetic: true },
    },
  };
  return {
    ...unsigned,
    resultSha256: hash(unsigned),
  } as unknown as V213QualificationMaterializationRouteResult;
}

describe("V208FileDurableStageStore", () => {
  it("creates a private journal with canonical 0600 files", async () => {
    const { store } = await claimedStore();
    expect(statSync(store.journalDirectory).mode & 0o7777).toBe(V208_FILE_DURABLE_DIRECTORY_MODE);
    for (const filename of [
      V208_FILE_DURABLE_MANIFEST_FILENAME,
      V208_FILE_DURABLE_STAGE_STATE_FILENAME,
      V208_FILE_DURABLE_MATERIALIZATION_STATE_FILENAME,
    ]) {
      const path = join(store.journalDirectory, filename);
      expect(statSync(path).mode & 0o7777).toBe(V208_FILE_DURABLE_FILE_MODE);
      expect(readFileSync(path, "utf8").endsWith("\n")).toBe(true);
    }
    expect(readdirSync(store.journalDirectory).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("consumes once, resumes after restart/expiry, and completes idempotently", async () => {
    const journalDirectory = root();
    let current = new Date("2026-09-05T00:00:00.000Z");
    const store = createV208FileDurableStageStore(
      options(journalDirectory, { now: () => current }),
    );
    const authority = await store.issueStageAuthority({
      stage: "soulx",
      inputSha256: manifest.planSha256,
      predecessorHandoffSha256,
    });
    current = new Date("2026-09-05T00:11:00.000Z");
    await expect(store.claimStageAuthority(authority)).rejects.toMatchObject({
      code: "V208_FILE_DURABLE_STAGE_AUTHORITY_EXPIRED",
    });
    current = new Date("2026-09-05T00:01:00.000Z");
    expect((await store.claimStageAuthority(authority)).decision).toBe("EXECUTE");
    current = new Date("2026-09-05T00:11:00.000Z");
    const restarted = createV208FileDurableStageStore(
      options(journalDirectory, { now: () => current, signAuthority: undefined }),
    );
    const resumed = await restarted.claimStageAuthority(authority);
    expect(resumed.decision).toBe("RESUME");
    const handoff = { qualified: true } as const;
    await restarted.completeStageAuthority(authority.authorityId, hash(handoff), handoff);
    const revision = restarted.readSnapshot().revision;
    await restarted.completeStageAuthority(authority.authorityId, hash(handoff), handoff);
    expect(restarted.readSnapshot().revision).toBe(revision);
    expect((await restarted.claimStageAuthority(authority)).decision).toBe("REPLAY_REJECTED");
    const snapshot = restarted.readSnapshot();
    expect(snapshot.previousStateSha256).not.toBe(`sha256:${"0".repeat(64)}`);
    expect(readdirSync(journalDirectory).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("persists operation claims/transitions with exact CAS and exposes cleanup scope", async () => {
    const { store, authority } = await claimedStore();
    const resourceKey = `v213-${authority.authorityId}-soulx-qualification`;
    const operation = {
      operationId: "create-lane",
      stageAuthorityId: authority.authorityId,
      kind: "create" as const,
      requestSha256: `sha256:${"c".repeat(64)}`,
      resourceKey,
    };
    expect((await store.claimOperation(operation)).action).toBe("EXECUTE");
    expect((await store.claimOperation(operation)).action).toBe("RECONCILE");
    await store.transitionOperation({
      operationId: operation.operationId,
      from: "IN_FLIGHT",
      to: "ACKED",
      providerId: "endpoint-1",
      evidence: { endpointId: "endpoint-1" },
    });
    const cleanup = await store.readCleanupStage(authority.authorityId);
    expect(cleanup).toEqual({
      stage: "soulx",
      stageAuthorityId: authority.authorityId,
      operations: [
        {
          kind: "create",
          resourceKey,
          state: "ACKED",
          providerId: "endpoint-1",
          evidence: { endpointId: "endpoint-1" },
        },
      ],
    });
    await expect(
      store.transitionOperation({
        operationId: operation.operationId,
        from: "IN_FLIGHT",
        to: "TERMINAL",
      }),
    ).rejects.toMatchObject({ code: "V208_FILE_DURABLE_OPERATION_CAS_FAILED" });
    await store.transitionOperation({
      operationId: operation.operationId,
      from: "ACKED",
      to: "TERMINAL",
    });
    expect((await store.claimOperation(operation)).action).toBe("DONE");
    await expect(store.readCleanupStage("other-authority")).rejects.toMatchObject({
      code: "V208_FILE_DURABLE_STAGE_AUTHORITY_NOT_FOUND",
    });
  });

  it("rejects an operation outside the exact cleanup namespace", async () => {
    const { store, authority } = await claimedStore();
    await store.claimOperation({
      operationId: "foreign-lane",
      stageAuthorityId: authority.authorityId,
      kind: "create",
      requestSha256: `sha256:${"d".repeat(64)}`,
      resourceKey: "v213-foreign-soulx-qualification",
    });
    await expect(store.readCleanupStage(authority.authorityId)).rejects.toMatchObject({
      code: "V208_FILE_DURABLE_CLEANUP_SCOPE_INVALID",
    });
  });

  it("claims, persists, reads, and resumes materialization without replaying execution", async () => {
    const { store, authority } = await claimedStore();
    const request = materializationRequest(authority.authorityId);
    const result = materializationResult(request);
    expect(await store.qualificationMaterializationStore.claim(request)).toBe("EXECUTE");
    expect(await store.qualificationMaterializationStore.claim(request)).toBe("RECONCILE");
    expect(await store.qualificationMaterializationStore.persist(request, result)).toEqual(result);
    expect(await store.qualificationMaterializationStore.read(request)).toEqual(result);
    expect(await store.qualificationMaterializationStore.claim(request)).toBe("EXISTING");
    const restarted = createV208FileDurableStageStore(
      options(store.journalDirectory, { signAuthority: undefined }),
    );
    expect(await restarted.materializationStore.read(request)).toEqual(result);
    const changed = {
      ...result,
      materialization: { ...result.materialization, request: { synthetic: false } },
    } as V213QualificationMaterializationRouteResult;
    const changedUnsigned = Object.fromEntries(
      Object.entries(changed).filter(([key]) => key !== "resultSha256"),
    );
    const changedResult = { ...changed, resultSha256: hash(changedUnsigned) };
    await expect(
      restarted.materializationStore.persist(request, changedResult),
    ).rejects.toMatchObject({ code: "V208_FILE_DURABLE_MATERIALIZATION_RESULT_DRIFT" });
  });

  it("rejects tampered state and honors an exclusive lock", async () => {
    const { store } = await claimedStore();
    const original = readFileSync(store.stageStatePath, "utf8");
    writeFileSync(store.stageStatePath, `${original.replace('"revision":2', '"revision":3')}`, {
      mode: V208_FILE_DURABLE_FILE_MODE,
    });
    chmodSync(store.stageStatePath, V208_FILE_DURABLE_FILE_MODE);
    await expect(Promise.resolve().then(() => store.readSnapshot())).rejects.toMatchObject({
      code: "V208_FILE_DURABLE_STAGE_STATE_HASH_INVALID",
    });

    // A fresh journal proves lock ownership without depending on a second in-process operation.
    const lockedRoot = root();
    const lockedStore = createV208FileDurableStageStore(options(lockedRoot));
    const lockPath = join(lockedRoot, V208_FILE_DURABLE_LOCK_FILENAME);
    writeFileSync(lockPath, `${canonicalizeJson({ pid: process.pid, token: "held" })}\n`, {
      mode: V208_FILE_DURABLE_FILE_MODE,
    });
    chmodSync(lockPath, V208_FILE_DURABLE_FILE_MODE);
    await expect(lockedStore.readCleanupStage("missing")).rejects.toMatchObject({
      code: "V208_FILE_DURABLE_LOCKED",
    });
    unlinkSync(lockPath);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("reclaims a complete stale lock and publishes no partial lock files", async () => {
    const journalDirectory = root();
    const store = createV208FileDurableStageStore(options(journalDirectory));
    const lockPath = join(journalDirectory, V208_FILE_DURABLE_LOCK_FILENAME);
    writeFileSync(
      lockPath,
      `${canonicalizeJson({ pid: 2_147_483_647, token: randomUUID() })}\n`,
      { mode: V208_FILE_DURABLE_FILE_MODE },
    );
    chmodSync(lockPath, V208_FILE_DURABLE_FILE_MODE);

    await expect(
      store.issueStageAuthority({
        stage: "soulx",
        inputSha256: manifest.planSha256,
        predecessorHandoffSha256,
      }),
    ).resolves.toMatchObject({ stage: "soulx" });
    expect(existsSync(lockPath)).toBe(false);
    expect(readdirSync(journalDirectory).some((name) => name.includes("v208-lock"))).toBe(false);
  });

  it("never releases a replacement lock with a different token or inode", async () => {
    const journalDirectory = root();
    const lockPath = join(journalDirectory, V208_FILE_DURABLE_LOCK_FILENAME);
    let replacement = "";
    const store = createV208FileDurableStageStore(
      options(journalDirectory, {
        signAuthority: () => {
          unlinkSync(lockPath);
          replacement = `${canonicalizeJson({ pid: process.pid, token: randomUUID() })}\n`;
          writeFileSync(lockPath, replacement, { mode: V208_FILE_DURABLE_FILE_MODE });
          chmodSync(lockPath, V208_FILE_DURABLE_FILE_MODE);
          return "A".repeat(88);
        },
      }),
    );

    await expect(
      store.issueStageAuthority({
        stage: "soulx",
        inputSha256: manifest.planSha256,
        predecessorHandoffSha256,
      }),
    ).rejects.toMatchObject({ code: "V208_FILE_DURABLE_LOCK_RELEASE_OWNERSHIP_INVALID" });
    expect(readFileSync(lockPath, "utf8")).toBe(replacement);
    unlinkSync(lockPath);
  });
});
