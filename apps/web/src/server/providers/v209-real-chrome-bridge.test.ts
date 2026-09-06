import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import { runV209RealChromeBridge } from "../../../../../deploy/v2-09/v209-real-chrome-bridge";
import {
  V209_REAL_CHROME_EVIDENCE_SCHEMA,
  V209_REAL_CHROME_REQUEST_SCHEMA,
  V209_REAL_CHROME_SOURCE,
} from "./v209-real-chrome-operator";

const request = {
  schemaVersion: V209_REAL_CHROME_REQUEST_SCHEMA,
  source: V209_REAL_CHROME_SOURCE,
  accountId: "account-fixture",
  workspaceId: "workspace-fixture",
  prepared: { voiceoverSha256: `sha256:${"c".repeat(64)}` },
  maxProgressReads: 10,
  pollIntervalMs: 0,
  stopAt: "2026-09-07T00:00:00.000Z",
} as const;
const CREATE_KEY = "browser-project-11111111-1111-4111-8111-111111111111";
const CREATE_HASH = `sha256:${"d".repeat(64)}`;

async function recordStages(claims: any, claim: any, projectId = "project-1") {
  await claims.recordCreateRequest({
    schemaVersion: "videoforge.v2-09-create-request-identity/v1",
    source: request.source,
    accountId: request.accountId,
    workspaceId: request.workspaceId,
    claimId: claim.claimId,
    clickOrdinal: 1,
    idempotencyKey: CREATE_KEY,
    createRequestSha256: CREATE_HASH,
    voiceoverSha256: request.prepared.voiceoverSha256,
  });
  await claims.recordProjectIdentity({
    schemaVersion: "videoforge.v2-09-project-identity/v1",
    source: request.source,
    accountId: request.accountId,
    workspaceId: request.workspaceId,
    claimId: claim.claimId,
    clickOrdinal: 1,
    idempotencyKey: CREATE_KEY,
    createRequestSha256: CREATE_HASH,
    voiceoverSha256: request.prepared.voiceoverSha256,
    projectId,
    projectRevisionId: "revision-1",
    generationRequestId: null,
  });
}

function generationIdentity(claim: any, projectId = "project-1") {
  return {
    schemaVersion: "videoforge.v2-09-generate-click-identity/v1",
    source: request.source,
    accountId: request.accountId,
    workspaceId: request.workspaceId,
    projectId,
    projectRevisionId: "revision-1",
    generationRequestId: "request-1",
    claimId: claim.claimId,
    clickOrdinal: 1,
    generateClickCount: 1,
    idempotencyKey: CREATE_KEY,
    createRequestSha256: CREATE_HASH,
    voiceoverSha256: request.prepared.voiceoverSha256,
  };
}

test("derives exactly one durable claim from the authority and passes it to Chrome", async () => {
  const directory = mkdtempSync(join(tmpdir(), "v209-click-identity-"));
  chmodSync(directory, 0o700);
  const clickIdentityPath = join(directory, "click.json");
  let claim: unknown;
  const result = await runV209RealChromeBridge(
    {
      schemaVersion: "videoforge.v2-09-real-chrome-bridge/v1",
      authorityId: "v2-09-real-chrome-test",
      request,
      productionOrigin: "https://videoforge.example",
      authStatePath: "/private/auth.json",
      clickIdentityPath,
      voiceoverPath: "/private/voiceover.wav",
      verifiedOutputPath: "/private/output.mp4",
    },
    {
      runPlaywright: (async (input: {
        claims: {
          reserveOneShot(value: unknown): Promise<unknown>;
          recordCreateRequest(value: unknown, input: unknown): Promise<void>;
          recordProjectIdentity(value: unknown, input: unknown): Promise<void>;
          recordAcknowledgedClick(value: unknown, input: unknown): Promise<void>;
        };
      }) => {
        claim = await input.claims.reserveOneShot({
          source: request.source,
          accountId: request.accountId,
          workspaceId: request.workspaceId,
          prepared: request.prepared,
        });
        await recordStages(input.claims, claim);
        await input.claims.recordAcknowledgedClick(generationIdentity(claim), {});
        return {
          schemaVersion: V209_REAL_CHROME_EVIDENCE_SCHEMA,
          claimId: (claim as { claimId: string }).claimId,
          projectId: "project-1",
          projectRevisionId: "revision-1",
          generationRequestId: "request-1",
          generateClickCount: 1,
        };
      }) as never,
    },
  );
  assert.equal((claim as { durable: boolean }).durable, true);
  assert.equal((claim as { replayed: boolean }).replayed, false);
  assert.equal((claim as { clickOrdinal: number }).clickOrdinal, 1);
  assert.equal(result.evidence.claimId, (claim as { claimId: string }).claimId);
  const persisted = JSON.parse(readFileSync(clickIdentityPath, "utf8"));
  assert.equal(persisted.schema_version, "videoforge.v2-09-click-generation-identity-file/v1");
  assert.equal(persisted.identity.generationRequestId, "request-1");
  const claimFile = JSON.parse(readFileSync(`${clickIdentityPath}.claim.json`, "utf8"));
  const createFile = JSON.parse(readFileSync(`${clickIdentityPath}.create-request.json`, "utf8"));
  const projectFile = JSON.parse(readFileSync(`${clickIdentityPath}.project.json`, "utf8"));
  assert.equal(claimFile.schema_version, "videoforge.v2-09-click-claim-file/v1");
  assert.equal(createFile.identity.idempotencyKey, CREATE_KEY);
  assert.equal(projectFile.identity.generationRequestId, null);
  assert.equal(projectFile.lookup.createRequestSha256, CREATE_HASH);
});

