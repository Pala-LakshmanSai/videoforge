import { canonicalSha256, digestUtf8, type Sha256 } from "@videoforge/control-plane";
import { MAGE_MODEL_REVISION } from "../providers/runpod-mage-result";
import type { HostedPairLane } from "./hosted-pair-runtime-executor";
import { validateAndHashHostedContractDocument } from "./precompiled-contract-validation";
import type { HostedR2Signer } from "./r2";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const MAX_MAGE_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_SOULX_OUTPUT_BYTES = 128 * 1024 * 1024;
export const HOSTED_V209_SOULX_AVATAR_SOURCE_SHA256 =
  "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83" as Sha256;
export const HOSTED_V209_ORDINARY_REQUEST_TTL_SECONDS = 3600;

type RecordValue = Record<string, unknown>;

export interface V209OrdinaryWorkerRequestInput {
  readonly lane: HostedPairLane;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly attemptId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly envelope: Readonly<Record<string, unknown>>;
  readonly work: readonly RecordValue[];
  readonly avatarSourceInputReservationId?: string;
}

export interface V209OrdinaryWorkerRequest {
  readonly body: Readonly<Record<string, unknown>>;
  readonly requestBodySha256: Sha256;
}

type Signer = Pick<HostedR2Signer, "sign" | "signGenerated">;

function fail(): never {
  throw new Error("HOSTED_V209_ORDINARY_WORKER_REQUEST_INVALID");
}

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as RecordValue;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length < 1) fail();
  return value;
}

function id(value: unknown): string {
  const result = text(value);
  if (!ID.test(result)) fail();
  return result;
}

function sha(value: unknown): Sha256 {
  const result = text(value);
  if (!SHA256.test(result)) fail();
  return result as Sha256;
}

function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail();
  return Number(value);
}

function capability(input: V209OrdinaryWorkerRequestInput, reservationId: string): string {
  return digestUtf8(
    `videoforge:v209-ordinary-port:v1\u0000${input.accountId}\u0000${input.workspaceId}\u0000${input.attemptId}\u0000${reservationId}\u0000${input.issuedAt}`,
  ).slice("sha256:".length);
}

function lifetime(input: V209OrdinaryWorkerRequestInput): number {
  const issuedAt = Date.parse(input.issuedAt);
  const expiresAt = Date.parse(input.expiresAt);
  const seconds = (expiresAt - issuedAt) / 1000;
  if (
    !Number.isSafeInteger(seconds) ||
    seconds !== HOSTED_V209_ORDINARY_REQUEST_TTL_SECONDS ||
    new Date(issuedAt).toISOString() !== input.issuedAt ||
    new Date(expiresAt).toISOString() !== input.expiresAt
  )
    fail();
  return seconds;
}

function outputObjectKey(item: RecordValue): string {
  return `${text(item.outputPrefix)}/artifact/${id(item.taskId)}`;
}

async function outputPort(
  input: V209OrdinaryWorkerRequestInput,
  signer: Signer,
  item: RecordValue,
  contentType: "image/png" | "video/mp4",
  maxContentLength: number,
) {
  const reservationId = id(item.outputReservationId);
  const objectKey = outputObjectKey(item);
  const signed = await signer.signGenerated({
    objectKey,
    contentType,
    maxContentLength,
    lifetimeSeconds: lifetime(input),
    now: new Date(input.issuedAt),
  });
  if (signed.expiresAt !== input.expiresAt || signed.contentType !== contentType) fail();
  return Object.freeze({
    authority: Object.freeze({
      schema_version: "artifact-generated-output-authority/v1",
      reservation_id: reservationId,
      account_id: input.accountId,
      workspace_id: input.workspaceId,
      method: "PUT" as const,
      path: `/${objectKey}`,
      content_type: contentType,
      max_content_length: maxContentLength,
      expires_at: input.expiresAt,
      max_uses: 1 as const,
      capability_handle: capability(input, reservationId),
    }),
    url: signed.url,
  });
}

