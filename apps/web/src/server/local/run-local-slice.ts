import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { CreateProjectRequest } from "@videoforge/contracts";

import { createApiApp } from "../app";
import { createLocalMediaPipelineRunner } from "./media-runner";
import type {
  LocalOwnedVoiceover,
  LocalPipelineRunRequest,
  LocalPipelineRunResult,
  LocalSliceRunner,
} from "./types";
import { LOCAL_PROJECT_ID } from "./types";

const POLL_DEADLINE_MS = 5 * 60 * 1_000;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function requireStatus(response: Response, expected: number, label: string): Promise<void> {
  if (response.status === expected) return;
  const detail = (await response.clone().text()).slice(0, 2_000);
  throw new Error(`${label} returned ${response.status}, expected ${expected}: ${detail}`);
}

function mutationHeaders(idempotencyKey: string, versionToken?: string): HeadersInit {
  return {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    ...(versionToken ? { "if-match": versionToken } : {}),
  };
}

function sha256Bytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

class CapturingRunner implements LocalSliceRunner {
  private completed: LocalPipelineRunResult | null = null;

  constructor(private readonly delegate: LocalSliceRunner) {}

  prepareOwnedVoiceover(): Promise<LocalOwnedVoiceover> {
    return this.delegate.prepareOwnedVoiceover();
  }

  async run(request: LocalPipelineRunRequest): Promise<LocalPipelineRunResult> {
    const result = await this.delegate.run(request);
    this.completed = result;
    return result;
  }

  result(): LocalPipelineRunResult {
    if (!this.completed) throw new Error("The real local runner did not publish a result.");
    return this.completed;
  }
}

interface LocalProjectResponse {
  readonly project: {
    readonly status: string;
    readonly stage: string;
    readonly versionToken: string;
    readonly latestArtifact: {
      readonly sha256: string;
      readonly bytes: number;
      readonly filename: string;
    } | null;
    readonly review: {
      readonly candidateId: string | null;
      readonly candidateSha256: string | null;
    };
  };
  readonly notice: { readonly detail: string } | null;
}