test("persists once before later Chrome failure and never overwrites the identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "v209-click-identity-failure-"));
  chmodSync(directory, 0o700);
  const clickIdentityPath = join(directory, "click.json");
  let clicks = 0;
  const run = () =>
    runV209RealChromeBridge(
      {
        schemaVersion: "videoforge.v2-09-real-chrome-bridge/v1",
        authorityId: "v2-09-real-chrome-test",
        request,
        productionOrigin: "https://videoforge.example",
        authStatePath: "/private/auth.json",
        clickIdentityPath,
        voiceoverPath: "/private/voiceover.wav",
        verifiedOutputPath: "/private/output.mp4",
      },
      {
        runPlaywright: (async ({ claims }: any) => {
          const claim = await claims.reserveOneShot({
            source: request.source,
            accountId: request.accountId,
            workspaceId: request.workspaceId,
            prepared: request.prepared,
          });
          clicks += 1;
          await recordStages(claims, claim);
          await claims.recordAcknowledgedClick(generationIdentity(claim));
          throw new Error("later output failure");
        }) as never,
      },
    );
  await assert.rejects(run(), /later output failure/u);
  const before = readFileSync(clickIdentityPath, "utf8");
  await assert.rejects(run(), /V2_09_REAL_CHROME_CLICK_IDENTITY_PERSIST_FAILED/u);
  assert.equal(readFileSync(clickIdentityPath, "utf8"), before);
  assert.equal(clicks, 1);
});

test("retains exact project and revision lookup when generation identity is not reached", async () => {
  const directory = mkdtempSync(join(tmpdir(), "v209-project-identity-failure-"));
  chmodSync(directory, 0o700);
  const clickIdentityPath = join(directory, "click.json");
  await assert.rejects(
    runV209RealChromeBridge(
      {
        schemaVersion: "videoforge.v2-09-real-chrome-bridge/v1",
        authorityId: "v2-09-real-chrome-test",
        request,
        productionOrigin: "https://videoforge.example",
        authStatePath: "/private/auth.json",
        clickIdentityPath,
        voiceoverPath: "/private/voiceover.wav",
        verifiedOutputPath: "/private/output.mp4",
      },
      {
        runPlaywright: (async ({ claims }: any) => {
          const claim = await claims.reserveOneShot({
            source: request.source,
            accountId: request.accountId,
            workspaceId: request.workspaceId,
            prepared: request.prepared,
          });
          await recordStages(claims, claim);
          throw new Error("upload failed before generation");
        }) as never,
      },
    ),
    /upload failed before generation/u,
  );
  const project = JSON.parse(readFileSync(`${clickIdentityPath}.project.json`, "utf8"));
  assert.equal(project.identity.projectId, "project-1");
  assert.equal(project.identity.projectRevisionId, "revision-1");
  assert.equal(project.identity.generationRequestId, null);
  assert.deepEqual(project.lookup, {
    createRequestSha256: CREATE_HASH,
    idempotencyKey: CREATE_KEY,
  });
  assert.throws(() => readFileSync(clickIdentityPath), /ENOENT/u);
});

test("rejects a wrong acknowledged identity before persistence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "v209-click-identity-wrong-"));
  chmodSync(directory, 0o700);
  const clickIdentityPath = join(directory, "click.json");
  await assert.rejects(
    runV209RealChromeBridge(
      {
        schemaVersion: "videoforge.v2-09-real-chrome-bridge/v1",
        authorityId: "v2-09-real-chrome-test",
        request,
        productionOrigin: "https://videoforge.example",
        authStatePath: "/private/auth.json",
        clickIdentityPath,
        voiceoverPath: "/private/voiceover.wav",
        verifiedOutputPath: "/private/output.mp4",
      },
      {
        runPlaywright: (async ({ claims }: any) => {
          const claim = await claims.reserveOneShot({
            source: request.source,
            accountId: request.accountId,
            workspaceId: request.workspaceId,
            prepared: request.prepared,
          });
          await recordStages(claims, claim);
          await claims.recordAcknowledgedClick(generationIdentity(claim, "wrong project"));
        }) as never,
      },
    ),
    /V2_09_REAL_CHROME_CLICK_IDENTITY_INVALID/u,
  );
  assert.throws(() => readFileSync(clickIdentityPath), /ENOENT/u);
});

test("rejects widened input before Chrome", async () => {
  let runs = 0;
  await assert.rejects(
    runV209RealChromeBridge(
      {
        schemaVersion: "videoforge.v2-09-real-chrome-bridge/v1",
        authorityId: "v2-09-real-chrome-test",
        request,
        productionOrigin: "https://videoforge.example",
        authStatePath: "/private/auth.json",
        clickIdentityPath: "/private/click.json",
        voiceoverPath: "/private/voiceover.wav",
        verifiedOutputPath: "/private/output.mp4",
        fallback: true,
      },
      {
        runPlaywright: (async () => {
          runs += 1;
          return {};
        }) as never,
      },
    ),
    /V2_09_REAL_CHROME_BRIDGE_INPUT_INVALID/u,
  );
  assert.equal(runs, 0);
});
