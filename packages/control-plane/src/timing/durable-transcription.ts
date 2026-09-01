import { createHash } from "node:crypto";

import {
  canonicalizeJson,
  sha256CanonicalJson,
  validateAndHashContractDocument,
} from "@videoforge/contracts";
import type { JsonValue, Sha256Digest } from "@videoforge/contracts";
import type { ContractDocumentValidationAuthority } from "@videoforge/contracts";

import type { ArtifactMetadata } from "../repositories/artifacts.js";
import type { AcceptedAttemptResult } from "../repositories/execution.js";
import type { PersistedTranscriptTiming } from "../repositories/timing.js";
import {
  deterministicIdempotencyKey,
  type DeterministicIdempotencyKey,
  type JsonObject,
  type RepositoryResult,
  type Sha256,
  type WorkspaceActorScope,
} from "../repositories/types.js";
import type { ControlPlaneRepositories, RepositorySession } from "../repositories/unit-of-work.js";

export type DurableTranscriptionErrorCode =
  | "ASR_INPUT_MISMATCH"
  | "ASR_RESULT_NOT_SUCCESSFUL"
  | "ASR_RESULT_MISMATCH"
  | "TRANSCRIPT_DERIVATION_INVALID";

export class DurableTranscriptionError extends Error {
  public constructor(
    public readonly code: DurableTranscriptionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DurableTranscriptionError";
  }
}

export interface CanonicalDocumentWrite {
  readonly objectKey: string;
  readonly bytes: Uint8Array;
  readonly binarySha256: Sha256;
}

export interface CanonicalDocumentWriteResult {
  readonly objectKey: string;
  readonly binarySha256: Sha256;
  readonly byteSize: bigint;
  readonly replayed: boolean;
}

/** Content-addressed storage boundary. A failed database transaction may leave only harmless bytes. */
export interface CanonicalDocumentObjectStore {
  putIfAbsent(write: CanonicalDocumentWrite): Promise<CanonicalDocumentWriteResult>;
}

export interface AcceptLocalTranscriptionCommand {
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly expectedHeadVersion: number;
  readonly lineageSequence: number;
  readonly supersedesTranscriptId: string | null;
  readonly optionalScriptHash: Sha256 | null;
  readonly asrInput: unknown;
  readonly asrResult: unknown;
  readonly finishedAt: string;
}

export interface PreparedLocalTranscription {
  readonly asrInputHash: Sha256;
  readonly asrResultHash: Sha256;
  readonly transcriptId: string;
  readonly transcriptDocumentAssetId: string;
  readonly transcriptDocumentHash: Sha256;
  readonly transcriptionConfigHash: Sha256;
  readonly inputFingerprintHash: Sha256;
  readonly canonicalDocumentWrite: CanonicalDocumentWrite;
  readonly artifactRegistration: Parameters<RepositorySession["artifacts"]["registerMetadata"]>[1];
  readonly artifactBinding: Parameters<RepositorySession["artifacts"]["bindCanonicalDocument"]>[1];
  readonly recordSuccessfulResult: Parameters<
    RepositorySession["execution"]["recordSuccessfulResult"]
  >[1];
  readonly transcriptPersistence: Parameters<
    RepositorySession["timing"]["persistTranscriptTiming"]
  >[1];
}

export interface AcceptedLocalTranscription {
  readonly transcript: PersistedTranscriptTiming;
  readonly artifact: ArtifactMetadata;
  readonly acceptedAttempt: AcceptedAttemptResult;
  readonly asrInputHash: Sha256;
  readonly asrResultHash: Sha256;
  readonly transcriptionConfigHash: Sha256;
  readonly inputFingerprintHash: Sha256;
  readonly canonicalDocumentObjectKey: string;
  readonly replayed: boolean;
}

type DurableTranscriptionResult = RepositoryResult<
  AcceptedLocalTranscription,
  string,
  string,
  string
>;

const asSha256 = (value: Sha256Digest): Sha256 => value as Sha256;

function stableUuid(namespace: string, ...parts: readonly string[]): string {
  const bytes = createHash("sha256")
    .update([namespace, ...parts].join("\u0000"))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableKey(prefix: string, hash: Sha256): DeterministicIdempotencyKey {
  return deterministicIdempotencyKey(`${prefix}:${hash.slice("sha256:".length)}`);
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DurableTranscriptionError("ASR_RESULT_MISMATCH", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DurableTranscriptionError("ASR_RESULT_MISMATCH", `${label} must be a string.`);
  }
  return value;
}

function integerValue(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new DurableTranscriptionError("ASR_RESULT_MISMATCH", `${label} must be an integer.`);
  }
  return value as number;
}