async function inputPort(
  input: V209OrdinaryWorkerRequestInput,
  signer: Signer,
  artifact: {
    readonly reservationId: string;
    readonly objectKey: string;
    readonly contentType: string;
    readonly contentLength: number;
    readonly checksumSha256: Sha256;
  },
) {
  const signed = await signer.sign({
    method: "GET",
    objectKey: artifact.objectKey,
    contentType: artifact.contentType,
    contentLength: artifact.contentLength,
    checksumSha256: artifact.checksumSha256,
    lifetimeSeconds: lifetime(input),
    now: new Date(input.issuedAt),
  });
  if (signed.expiresAt !== input.expiresAt) fail();
  return Object.freeze({
    authority: Object.freeze({
      schema_version: "artifact-transfer-port/v3",
      reservation_id: artifact.reservationId,
      account_id: input.accountId,
      workspace_id: input.workspaceId,
      method: "GET" as const,
      path: `/${artifact.objectKey}`,
      content_type: artifact.contentType,
      content_length: artifact.contentLength,
      checksum_sha256: artifact.checksumSha256,
      expires_at: input.expiresAt,
      max_uses: 1 as const,
      capability_handle: capability(input, artifact.reservationId),
    }),
    url: signed.url,
  });
}

function assertEnvelope(
  input: V209OrdinaryWorkerRequestInput,
  transferIds: readonly string[],
): void {
  const envelope = record(input.envelope);
  const tenant = record(envelope.tenant);
  const work = record(envelope.work);
  const artifacts = record(envelope.artifacts);
  const limits = record(envelope.limits);
  if (
    tenant.account_id !== input.accountId ||
    tenant.workspace_id !== input.workspaceId ||
    work.attempt_id !== input.attemptId ||
    work.lane !== input.lane ||
    work.item_count !== input.work.length ||
    limits.expires_at !== input.expiresAt ||
    artifacts.output_prefix !== input.work[0]?.outputPrefix ||
    JSON.stringify(artifacts.transfer_port_reservation_ids) !== JSON.stringify(transferIds)
  )
    fail();
}

function magePrompt(item: RecordValue) {
  const compiled = record(item.compiledPrompt);
  const positive = text(compiled.positivePrompt);
  const negative = text(compiled.negativePrompt);
  if (
    sha(item.positivePromptSha256) !== digestUtf8(positive) ||
    sha(item.negativePromptSha256) !== digestUtf8(negative) ||
    compiled.positivePromptSha256 !== item.positivePromptSha256 ||
    compiled.negativePromptSha256 !== item.negativePromptSha256
  )
    fail();
  return { positive, negative };
}

/** Exact URL-free SoulX plan whose canonical hash is bound into both signed envelope fields. */
export function v209OrdinarySoulXBatch(
  attemptId: string,
  avatarSourceInputReservationId: string | undefined,
  work: readonly RecordValue[],
): Readonly<Record<string, unknown>> {
  const first = record(work[0]);
  return Object.freeze({
    schema_version: "videoforge-soulx-span-batch/v1",
    attempt_id: id(attemptId),
    avatar_source: Object.freeze({
      asset_id: id(first.avatarSourceAssetId),
      sha256: sha(first.avatarSourceSha256),
      port_reservation_id: id(avatarSourceInputReservationId),
    }),
    spans: Object.freeze(
      work.map((item) =>
        Object.freeze({
          item_id: id(item.taskId),
          audio_asset_id: id(item.spanAudioAssetId),
          audio_sha256: sha(item.spanAudioSha256),
          audio_port_reservation_id: id(item.spanAudioInputReservationId),
          output_reservation_id: id(item.outputReservationId),
          padded_samples_48k: integer(item.paddedSamples48k, 1),
          trim_start_sample_48k: integer(item.trimStartSample48k),
          trim_end_sample_exclusive_48k: integer(item.trimEndSampleExclusive48k, 1),
        }),
      ),
    ),
  });
}

/** Builds exactly the input accepted by the immutable qualified handler. All presigned ports use
 * the DB-owned issued time, so a crash/replay rematerializes byte-identical request JSON. */
