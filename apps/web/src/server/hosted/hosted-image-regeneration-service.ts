import { createHash } from "node:crypto";
import { sha256CanonicalJson, type JsonValue } from "@videoforge/contracts";
import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import {
  HostedSqlImageRegenerationStore,
  type PreparedImageRegenerationLineage,
} from "./hosted-image-regeneration-store";
import type { HostedImageRegenerationRouteService } from "./hosted-image-regeneration-route";
import type { HostedImageRegenerationRequest } from "./hosted-image-regeneration-runtime";
import { materializeV209OrdinaryWorkerRequest } from "./hosted-v209-ordinary-worker-request";
import { signHostedEnvelopeBody } from "./hosted-envelope-signer";
import { HostedR2Signer } from "./r2";
import {
  assertHostedPairLiveBindings,
  type HostedPairLiveEnvironment,
} from "./hosted-pair-live-wiring";
import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";

type Row = Record<string, unknown>;
function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("HOSTED_IMAGE_REGENERATION_SOURCE_INVALID");
  return value as Row;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value)
    throw new Error("HOSTED_IMAGE_REGENERATION_SOURCE_INVALID");
  return value;
}
const digest = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
export const imageRegenerationWorkflowId = (id: string) => `image-regen-${id}`;
export function regenerationStatus(row: Row): Row {
  return {
    request_id: row.id,
    attempt_id: row.attempt_id,
    state:
      row.state === "COMPLETED"
        ? "SUCCEEDED"
        : ["FAILED", "CANCELLED", "REQUEST_REJECTED"].includes(String(row.state))
          ? "FAILED"
          : "PENDING",
  };
}
export function createHostedImageRegenerationService(input: {
  database: TransactionalSqlExecutor;
  scheduleWorkflow?: boolean;
  config: HostedRuntimeConfiguration;
  environment: HostedRuntimeEnvironment & HostedPairLiveEnvironment;
}): HostedImageRegenerationRouteService {
  const storeFor = (a: string, w: string) =>
    new HostedSqlImageRegenerationStore(input.database, a, w);
  return {
    async create(args) {
      await assertHostedPairLiveBindings(input.environment);
      if (!input.environment.HOSTED_PAIR_WORKFLOW)
        throw new Error("HOSTED_IMAGE_REGENERATION_WORKFLOW_MISSING");
      const store = storeFor(args.accountId, args.workspaceId);
      const created = await store.create({ ...args, projectRevisionId: args.revisionId });
      const requestId = text(created.id);
      let row = await store.load(requestId);
      if (row.state === "QUEUED") {
        const source = record(row.source_lineage),
          binding = record(source.binding);
        if (!Array.isArray(source.candidateWork))
          throw new Error("HOSTED_IMAGE_REGENERATION_SOURCE_INVALID");
        const original = source.candidateWork
          .map(record)
          .find((item) => item.taskId === args.imageTaskId);
        if (!original) throw new Error("HOSTED_IMAGE_REGENERATION_SOURCE_INVALID");
        const attemptId = text(row.attempt_id),
          reservationId = text(row.output_reservation_id);
        const outputPrefix = `tenant/${args.accountId}/workspace/${args.workspaceId}/project/${args.projectId}/revision/${args.revisionId}/lane/mage-image/job/${attemptId}`;
        const compiled = record(original.compiledPrompt),
          positivePromptSha256 = digest(args.prompt);
        const work = {
          ...original,
          outputPrefix,
          outputReservationId: reservationId,
          positivePromptSha256,
          compiledPrompt: { ...compiled, positivePrompt: args.prompt, positivePromptSha256 },
        };
        const issuedAt = new Date().toISOString(),
          expiresAt = new Date(Date.parse(issuedAt) + 3_600_000).toISOString();
        const sourceEnvelope = record(record(source.requestBody).envelope);
        const unsigned: Row = {
          ...sourceEnvelope,
          dispatch_token: crypto.randomUUID(),
          work: {
            ...record(sourceEnvelope.work),
            task_id: args.imageTaskId,
            attempt_id: attemptId,
            item_count: 1,
            items_manifest_sha256: await sha256CanonicalJson([work]),
          },
          artifacts: {
            ...record(sourceEnvelope.artifacts),
            output_prefix: outputPrefix,
            transfer_port_reservation_ids: [reservationId],
            input_manifest_sha256: await sha256CanonicalJson([work]),
          },
          limits: {
            ...record(sourceEnvelope.limits),
            issued_at: issuedAt,
            expires_at: expiresAt,
            max_items: 1,
          },
        };
        delete unsigned.authority_sha256;
        delete unsigned.signature;
        const signed = await signHostedEnvelopeBody(unsigned as JsonValue, {
          secretHex: input.environment.VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX!,
          keyId: input.environment.VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID!,
        });
        const envelope = {
          ...unsigned,
          authority_sha256: signed.authoritySha256,
          signature: signed.signature,
        };
        const materialized = await materializeV209OrdinaryWorkerRequest(
          {
            lane: "mage_image",
            accountId: args.accountId,
            workspaceId: args.workspaceId,
            attemptId,
            issuedAt,
            expiresAt,
            envelope,
            work: [work],
            imageSeed: crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff,
            requestTtlSeconds: 3_600,
          },
          new HostedR2Signer(input.config.r2),
        );
        const request: HostedImageRegenerationRequest = {
          accountId: args.accountId,
          workspaceId: args.workspaceId,
          requestId,
          sceneId: args.imageTaskId,
          editedPrompt: args.prompt,
          envelope,
          requestBody: materialized.body,
          endpointIdSha256: text(binding.endpointIdSha256) as `sha256:${string}`,
          dispatchToken: text(unsigned.dispatch_token),
        };
        const withoutEnvelope = Object.fromEntries(
          Object.entries(materialized.body).filter(([key]) => key !== "envelope"),
        );
        const lineage = {
          binding: {
            ...binding,
            attemptId,
            dispatchTokenSha256: digest(text(unsigned.dispatch_token)),
            envelopeSha256: await sha256CanonicalJson(envelope),
            requestSha256: await sha256CanonicalJson(withoutEnvelope),
          },
          deadlineAt: expiresAt,
          requestBody: materialized.body,
          candidateWork: [work],
        } as unknown as PreparedImageRegenerationLineage;
        try {
          await store.persistPrepared(requestId, request, lineage);
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? error.code : null;
          const persisted = await store.load(requestId);
          if (code !== "55P03" && !(code === "23505" && persisted.state !== "QUEUED")) throw error;
        }
        row = await store.load(requestId);
      }
      if (
        input.scheduleWorkflow !== false &&
        ["QUEUED", "PREPARED", "SENT", "ASSIGNED", "DISPATCH_ACK_UNKNOWN"].includes(
          String(row.state),
        )
      ) {
        const id = imageRegenerationWorkflowId(requestId);
        try {
          await input.environment.HOSTED_PAIR_WORKFLOW.create({
            id,
            params: {
              schema_version: "videoforge-image-regeneration-workflow/v1",
              accountId: args.accountId,
              workspaceId: args.workspaceId,
              requestId,
            },
          });
        } catch (error) {
          try {
            await input.environment.HOSTED_PAIR_WORKFLOW.get(id);
          } catch {
            throw error;
          }
        }
      }
      return {
        request_id: requestId,
        attempt_id: row.attempt_id,
        state: row.state === "QUEUED" ? "QUEUED" : "DISPATCHING",
      };
    },
    async get(args) {
      const row = await storeFor(args.accountId, args.workspaceId).get(args);
      return row ? regenerationStatus(row) : null;
    },
  };
}