function jsonObject(value: JsonValue): JsonObject {
  return value as JsonObject;
}

function deriveSentenceAndPhraseRecords(
  transcriptId: string,
  words: readonly Record<string, unknown>[],
  phrases: readonly Record<string, unknown>[],
): {
  readonly sentences: PreparedLocalTranscription["transcriptPersistence"]["sentences"];
  readonly phrases: PreparedLocalTranscription["transcriptPersistence"]["phrases"];
} {
  const sentenceGroups: Array<{
    readonly key: string;
    readonly phrases: Array<{ readonly value: Record<string, unknown>; readonly index: number }>;
  }> = [];
  const closedSentenceKeys = new Set<string>();
  let current: (typeof sentenceGroups)[number] | undefined;

  for (const [index, phrase] of phrases.entries()) {
    const key = stringValue(phrase.sentence_id, `transcript.phrases[${index}].sentence_id`);
    if (current?.key !== key) {
      if (closedSentenceKeys.has(key)) {
        throw new DurableTranscriptionError(
          "TRANSCRIPT_DERIVATION_INVALID",
          "A sentence identifier cannot reappear after a later sentence begins.",
        );
      }
      if (current !== undefined) closedSentenceKeys.add(current.key);
      current = { key, phrases: [] };
      sentenceGroups.push(current);
    }
    current.phrases.push({ value: phrase, index });
  }

  const sentenceIdByKey = new Map<string, string>();
  const sentenceRecords = sentenceGroups.map((group, index) => {
    const first = group.phrases[0]?.value;
    const last = group.phrases.at(-1)?.value;
    if (first === undefined || last === undefined) {
      throw new DurableTranscriptionError(
        "TRANSCRIPT_DERIVATION_INVALID",
        "Every sentence must contain at least one phrase.",
      );
    }
    const wordStart = integerValue(first.word_start, `sentence ${group.key} word start`);
    const wordEndExclusive = integerValue(
      last.word_end_exclusive,
      `sentence ${group.key} word end`,
    );
    const sentenceId = stableUuid("videoforge:transcript-sentence:v1", transcriptId, group.key);
    sentenceIdByKey.set(group.key, sentenceId);
    return Object.freeze({
      sentenceId,
      sentenceKey: group.key,
      index,
      wordStart,
      wordEndExclusive,
      startMs: integerValue(words[wordStart]?.start_ms, `sentence ${group.key} start`),
      endMsExclusive: integerValue(
        words[wordEndExclusive - 1]?.end_ms,
        `sentence ${group.key} end`,
      ),
      text: words
        .slice(wordStart, wordEndExclusive)
        .map((word, wordIndex) => stringValue(word.text, `sentence ${group.key} word ${wordIndex}`))
        .join(" "),
    });
  });

  const phraseRecords = phrases.map((phrase, index) => {
    const phraseKey = stringValue(phrase.phrase_id, `transcript.phrases[${index}].phrase_id`);
    const sentenceKey = stringValue(phrase.sentence_id, `transcript.phrases[${index}].sentence_id`);
    const sentenceId = sentenceIdByKey.get(sentenceKey);
    if (sentenceId === undefined) {
      throw new DurableTranscriptionError(
        "TRANSCRIPT_DERIVATION_INVALID",
        "A phrase does not belong to a derived sentence.",
      );
    }
    return Object.freeze({
      phraseId: stableUuid("videoforge:transcript-phrase:v1", transcriptId, phraseKey),
      phraseKey,
      sentenceId,
      index,
      wordStart: integerValue(phrase.word_start, `phrase ${phraseKey} word start`),
      wordEndExclusive: integerValue(phrase.word_end_exclusive, `phrase ${phraseKey} word end`),
      startMs: integerValue(phrase.start_ms, `phrase ${phraseKey} start`),
      endMsExclusive: integerValue(phrase.end_ms, `phrase ${phraseKey} end`),
      pauseBeforeMs: integerValue(phrase.pause_before_ms, `phrase ${phraseKey} pause before`),
      pauseAfterMs: integerValue(phrase.pause_after_ms, `phrase ${phraseKey} pause after`),
      text: stringValue(phrase.text, `phrase ${phraseKey} text`),
    });
  });

  return {
    sentences: Object.freeze(sentenceRecords),
    phrases: Object.freeze(phraseRecords),
  };
}

