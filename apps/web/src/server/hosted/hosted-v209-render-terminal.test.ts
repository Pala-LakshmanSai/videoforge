import { describe, expect, it, vi } from "vitest";

import { canonicalJson, exactHostedRenderSubmission } from "./submission";
import renderInputFixture from "../../../../../packages/contracts/generated/fixtures/render_job_input.valid.json";
import { createHostedV209RenderTerminalHandoff } from "./hosted-v209-render-terminal";
import { verifyHostedObjectChecksum } from "./r2-checksum";

const IDS = Object.freeze({
  account: "00000000-0000-4000-8000-000000000001",
  workspace: "00000000-0000-4000-8000-000000000002",
  project: "00000000-0000-4000-8000-000000000003",
  revision: "00000000-0000-4000-8000-000000000004",
  request: "00000000-0000-4000-8000-000000000005",
  runtime: "00000000-0000-4000-8000-000000000006",
  attempt: "00000000-0000-4000-8000-000000000007",
  lease: "00000000-0000-4000-8000-000000000008",
});

async function hash(value: string): Promise<`sha256:${string}`> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function harness(requestState: "ACTIVE" | "SUCCEEDED") {
  const manifestSha256 = await hash("manifest");
  const outputSha256 = await hash("output");
  const receiptSha256 = await hash("receipt");
  const resultSha256 = await hash("result");
  const inputDocument = structuredClone(renderInputFixture);
  inputDocument.project_revision_id = IDS.revision;
  inputDocument.resolved_render_manifest.sha256 = manifestSha256;
  inputDocument.resolved_render_manifest.artifact_uri = `vf-local://objects/sha256/${manifestSha256.slice(7, 9)}/${manifestSha256.slice(7)}.json`;
  const plan = {
    schema_version: "videoforge-hosted-cpu-submission/v1",
    idempotency_key: "render-plan-test-idempotency",
    kind: "RENDER",
    project_id: IDS.project,
    project_revision_id: IDS.revision,
    input_document: inputDocument,
    objects: [inputDocument.resolved_render_manifest, ...inputDocument.assets].map(
      (object, index) => ({
        artifact_receipt_id: `00000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
        uri: object.artifact_uri,
      }),
    ),
  };
  const planSha256 = await hash(canonicalJson(plan));
  const candidate = {
    schemaVersion: "videoforge.v2-09-render-terminal-candidate/v1",
    accountId: IDS.account,
    workspaceId: IDS.workspace,
    attemptId: IDS.attempt,
    attemptState: "SUCCEEDED",
    attemptRequestSha256: await hash(
      canonicalJson(exactHostedRenderSubmission(plan, IDS.project, IDS.revision)),
    ),
    projectId: IDS.project,
    projectRevisionId: IDS.revision,
    planPayload: plan,
    planPayloadSha256: planSha256,
    runtimeId: IDS.runtime,
    runtimeStage: "COMPLETE",
    renderManifestSha256: manifestSha256,
    finalOutputSha256: outputSha256,
    generationRequestId: IDS.request,
    generationRequestState: requestState,
    leaseId: IDS.lease,
    leaseState: "RELEASED",
    leaseVersion: 2,
    leaseReleaseReason: "HOSTED_PAIR_OUTPUTS_ACCEPTED",
    renderAttemptCount: 1,
    runtimeCount: 1,
    leaseCount: 1,
    finalEventCount: 1,
    finalReceiptSha256: receiptSha256,
    finalArtifact: {
      assetId: "final-output",
      objectKey: `tenant/${IDS.account}/workspace/${IDS.workspace}/project/${IDS.project}/revision/${IDS.revision}/lane/render/job/${IDS.attempt}/artifact/result`,
      contentType: "video/mp4",
      contentLength: 4,
      checksumSha256: outputSha256,
      resultDocumentSha256: resultSha256,
      probe: { schema_version: "technical-probe/v1" },
    },
  };
  const query = vi.fn(async (sql: string, parameters: readonly unknown[]) => {
    if (sql.includes("read_v209_render_terminal_candidate")) return { rows: [{ candidate }] };
    const request = JSON.parse(String(parameters[0]));
    return {
      rows: [
        {
          result: {
            schemaVersion: "videoforge.v2-09-render-terminal-result/v1",
            state: "SUCCEEDED",
            accountId: IDS.account,
            workspaceId: IDS.workspace,
            generationRequestId: IDS.request,
            runtimeId: IDS.runtime,
            renderAttemptId: IDS.attempt,
            finalOutputSha256: outputSha256,
            finalOutputReceiptSha256: receiptSha256,
            replayed: true,
          },
        },
      ],
      request,
    };
  });
  const database = {
    transaction: vi.fn(async (work: (transaction: { query: typeof query }) => Promise<unknown>) =>
      work({ query }),
    ),
  };
  const bucket = {
    head: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  };
  return {
    candidate,
    query,
    bucket,
    terminal: createHostedV209RenderTerminalHandoff({
      database: database as never,
      bucket: bucket as never,
    }),
  };
}

describe("hosted V2-09 reconciler terminal handoff", () => {
  it("verifies a headerless R2 body stream without buffering it", async () => {
    const bytes = new TextEncoder().encode("streamed output bytes");
    const checksum = await hash("streamed output bytes");
    const arrayBuffer = vi.fn(async () => {
      throw new Error("stream path must not buffer");
    });
    const bucket = {
      get: vi.fn(async () => ({
        size: bytes.byteLength,
        etag: "stream-v1",
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        arrayBuffer,
      })),
    } as never;

    await expect(
      verifyHostedObjectChecksum(
        bucket,
        "tenant/streamed-output",
        { size: bytes.byteLength, etag: "stream-v1" },
        checksum,
      ),
    ).resolves.toBe(true);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it.each([
    ["bad-bytes", "stream-v1", true],
    ["bad-etag", "stream-v2", false],
  ] as const)("rejects R2 checksum drift for %s", async (caseName, objectEtag, badBytes) => {
    const expected = new TextEncoder().encode("streamed output bytes");
    const bytes = expected.slice();
    if (badBytes) bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    const checksum = await hash("streamed output bytes");
    const bucket = {
      get: vi.fn(async () => ({
        size: bytes.byteLength,
        etag: objectEtag,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        arrayBuffer: vi.fn(async () => expected.buffer),
      })),
    } as never;

    await expect(
      verifyHostedObjectChecksum(
        bucket,
        `tenant/streamed-output/${caseName}`,
        { size: expected.byteLength, etag: "stream-v1" },
        checksum,
      ),
    ).resolves.toBe(false);
  });

  it.each(["ACTIVE", "SUCCEEDED"] as const)(
    "replays exact COMPLETE/%s state through only the two narrow database functions",
    async (state) => {
      const target = await harness(state);
      await expect(
        target.terminal.acceptCompleted({
          accountId: IDS.account,
          workspaceId: IDS.workspace,
          attemptId: IDS.attempt,
        }),
      ).resolves.toMatchObject({ state: "SUCCEEDED", replayed: true });
      expect(target.query).toHaveBeenCalledTimes(2);
      const request = JSON.parse(String(target.query.mock.calls[1]?.[1]?.[0]));
      expect(request).toMatchObject({
        schemaVersion: "videoforge.v2-09-render-terminal-finalize/v1",
        accountId: IDS.account,
        workspaceId: IDS.workspace,
        attemptId: IDS.attempt,
        finalOutput: { checksumSha256: target.candidate.finalOutputSha256 },
      });
      expect(target.bucket.get).not.toHaveBeenCalled();
      expect(target.bucket.head).not.toHaveBeenCalled();
    },
  );

  it("rejects tenant-drifted candidate before finalization", async () => {
    const target = await harness("ACTIVE");
    (target.candidate as Record<string, unknown>).workspaceId = IDS.account;
    await expect(
      target.terminal.acceptCompleted({
        accountId: IDS.account,
        workspaceId: IDS.workspace,
        attemptId: IDS.attempt,
      }),
    ).rejects.toThrow("HOSTED_V209_RENDER_TERMINAL_INVALID");
    expect(target.query).toHaveBeenCalledTimes(1);
  });
});
