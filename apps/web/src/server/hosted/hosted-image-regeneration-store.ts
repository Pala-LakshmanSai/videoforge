import type { TransactionalSqlExecutor, Sha256, SqlPrimitive } from "@videoforge/control-plane";
import { sha256CanonicalJson } from "@videoforge/contracts";
import type {
  HostedImageRegenerationClaim,
  HostedImageRegenerationRequest,
  HostedImageRegenerationStore,
} from "./hosted-image-regeneration-runtime";
import type {
  HostedV209TerminalLineage,
  HostedV209TerminalOutputStore,
} from "./hosted-v209-terminal-output-ingestor";

type Row = Record<string, unknown>;
export type PreparedImageRegenerationLineage = Omit<HostedV209TerminalLineage, "binding"> & {
  readonly binding: Omit<HostedV209TerminalLineage["binding"], "providerJobId">;
};
function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("HOSTED_IMAGE_REGENERATION_STORE_INVALID");
  return value as Row;
}
function claim(value: unknown): HostedImageRegenerationClaim {
  const r = record(value);
  for (const key of [
    "id",
    "image_task_id",
    "dispatch_token",
    "endpoint_id_sha256",
    "request_hash",
    "envelope_hash",
    "state",
  ])
    if (typeof r[key] !== "string") throw new Error("HOSTED_IMAGE_REGENERATION_STORE_INVALID");
  return {
    requestId: r.id as string,
    sceneId: r.image_task_id as string,
    dispatchToken: r.dispatch_token as string,
    endpointIdSha256: r.endpoint_id_sha256 as Sha256,
    requestBodySha256: r.request_hash as Sha256,
    envelopeSha256: r.envelope_hash as Sha256,
    state: r.state as HostedImageRegenerationClaim["state"],
    providerJobId: typeof r.provider_job_id === "string" ? r.provider_job_id : null,
  };
}
export interface HostedImageRegenerationCreateInput {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly userId?: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly imageTaskId: string;
  readonly prompt: string;
  readonly idempotencyKey: string;
}
export class HostedSqlImageRegenerationStore implements HostedImageRegenerationStore {
  constructor(
    private readonly database: TransactionalSqlExecutor,
    readonly accountId: string,
    readonly workspaceId: string,
  ) {}
  private async query(sql: string, values: readonly SqlPrimitive[]): Promise<unknown> {
    return this.database.transaction(async (tx) => {
      await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", this.accountId]);
      const result = await tx.query<{ value: unknown }>(sql, values);
      return result.rows[0]?.value ?? null;
    });
  }
  async databaseNow(): Promise<string> {
    const value = await this.query("SELECT clock_timestamp()::text AS value", []);
    if (typeof value !== "string")
      throw new Error("HOSTED_IMAGE_REGENERATION_DATABASE_TIME_INVALID");
    return new Date(value).toISOString();
  }
  async generationProvider(projectId: string, revisionId: string): Promise<"RUNPOD" | "KIE_FAL"> {
    const value = await this.query(
      `SELECT generation_provider AS value FROM public.projects
       WHERE account_id=$1 AND workspace_id=$2 AND id=$3
         AND EXISTS (SELECT 1 FROM public.project_revisions r
           WHERE r.account_id=$1 AND r.workspace_id=$2 AND r.project_id=$3 AND r.id=$4)`,
      [this.accountId, this.workspaceId, projectId, revisionId],
    );
    if (value !== "RUNPOD" && value !== "KIE_FAL")
      throw new Error("HOSTED_IMAGE_REGENERATION_PROJECT_INVALID");
    return value;
  }
  async apiSource(input: HostedImageRegenerationCreateInput): Promise<Row> {
    return record(await this.query(
      "SELECT public.videoforge_read_hosted_api_image_regeneration_source($1,$2,$3,$4,$5) AS value",
      [this.accountId, this.workspaceId, input.projectId, input.projectRevisionId, input.imageTaskId],
    ));
  }
  async createApi(input: HostedImageRegenerationCreateInput, prompt: string): Promise<Row> {
    if (input.accountId !== this.accountId || input.workspaceId !== this.workspaceId)
      throw new Error("HOSTED_IMAGE_REGENERATION_SCOPE_INVALID");
    return record(await this.query(
      "SELECT public.videoforge_create_hosted_api_image_regeneration($1,$2,$3,$4,$5,$6,$7) AS value",
      [this.accountId, this.workspaceId, input.projectId, input.projectRevisionId,
        input.imageTaskId, prompt, input.idempotencyKey],
    ));
  }
  async getApi(input: { accountId: string; workspaceId: string; projectId: string;
    imageTaskId: string; requestId: string }): Promise<Row | null> {
    if (input.accountId !== this.accountId || input.workspaceId !== this.workspaceId) return null;
    const value = await this.query(
      "SELECT public.videoforge_get_hosted_api_image_regeneration($1,$2,$3,$4,$5) AS value",
      [this.accountId, this.workspaceId, input.projectId, input.imageTaskId, input.requestId],
    );
    return value === null ? null : record(value);
  }
  async loadApi(requestId: string): Promise<Row | null> {
    const value = await this.query(
      "SELECT public.videoforge_load_hosted_api_image_regeneration($1,$2) AS value",
      [requestId, this.workspaceId],
    );
    return value === null ? null : record(value);
  }
  async claimApi(requestId: string, claimId: string): Promise<Row> {
    return record(await this.query(
      "SELECT public.videoforge_claim_hosted_api_image_regeneration($1,$2) AS value",
      [requestId, claimId],
    ));
  }
  async recordApiTask(requestId: string, claimId: string, providerTaskId: string): Promise<Row> {
    return record(await this.query(
      "SELECT public.videoforge_record_hosted_api_image_regeneration_task($1,$2,$3) AS value",
      [requestId, claimId, providerTaskId],
    ));
  }
  async markApiUnknown(requestId: string, claimId: string): Promise<Row> {
    return record(await this.query(
      "SELECT public.videoforge_mark_hosted_api_image_regeneration_unknown($1,$2) AS value",
      [requestId, claimId],
    ));
  }
  async failApi(requestId: string, failureCode: string): Promise<Row> {
    return record(await this.query(
      "SELECT public.videoforge_fail_hosted_api_image_regeneration($1,$2) AS value",
      [requestId, failureCode],
    ));
  }
  async commitApi(requestId: string, artifact: { sha256: string; byteSize: number;
    contentType: string; width: number; height: number }): Promise<Row> {
    return record(await this.query(
      "SELECT public.videoforge_commit_hosted_api_image_regeneration($1,$2,$3,$4,$5::jsonb) AS value",
      [requestId, artifact.sha256, artifact.byteSize, artifact.contentType,
        JSON.stringify({ width: artifact.width, height: artifact.height })],
    ));
  }
  async admitCost(requestId: string, snapshot: Record<string, unknown>): Promise<void> {
    await this.query(
      "SELECT public.videoforge_admit_hosted_image_regeneration_cost($1,$2::jsonb) AS value",
      [requestId, JSON.stringify(snapshot)],
    );
  }
  async create(input: HostedImageRegenerationCreateInput): Promise<Row> {
    if (input.accountId !== this.accountId || input.workspaceId !== this.workspaceId)
      throw new Error("HOSTED_IMAGE_REGENERATION_SCOPE_INVALID");
    return record(
      await this.query(
        "SELECT public.videoforge_create_hosted_image_regeneration($1,$2,$3,$4,$5,$6,$7) AS value",
        [
          this.accountId,
          this.workspaceId,
          input.projectId,
          input.projectRevisionId,
          input.imageTaskId,
          input.prompt,
          input.idempotencyKey,
        ],
      ),
    );
  }
  async get(input: {
    accountId: string;
    workspaceId: string;
    projectId: string;
    imageTaskId: string;
    requestId: string;
  }): Promise<Row | null> {
    if (input.accountId !== this.accountId || input.workspaceId !== this.workspaceId) return null;
    const value = await this.query(
      "SELECT public.videoforge_get_hosted_image_regeneration($1,$2,$3,$4,$5) AS value",
      [this.accountId, this.workspaceId, input.projectId, input.imageTaskId, input.requestId],
    );
    return value === null ? null : record(value);
  }
  async load(requestId: string): Promise<Row> {
    return record(
      await this.query("SELECT public.videoforge_load_hosted_image_regeneration($1,$2) AS value", [
        requestId,
        this.workspaceId,
      ]),
    );
  }
  async persistPrepared(
    requestId: string,
    request: HostedImageRegenerationRequest,
    lineage: PreparedImageRegenerationLineage,
  ): Promise<void> {
    if (request.accountId !== this.accountId || request.workspaceId !== this.workspaceId)
      throw new Error("HOSTED_IMAGE_REGENERATION_SCOPE_INVALID");
    await this.query(
      "SELECT public.videoforge_prepare_hosted_image_regeneration($1,$2::jsonb,$3::jsonb,$4,$5,$6::jsonb) AS value",
      [
        requestId,
        JSON.stringify(request.requestBody),
        JSON.stringify(request.envelope),
        await sha256CanonicalJson(request.requestBody),
        await sha256CanonicalJson(request.envelope),
        JSON.stringify(lineage),
      ],
    );
  }
  async prepare(input: HostedImageRegenerationRequest): Promise<HostedImageRegenerationClaim> {
    if (input.accountId !== this.accountId || input.workspaceId !== this.workspaceId)
      throw new Error("HOSTED_IMAGE_REGENERATION_SCOPE_INVALID");
    return claim(await this.load(input.requestId));
  }
  async beginSend(input: {
    requestId: string;
    expectedRequestBodySha256: Sha256;
    expectedEnvelopeSha256: Sha256;
  }) {
    const value = record(
      await this.query(
        "SELECT public.videoforge_image_regeneration_transition($1,$2,NULL,$3,$4) AS value",
        [input.requestId, "SENT", input.expectedRequestBodySha256, input.expectedEnvelopeSha256],
      ),
    );
    return { claim: claim(value), acquired: value.acquired === true };
  }
  async finishSend(input: {
    requestId: string;
    state: "ASSIGNED" | "REQUEST_REJECTED" | "DISPATCH_ACK_UNKNOWN";
    providerJobId: string | null;
  }) {
    return claim(
      await this.query(
        "SELECT public.videoforge_image_regeneration_transition($1,$2,$3) AS value",
        [input.requestId, input.state, input.providerJobId],
      ),
    );
  }
  async finishTerminal(input: { requestId: string; state: "COMPLETED" | "FAILED" | "CANCELLED" }) {
    return claim(
      await this.query(
        "SELECT public.videoforge_image_regeneration_transition($1,$2,NULL) AS value",
        [input.requestId, input.state],
      ),
    );
  }
  async cancelUnsent(requestId: string): Promise<void> {
    await this.query(
      "SELECT public.videoforge_image_regeneration_transition($1,'CANCEL_UNSENT',NULL) AS value",
      [requestId],
    );
  }
  async replaceAcceptedScene(input: { requestId: string; sceneId: string; accepted: unknown }) {
    const r = await this.load(input.requestId);
    if (r.image_task_id !== input.sceneId || r.state !== "COMPLETED")
      throw new Error("HOSTED_IMAGE_REGENERATION_NOT_COMMITTED");
    return claim(r);
  }
  async failQueued(requestId: string): Promise<void> {
    await this.query(
      "SELECT public.videoforge_image_regeneration_transition($1,'FAILED',NULL) AS value",
      [requestId],
    );
  }
  async release(requestId: string, proof: Record<string, unknown>): Promise<boolean> {
    return (
      (await this.query(
        "SELECT public.videoforge_release_hosted_image_regeneration($1,$2::jsonb) AS value",
        [requestId, JSON.stringify(proof)],
      )) === true
    );
  }
  terminalStore(requestId: string): HostedV209TerminalOutputStore {
    return {
      atomicBarrier: true,
      load: async (input) => {
        const r = await this.load(requestId);
        if (
          input.accountId !== this.accountId ||
          input.workspaceId !== this.workspaceId ||
          input.attemptId !== r.attempt_id ||
          input.providerJobId !== r.provider_job_id ||
          input.lane !== "mage_image"
        )
          return null;
        const lineage = record(r.lineage) as unknown as HostedV209TerminalLineage;
        return { ...lineage, binding: { ...lineage.binding, providerJobId: input.providerJobId } };
      },
      commitArtifacts: async (input) => {
        if (
          input.artifacts.length !== 1 ||
          input.lineage.binding.accountId !== this.accountId ||
          input.lineage.binding.workspaceId !== this.workspaceId
        )
          throw new Error("HOSTED_IMAGE_REGENERATION_ARTIFACT_INVALID");
        const receiptHash = await sha256CanonicalJson({
          requestId,
          artifact: input.artifacts[0],
          receipt: input.receipt,
        });
        await this.query(
          "SELECT public.videoforge_commit_hosted_image_regeneration($1,$2::jsonb,$3,$4::jsonb) AS value",
          [
            requestId,
            JSON.stringify(input.artifacts[0]),
            receiptHash,
            JSON.stringify(input.receipt),
          ],
        );
        return { state: "LANE_COMPLETED", receiptSha256s: [receiptHash] };
      },
    };
  }
}