export async function prepareDurableLocalTranscription(
  scope: WorkspaceActorScope,
  command: AcceptLocalTranscriptionCommand,
  contractDocumentAuthority?: ContractDocumentValidationAuthority,
): Promise<PreparedLocalTranscription> {
  const validateAndHash = contractDocumentAuthority?.validateAndHash.bind(
    contractDocumentAuthority,
  ) ?? validateAndHashContractDocument;
  const input = await validateAndHash("asrJobInput", command.asrInput);
  const result = await validateAndHash("asrJobResult", command.asrResult);
  const inputValue = objectValue(input.value, "ASR input");
  const resultValue = objectValue(result.value, "ASR result");
  const inputVoiceover = objectValue(inputValue.voiceover, "ASR input voiceover");
  const inputModel = objectValue(inputValue.model, "ASR input model");
  const inputOptions = objectValue(inputValue.options, "ASR input options");

  if (
    inputValue.project_revision_id !== command.projectRevisionId ||
    inputValue.attempt_id !== command.attemptId
  ) {
    throw new DurableTranscriptionError(
      "ASR_INPUT_MISMATCH",
      "The ASR input does not belong to the selected revision and attempt.",
    );
  }
  if (resultValue.status !== "SUCCEEDED" || resultValue.transcript === null) {
    throw new DurableTranscriptionError(
      "ASR_RESULT_NOT_SUCCESSFUL",
      "Only a successful local ASR result can enter durable timing lineage.",
    );
  }

  const transcriptDocument = await validateAndHash(
    "transcriptTiming",
    resultValue.transcript,
  );
  const transcript = objectValue(transcriptDocument.value, "ASR transcript");
  const transcriptSource = objectValue(transcript.source, "transcript source");
  const transcriptEngine = objectValue(transcript.engine, "transcript engine");
  const diagnostics = objectValue(resultValue.diagnostics, "ASR diagnostics");

  if (
    resultValue.attempt_id !== command.attemptId ||
    resultValue.source_voiceover_sha256 !== inputVoiceover.sha256 ||
    resultValue.model_sha256 !== inputModel.sha256 ||
    transcript.project_revision_id !== command.projectRevisionId ||
    transcriptSource.asset_id !== inputVoiceover.asset_id ||
    transcriptSource.sha256 !== inputVoiceover.sha256 ||
    transcriptSource.duration_ms !== diagnostics.source_duration_ms ||
    transcriptEngine.name !== inputModel.engine ||
    transcriptEngine.model_name !== inputModel.name ||
    transcriptEngine.model_sha256 !== inputModel.sha256 ||
    transcriptEngine.language !== inputModel.language ||
    transcriptEngine.version !== diagnostics.tool_version
  ) {
    throw new DurableTranscriptionError(
      "ASR_RESULT_MISMATCH",
      "The ASR result does not match its exact attempt, source, model, or tool facts.",
    );
  }

  const transcriptionConfigHash = asSha256(
    await sha256CanonicalJson({
      schema_version: "local-transcription-config/v1",
      engine_name: transcriptEngine.name as string,
      engine_version: transcriptEngine.version as string,
      model_name: transcriptEngine.model_name as string,
      model_sha256: transcriptEngine.model_sha256 as string,
      language: transcriptEngine.language as string,
      options: inputOptions as JsonValue,
    }),
  );
  const inputFingerprintHash = asSha256(
    await sha256CanonicalJson({
      schema_version: "local-transcription-input-fingerprint/v1",
      project_revision_id: command.projectRevisionId,
      source_asset_id: inputVoiceover.asset_id as string,
      source_binary_sha256: inputVoiceover.sha256 as string,
      source_duration_ms: transcriptSource.duration_ms as number,
      transcription_config_hash: transcriptionConfigHash,
      optional_script_hash: command.optionalScriptHash,
    }),
  );
  const transcriptId = stableUuid(
    "videoforge:durable-transcript:v1",
    command.projectRevisionId,
    inputFingerprintHash,
  );
  const transcriptDocumentAssetId = stableUuid(
    "videoforge:transcript-document:v1",
    command.projectRevisionId,
    transcriptDocument.sha256,
  );
  const words = (transcript.words as readonly Record<string, unknown>[]).map((word, index) =>
    Object.freeze({
      wordId: stableUuid("videoforge:transcript-word:v1", transcriptId, String(index)),
      index: integerValue(word.index, `transcript.words[${index}].index`),
      text: stringValue(word.text, `transcript.words[${index}].text`),
      startMs: integerValue(word.start_ms, `transcript.words[${index}].start_ms`),
      endMsExclusive: integerValue(word.end_ms, `transcript.words[${index}].end_ms`),
      confidence:
        word.confidence === null
          ? null
          : typeof word.confidence === "number"
            ? word.confidence
            : (() => {
                throw new DurableTranscriptionError(
                  "TRANSCRIPT_DERIVATION_INVALID",
                  `transcript.words[${index}].confidence must be numeric or null.`,
                );
              })(),
    }),
  );
  const derived = deriveSentenceAndPhraseRecords(
    transcriptId,
    words.map((word) => ({
      start_ms: word.startMs,
      end_ms: word.endMsExclusive,
      text: word.text,
    })),
    transcript.phrases as readonly Record<string, unknown>[],
  );

  const canonicalBytes = new TextEncoder().encode(canonicalizeJson(transcriptDocument.value));
  const transcriptDocumentHash = asSha256(transcriptDocument.sha256);
  const asrInputHash = asSha256(input.sha256);
  const asrResultHash = asSha256(result.sha256);
  const digest = transcriptDocumentHash.slice("sha256:".length);
  const objectKey = `workspace/${scope.workspaceId}/project/${command.projectId}/revision/${command.projectRevisionId}/transcript/${digest}.json`;
  const artifactKey = stableKey("local-asr-artifact", inputFingerprintHash);
  const finishedAt = command.finishedAt;
  const transcriptPayload = jsonObject(transcriptDocument.value);

  return Object.freeze({
    asrInputHash,
    asrResultHash,
    transcriptId,
    transcriptDocumentAssetId,
    transcriptDocumentHash,
    transcriptionConfigHash,
    inputFingerprintHash,
    canonicalDocumentWrite: Object.freeze({
      objectKey,
      bytes: canonicalBytes,
      binarySha256: transcriptDocumentHash,
    }),
    artifactRegistration: Object.freeze({
      idempotencyKey: artifactKey,
      assetId: transcriptDocumentAssetId,
      projectId: command.projectId,
      projectRevisionId: command.projectRevisionId,
      sourceAttemptId: command.attemptId,
      kind: "CANONICAL_DOCUMENT" as const,
      objectKey,
      contentType: "application/json",
      metadata: Object.freeze({
        worker: "image-media",
        job_type: "ASR",
        dispatch_target: "LOCAL",
        asr_input_hash: asrInputHash,
        asr_result_hash: asrResultHash,
        transcription_config_hash: transcriptionConfigHash,
        input_fingerprint_hash: inputFingerprintHash,
      }),
    }),
    artifactBinding: Object.freeze({
      idempotencyKey: stableKey("local-asr-artifact-bind", inputFingerprintHash),
      assetId: transcriptDocumentAssetId,
      contractName: "transcript-timing",
      contractVersion: "v1",
      canonicalDocumentSha256: transcriptDocumentHash,
      binarySha256: transcriptDocumentHash,
      byteSize: BigInt(canonicalBytes.byteLength),
      verifiedAt: finishedAt,
    }),
    recordSuccessfulResult: Object.freeze({
      idempotencyKey: stableKey("local-asr-result", inputFingerprintHash),
      taskId: command.taskId,
      attemptId: command.attemptId,
      outputAssetId: transcriptDocumentAssetId,
      outputBinarySha256: transcriptDocumentHash,
      providerDetails: Object.freeze({
        dispatch_target: "LOCAL",
        worker: "image-media",
        job_type: "ASR",
        asr_input_hash: asrInputHash,
        asr_result_hash: asrResultHash,
        model_sha256: stringValue(inputModel.sha256, "ASR model SHA-256"),
      }),
      finishedAt,
    }),
    transcriptPersistence: Object.freeze({
      idempotencyKey: stableKey("local-asr-transcript", inputFingerprintHash),
      projectId: command.projectId,
      projectRevisionId: command.projectRevisionId,
      expectedHeadVersion: command.expectedHeadVersion,
      transcriptId,
      lineageSequence: command.lineageSequence,
      supersedesTranscriptId: command.supersedesTranscriptId,
      sourceAssetId: stringValue(inputVoiceover.asset_id, "ASR source asset ID"),
      sourceBinarySha256: stringValue(inputVoiceover.sha256, "ASR source SHA-256") as Sha256,
      sourceDurationMs: integerValue(transcriptSource.duration_ms, "ASR source duration"),
      engineName: stringValue(transcriptEngine.name, "ASR engine name"),
      engineVersion: stringValue(transcriptEngine.version, "ASR engine version"),
      modelName: stringValue(transcriptEngine.model_name, "ASR model name"),
      modelSha256: stringValue(transcriptEngine.model_sha256, "ASR model SHA-256") as Sha256,
      language: stringValue(transcriptEngine.language, "ASR language"),
      transcriptionConfigHash,
      optionalScriptHash: command.optionalScriptHash,
      inputFingerprintHash,
      canonicalDocumentAssetId: transcriptDocumentAssetId,
      canonicalDocument: Object.freeze({
        contractName: "transcript-timing",
        contractVersion: "v1",
        payload: transcriptPayload,
        canonicalDocumentSha256: transcriptDocumentHash,
      }),
      words: Object.freeze(words),
      sentences: derived.sentences,
      phrases: derived.phrases,
      createdAt: finishedAt,
    }),
  });
}