async function main(): Promise<void> {
  const runner = new CapturingRunner(createLocalMediaPipelineRunner());
  const app = createApiApp({
    commit: "local-acceptance",
    environment: "test",
    mode: "local",
    localRunner: runner,
  });

  const healthResponse = await app.request("/api/health");
  await requireStatus(healthResponse, 200, "Local health");
  invariant(
    healthResponse.headers.get("x-videoforge-provider-mode") === "local",
    "Local health omitted its provider-mode header.",
  );
  const health = (await healthResponse.json()) as {
    mode: string;
    provider_calls_authorized: boolean;
    authorized_spend_usd: number;
  };
  invariant(health.mode === "local", "Local health reported the wrong execution mode.");
  invariant(!health.provider_calls_authorized, "Local health authorized provider calls.");
  invariant(health.authorized_spend_usd === 0, "Local health authorized external spend.");

  const bootstrapResponse = await app.request("/api/v1/bootstrap");
  await requireStatus(bootstrapResponse, 200, "Local bootstrap");
  const bootstrap = (await bootstrapResponse.json()) as {
    draft: { voiceover: { assetId: string } };
  };
  const createRequest: CreateProjectRequest = {
    title: "How to Recognize a Sweet Watermelon — Local Slice",
    voiceover_asset_id: bootstrap.draft.voiceover.assetId,
    avatar_profile_version_id: "avatar_profile_version_fixture_001",
    image_style_version_id: "style_version_documentary_stock_v1",
    optional_script: null,
    extra_prompt_keywords: null,
    apply_extra_prompt_keywords: false,
    generation_mode: "BALANCED",
    execution_profile_overrides: null,
    spend_cap_usd: 0.1,
    user_seed: 20_260_809,
  };

  const preflightResponse = await app.request("/api/v1/projects/preflight", {
    method: "POST",
    headers: mutationHeaders("local-acceptance-preflight-001"),
    body: JSON.stringify(createRequest),
  });
  await requireStatus(preflightResponse, 200, "Local preflight");
  const preflight = (await preflightResponse.json()) as {
    status: string;
    estimatedCostUsd: number;
    providerCallsAuthorized: boolean;
  };
  invariant(preflight.status === "READY", "Local preflight was not ready.");
  invariant(preflight.estimatedCostUsd === 0, "Local preflight estimated external spend.");
  invariant(!preflight.providerCallsAuthorized, "Local preflight authorized provider calls.");

  const createOptions = {
    method: "POST",
    headers: mutationHeaders("local-acceptance-create-001"),
    body: JSON.stringify(createRequest),
  } as const;
  const createResponse = await app.request("/api/v1/projects", createOptions);
  await requireStatus(createResponse, 202, "Local project creation");
  const replayResponse = await app.request("/api/v1/projects", createOptions);
  await requireStatus(replayResponse, 202, "Idempotent local project replay");
  invariant(
    replayResponse.headers.get("x-videoforge-idempotent-replay") === "true",
    "Local project replay did not use the idempotency ledger.",
  );

  const deadline = Date.now() + POLL_DEADLINE_MS;
  let ready: LocalProjectResponse | null = null;
  let priorStage = "";
  while (Date.now() < deadline) {
    const projectResponse = await app.request(`/api/v1/projects/${LOCAL_PROJECT_ID}`);
    await requireStatus(projectResponse, 200, "Local project poll");
    const project = (await projectResponse.json()) as LocalProjectResponse;
    if (project.project.stage !== priorStage) {
      console.error(
        `${project.project.stage}: ${project.notice?.detail ?? "Local work in progress"}`,
      );
      priorStage = project.project.stage;
    }
    if (project.project.status === "READY_FOR_REVIEW") {
      ready = project;
      break;
    }
    if (project.project.status === "NEEDS_ATTENTION") {
      throw new Error(project.notice?.detail ?? "The local media pipeline failed.");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  invariant(ready, "The local media pipeline exceeded its five-minute acceptance deadline.");
  invariant(ready.project.latestArtifact, "Ready local project omitted its MP4 artifact.");
  invariant(ready.project.review.candidateId, "Ready local project omitted its candidate ID.");
  invariant(ready.project.review.candidateSha256, "Ready local project omitted its candidate SHA.");

  const rangeResponse = await app.request(`/api/v1/projects/${LOCAL_PROJECT_ID}/preview`, {
    headers: { range: "bytes=0-1023" },
  });
  await requireStatus(rangeResponse, 206, "Local preview range");
  invariant(
    rangeResponse.headers.get("x-content-sha256") === ready.project.latestArtifact.sha256,
    "Preview checksum header does not bind the accepted artifact.",
  );
  invariant(
    (await rangeResponse.arrayBuffer()).byteLength === 1_024,
    "Preview range was not exact.",
  );

  const approvalResponse = await app.request(`/api/v1/projects/${LOCAL_PROJECT_ID}/approve`, {
    method: "POST",
    headers: mutationHeaders("local-acceptance-approve-001", ready.project.versionToken),
    body: JSON.stringify({
      project_id: LOCAL_PROJECT_ID,
      candidate_id: ready.project.review.candidateId,
      candidate_sha256: ready.project.review.candidateSha256,
    }),
  });
  await requireStatus(approvalResponse, 200, "Exact local candidate approval");

  const downloadResponse = await app.request(`/api/v1/projects/${LOCAL_PROJECT_ID}/download`);
  await requireStatus(downloadResponse, 200, "Approved local download");
  invariant(
    downloadResponse.headers.get("content-disposition") ===
      'attachment; filename="videoforge-local-owned-slice.mp4"',
    "Approved download filename is not exact.",
  );
  const downloadedBytes = new Uint8Array(await downloadResponse.arrayBuffer());
  const downloadedSha256 = sha256Bytes(downloadedBytes);
  invariant(
    downloadedSha256 === ready.project.latestArtifact.sha256,
    "Downloaded bytes do not match the approved candidate SHA-256.",
  );
  invariant(
    downloadedBytes.byteLength === ready.project.latestArtifact.bytes,
    "Downloaded bytes do not match the approved candidate byte count.",
  );

  const result = runner.result();
  const evidence = JSON.parse(await readFile(result.evidencePath, "utf8")) as {
    provider_calls_authorized: boolean;
    external_spend_usd: number;
  };
  invariant(!evidence.provider_calls_authorized, "Acceptance evidence authorized provider calls.");
  invariant(evidence.external_spend_usd === 0, "Acceptance evidence recorded external spend.");
  invariant(
    sha256Bytes(await readFile(result.evidencePath)) === result.evidenceSha256,
    "Acceptance evidence bytes do not match their content-addressed SHA-256.",
  );

  console.log(
    JSON.stringify(
      {
        status: "SUCCEEDED",
        apiAcceptance: {
          health: "local-provider-off",
          preflight: "READY",
          createReplay: "idempotent",
          previewRange: 1_024,
          approval: "exact-candidate-and-sha256",
          download: "queryless-exact-bytes",
        },
        providerCallsAuthorized: false,
        externalSpendUsd: 0,
        output: {
          filename: result.filename,
          sha256: result.sha256,
          bytes: result.bytes,
          durationMs: result.durationMs,
          totalFrames: result.totalFrames,
          downloadedSha256,
          evidencePath: result.evidencePath,
          evidenceSha256: result.evidenceSha256,
        },
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unknown local slice failure");
  process.exitCode = 1;
}