export async function materializeV209OrdinaryWorkerRequest(
  input: V209OrdinaryWorkerRequestInput,
  signer: Signer,
): Promise<V209OrdinaryWorkerRequest> {
  if (
    !ID.test(input.accountId) ||
    !ID.test(input.workspaceId) ||
    !ID.test(input.attemptId) ||
    input.work.length < 1
  )
    fail();
  await validateAndHashHostedContractDocument("serverlessWorkerJobEnvelopeV3", input.envelope);

  const expectedTransferIds =
    input.lane === "mage_image"
      ? input.work.map((item) => id(item.outputReservationId))
      : [
          id(input.avatarSourceInputReservationId),
          ...input.work.map((item) => id(item.spanAudioInputReservationId)),
          ...input.work.map((item) => id(item.outputReservationId)),
        ];
  assertEnvelope(input, expectedTransferIds);
  if (input.lane === "mage_image") {
    for (const item of input.work) magePrompt(item);
  } else {
    const first = input.work[0]!;
    const avatarAssetId = id(first.avatarSourceAssetId);
    const avatarObjectKey = text(first.avatarSourceObjectKey);
    const avatarSha256 = sha(first.avatarSourceSha256);
    if (
      first.avatarSourceContentType !== "image/png" ||
      integer(first.avatarSourceContentLength, 1) < 1 ||
      input.work.some(
        (item) =>
          item.avatarSourceAssetId !== avatarAssetId ||
          item.avatarSourceObjectKey !== avatarObjectKey ||
          item.avatarSourceSha256 !== avatarSha256 ||
          item.avatarSourceContentType !== "image/png" ||
          item.avatarSourceContentLength !== first.avatarSourceContentLength ||
          item.spanAudioContentType !== "audio/wav" ||
          item.spanAudioSampleRateHz !== 48_000 ||
          item.spanAudioChannels !== 1 ||
          integer(item.paddedSamples48k, 1) < 1 ||
          integer(item.trimStartSample48k) < 0 ||
          integer(item.trimEndSampleExclusive48k, 1) <= Number(item.trimStartSample48k) ||
          Number(item.trimEndSampleExclusive48k) > Number(item.paddedSamples48k),
      )
    )
      fail();
  }

  let batch: RecordValue;
  let inputPorts: readonly Awaited<ReturnType<typeof inputPort>>[] = [];
  const outputs = await Promise.all(
    input.work.map((item) =>
      outputPort(
        input,
        signer,
        item,
        input.lane === "mage_image" ? "image/png" : "video/mp4",
        input.lane === "mage_image" ? MAX_MAGE_OUTPUT_BYTES : MAX_SOULX_OUTPUT_BYTES,
      ),
    ),
  );

  if (input.lane === "mage_image") {
    batch = {
      attempt_id: input.attemptId,
      model_revision: MAGE_MODEL_REVISION,
      items: input.work.map((item, index) => {
        const prompt = magePrompt(item);
        return {
          scene_id: id(item.taskId),
          positive_prompt: prompt.positive,
          positive_prompt_sha256: sha(item.positivePromptSha256),
          negative_prompt: prompt.negative,
          negative_prompt_sha256: sha(item.negativePromptSha256),
          seed: 2_130_000 + index,
          width: 1280,
          height: 720,
          output_put_url: outputs[index]!.url,
        };
      }),
    };
  } else {
    const first = input.work[0]!;
    const avatarReservationId = id(input.avatarSourceInputReservationId);
    const avatar = {
      reservationId: avatarReservationId,
      objectKey: text(first.avatarSourceObjectKey),
      contentType: text(first.avatarSourceContentType),
      contentLength: integer(first.avatarSourceContentLength, 1),
      checksumSha256: sha(first.avatarSourceSha256),
    };
    const spanArtifacts = input.work.map((item) => ({
      reservationId: id(item.spanAudioInputReservationId),
      objectKey: text(item.spanAudioObjectKey),
      contentType: text(item.spanAudioContentType),
      contentLength: integer(item.spanAudioContentLength, 1),
      checksumSha256: sha(item.spanAudioSha256),
    }));
    inputPorts = await Promise.all([
      inputPort(input, signer, avatar),
      ...spanArtifacts.map((artifact) => inputPort(input, signer, artifact)),
    ]);
    batch = v209OrdinarySoulXBatch(
      input.attemptId,
      input.avatarSourceInputReservationId,
      input.work,
    );
  }

  const transferIds = [
    ...inputPorts.map((port) => port.authority.reservation_id),
    ...outputs.map((port) => port.authority.reservation_id),
  ];
  if (JSON.stringify(transferIds) !== JSON.stringify(expectedTransferIds)) fail();
  const body = Object.freeze({
    envelope: input.envelope,
    batch: Object.freeze(batch),
    ports: Object.freeze({
      inputs: Object.freeze(inputPorts.map((port) => port.authority)),
      ...(input.lane === "mage_image" ? { outputs: Object.freeze([]) } : {}),
    }),
    input_get_urls: Object.freeze(inputPorts.map((port) => port.url)),
    generated_output_authorities: Object.freeze(outputs.map((port) => port.authority)),
    output_put_urls: Object.freeze(outputs.map((port) => port.url)),
  });
  return Object.freeze({
    body,
    requestBodySha256: canonicalSha256(body as object) as Sha256,
  });
}