function propagateFailure<Value>(
  result: RepositoryResult<Value, string, string, string>,
): RepositoryResult<never, string, string, string> {
  if (result.ok) throw new TypeError("cannot propagate a successful repository result");
  return result;
}

export class DurableLocalTranscriptionPersistence {
  public constructor(
    private readonly repositories: ControlPlaneRepositories,
    private readonly objects: CanonicalDocumentObjectStore,
  ) {}

  public async accept(
    scope: WorkspaceActorScope,
    command: AcceptLocalTranscriptionCommand,
  ): Promise<DurableTranscriptionResult> {
    const prepared = await prepareDurableLocalTranscription(scope, command);
    const stored = await this.objects.putIfAbsent(prepared.canonicalDocumentWrite);
    if (
      stored.objectKey !== prepared.canonicalDocumentWrite.objectKey ||
      stored.binarySha256 !== prepared.canonicalDocumentWrite.binarySha256 ||
      stored.byteSize !== BigInt(prepared.canonicalDocumentWrite.bytes.byteLength)
    ) {
      throw new Error("canonical document store returned mismatched immutable object facts");
    }

    const committed = await this.repositories.unitOfWork.execute<
      AcceptedLocalTranscription,
      string,
      string,
      string
    >(scope, async (repositories) => {
      const registered = await repositories.artifacts.registerMetadata(
        scope,
        prepared.artifactRegistration,
      );
      if (!registered.ok) return propagateFailure(registered);
      const bound = await repositories.artifacts.bindCanonicalDocument(
        scope,
        prepared.artifactBinding,
      );
      if (!bound.ok) return propagateFailure(bound);
      const successful = await repositories.execution.recordSuccessfulResult(
        scope,
        prepared.recordSuccessfulResult,
      );
      if (!successful.ok) return propagateFailure(successful);
      const accepted = await repositories.execution.acceptSuccessfulResult(scope, {
        idempotencyKey: stableKey("local-asr-accept", prepared.inputFingerprintHash),
        candidateReference: successful.value.value.reference,
        acceptedAt: command.finishedAt,
      });
      if (!accepted.ok) return propagateFailure(accepted);
      const transcript = await repositories.timing.persistTranscriptTiming(
        scope,
        prepared.transcriptPersistence,
      );
      if (!transcript.ok) return propagateFailure(transcript);

      return {
        ok: true,
        value: Object.freeze({
          transcript: transcript.value.value,
          artifact: bound.value.value,
          acceptedAttempt: accepted.value.value,
          asrInputHash: prepared.asrInputHash,
          asrResultHash: prepared.asrResultHash,
          transcriptionConfigHash: prepared.transcriptionConfigHash,
          inputFingerprintHash: prepared.inputFingerprintHash,
          canonicalDocumentObjectKey: stored.objectKey,
          replayed:
            stored.replayed &&
            registered.value.replayed &&
            bound.value.replayed &&
            successful.value.replayed &&
            accepted.value.replayed &&
            transcript.value.replayed,
        }),
      };
    });
    return committed;
  }
}
