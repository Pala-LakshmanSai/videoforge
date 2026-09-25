import { createHash } from "node:crypto";
import { sha256CanonicalJson, type JsonValue } from "@videoforge/contracts";
import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import {
  PERMANENT_POSITIVE_GUARDRAIL,
  PERMANENT_NEGATIVE_GUARDRAIL,
  promptOpticalViewpoint,
} from "@videoforge/pipeline/prompts";
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
import { buildKieScenePrompt } from "../providers/kie-image-job";

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
const withoutTrailingGuard = (value: string, guard: string): string =>
  value === guard ? "" : value.endsWith(`, ${guard}`) ? value.slice(0, -guard.length - 2) : value;
export const imageRegenerationWorkflowId = (id: string) => `image-regen-${id}`;
export function regenerationStatus(row: Row): Row {
  return {
    request_id: row.id,
    attempt_id: row.attempt_id,
    state:
      row.state === "COMPLETED" || row.state === "SUCCEEDED"
        ? "SUCCEEDED"
        : row.state === "UNKNOWN_NO_RETRY"
          ? "ACTION_REQUIRED"
          : ["FAILED", "CANCELLED", "REQUEST_REJECTED"].includes(String(row.state))
          ? "FAILED"
          : "PENDING",
    ...(row.state === "UNKNOWN_NO_RETRY" ? { error_code: "UNKNOWN_NO_RETRY" } : {}),
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
      if (!input.environment.HOSTED_PAIR_WORKFLOW)
        throw new Error("HOSTED_IMAGE_REGENERATION_WORKFLOW_MISSING");
      const store = storeFor(args.accountId, args.workspaceId);
      const provider = await store.generationProvider(args.projectId, args.revisionId);
      if (provider === "KIE_FAL") {
        if (!input.config.apiGeneration || !input.environment.PRIVATE_ARTIFACTS)
          throw new Error("HOSTED_IMAGE_REGENERATION_API_BINDING_MISSING");
        const source = record(await store.apiSource({ ...args, projectRevisionId: args.revisionId }));
        const sourceManifest = record(source.sourceInputManifest);
        const compiled = record(sourceManifest.compiledPrompt);
        const components = record(compiled.components);
        const stylePositive = typeof components.stylePositiveSuffix === "string"
          ? components.stylePositiveSuffix : "";
        const savedPositiveGuard = typeof components.permanentPositiveGuardrail === "string"
          ? components.permanentPositiveGuardrail : PERMANENT_POSITIVE_GUARDRAIL;
        const literalContent = withoutTrailingGuard(
          withoutTrailingGuard(
            withoutTrailingGuard(args.prompt, savedPositiveGuard),
            PERMANENT_POSITIVE_GUARDRAIL,
          ),
          stylePositive,
        );
        const prompt = buildKieScenePrompt({
          ...compiled,
          components: {
            ...components,
            literalContent,
            continuityAndShotRole: "",
            cropGuidance: "",
            stylePositiveSuffix: stylePositive,
            extraPromptKeywords: null,
          },
        } as Parameters<typeof buildKieScenePrompt>[0]);
        const row = await store.createApi({ ...args, projectRevisionId: args.revisionId }, prompt);
        const requestId = text(row.id);
        if (input.scheduleWorkflow !== false && ["PREPARED", "SUBMITTING", "SUBMITTED"].includes(String(row.state))) {
          const id = imageRegenerationWorkflowId(requestId);
          try {
            await input.environment.HOSTED_PAIR_WORKFLOW.create({
              id,
              params: { schema_version: "videoforge-image-regeneration-workflow/v1",
                accountId: args.accountId, workspaceId: args.workspaceId, requestId },
            });
          } catch (error) {
            try { await input.environment.HOSTED_PAIR_WORKFLOW.get(id); }
            catch { throw error; }
          }
        }
        return { request_id: requestId, attempt_id: row.id,
          state: row.state === "PREPARED" ? "QUEUED" : "DISPATCHING" };
      }
      await assertHostedPairLiveBindings(input.environment);
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
        const compiled = record(original.compiledPrompt);
        const savedComponents = compiled.components && typeof compiled.components === "object" &&
          !Array.isArray(compiled.components) ? record(compiled.components) : {};
        const savedPositiveGuard = typeof savedComponents.permanentPositiveGuardrail === "string"
          ? savedComponents.permanentPositiveGuardrail : PERMANENT_POSITIVE_GUARDRAIL;
        const savedNegativeGuard = typeof savedComponents.permanentNegativeGuardrail === "string"
          ? savedComponents.permanentNegativeGuardrail : PERMANENT_NEGATIVE_GUARDRAIL;
        // Keep the raw edit as the idempotency/audit identity. Only model-facing
        // text receives optical treatment and the current output guardrails.
        const literalContent = withoutTrailingGuard(
          withoutTrailingGuard(args.prompt, savedPositiveGuard),
          PERMANENT_POSITIVE_GUARDRAIL,
        ).replace(
          /(^|[;,]\s*)camera:\s*([^;]*)/giu,
          (_match, separator: string, treatment: string) =>
            `${separator}viewpoint: ${promptOpticalViewpoint(treatment)}`,
        );
        const styleNegativeSuffix = withoutTrailingGuard(
          withoutTrailingGuard(text(compiled.negativePrompt), savedNegativeGuard),
          PERMANENT_NEGATIVE_GUARDRAIL,
        );
        const positivePrompt = [literalContent, PERMANENT_POSITIVE_GUARDRAIL]
          .filter(Boolean)
          .join(", ");
        const negativePrompt = [styleNegativeSuffix, PERMANENT_NEGATIVE_GUARDRAIL]
          .filter(Boolean)
          .join(", ");
        const positivePromptSha256 = digest(positivePrompt);
        const negativePromptSha256 = digest(negativePrompt);
        const work = {
          ...original,
          outputPrefix,
          outputReservationId: reservationId,
          positivePromptSha256,
          negativePromptSha256,
          compiledPrompt: {
            ...compiled,
            components: {
              literalContent,
              continuityAndShotRole: "",
              cropGuidance: "",
              stylePositiveSuffix: "",
              extraPromptKeywords: null,
              permanentPositiveGuardrail: PERMANENT_POSITIVE_GUARDRAIL,
              styleNegativeSuffix,
              permanentNegativeGuardrail: PERMANENT_NEGATIVE_GUARDRAIL,
            },
            positivePrompt,
            negativePrompt,
            positivePromptUtf8Bytes: Buffer.byteLength(positivePrompt, "utf8"),
            negativePromptUtf8Bytes: Buffer.byteLength(negativePrompt, "utf8"),
            positivePromptSha256,
            negativePromptSha256,
          },
        };
        const issuedAt = new Date().toISOString(),
          deadlineAt = new Date(Date.parse(issuedAt) + 600_000).toISOString(),
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
          deadlineAt,
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
      const store = storeFor(args.accountId, args.workspaceId);
      const api = await store.getApi(args);
      if (api) return regenerationStatus({ ...api, attempt_id: api.id });
      const row = await store.get(args);
      return row ? regenerationStatus(row) : null;
    },
  };
}
