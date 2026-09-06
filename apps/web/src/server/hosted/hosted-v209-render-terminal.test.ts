import { describe, expect, it, vi } from "vitest";

import { canonicalJson } from "./submission";
import { createHostedV209RenderTerminalHandoff } from "./hosted-v209-render-terminal";

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
  const plan = {
    schema_version: "videoforge-hosted-cpu-submission/v1",
    kind: "RENDER",
    project_id: IDS.project,
    project_revision_id: IDS.revision,
    input_document: {
      schema_version: "render-job-input/v1",
      project_revision_id: IDS.revision,
      resolved_render_manifest: { sha256: manifestSha256 },
    },
  };
  const planSha256 = await hash(canonicalJson(plan));
  const candidate = {
    schemaVersion: "videoforge.v2-09-render-terminal-candidate/v1",
    accountId: IDS.account,
    workspaceId: IDS.workspace,
    attemptId: IDS.attempt,
    attemptState: "SUCCEEDED",
    attemptRequestSha256: planSha256,
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
  return { candidate, query, bucket, terminal: createHostedV209RenderTerminalHandoff({ database: database as never, bucket: bucket as never }) };
}

describe("hosted V2-09 reconciler terminal handoff", () => {
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
