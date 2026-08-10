import Ajv2020 from "ajv/dist/2020.js";
import type { AnySchemaObject, ErrorObject, ValidateFunction } from "ajv";

import {
  canonicalSchemaDocuments,
  contractNames,
  contractSchemaIds,
  type ContractDocument,
  type ContractName,
} from "./schemas.js";

export interface ContractValidationIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params: Readonly<Record<string, unknown>>;
}

export interface ContractValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ContractValidationFailure {
  success: false;
  issues: readonly ContractValidationIssue[];
}

export type ContractValidationResult<T> = ContractValidationSuccess<T> | ContractValidationFailure;

export class ContractValidationError extends Error {
  readonly contractName: ContractName;
  readonly issues: readonly ContractValidationIssue[];

  constructor(contractName: ContractName, issues: readonly ContractValidationIssue[]) {
    super(
      `Invalid ${contractName} contract (${issues.length} issue${issues.length === 1 ? "" : "s"}).`,
    );
    this.name = "ContractValidationError";
    this.contractName = contractName;
    this.issues = issues;
  }
}

export function createContractAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const contractName of contractNames) {
    ajv.addSchema(canonicalSchemaDocuments[contractName] as unknown as AnySchemaObject);
  }
  return ajv;
}

const ajv = createContractAjv();

export const contractValidators = Object.freeze(
  Object.fromEntries(
    contractNames.map((contractName) => {
      const validator = ajv.getSchema(contractSchemaIds[contractName]);
      if (!validator) throw new Error(`Ajv did not register ${contractSchemaIds[contractName]}.`);
      return [contractName, validator];
    }),
  ) as Record<ContractName, ValidateFunction>,
);

const normalizeIssues = (
  errors: ErrorObject[] | null | undefined,
): readonly ContractValidationIssue[] =>
  (errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? "Schema validation failed.",
    params: error.params as Readonly<Record<string, unknown>>,
  }));

const semanticIssue = (instancePath: string, message: string): ContractValidationIssue => ({
  instancePath,
  schemaPath: "#/$semantic",
  keyword: "semantic",
  message,
  params: {},
});

const transcriptTimingIssues = (
  transcript: ContractDocument<"transcriptTiming">,
  prefix = "",
): readonly ContractValidationIssue[] => {
  const issues: ContractValidationIssue[] = [];
  let previousWordEnd = 0;
  for (const [index, word] of transcript.words.entries()) {
    const wordPath = `${prefix}/words/${index}`;
    if (word.index !== index) {
      issues.push(
        semanticIssue(`${wordPath}/index`, "Word indices must be contiguous and zero-based."),
      );
    }
    if (word.start_ms >= word.end_ms) {
      issues.push(semanticIssue(wordPath, "Word start_ms must be before end_ms."));
    }
    if (index > 0 && word.start_ms < previousWordEnd) {
      issues.push(
        semanticIssue(`${wordPath}/start_ms`, "Words must not overlap or move backward."),
      );
    }
    if (word.end_ms > transcript.source.duration_ms) {
      issues.push(semanticIssue(`${wordPath}/end_ms`, "Words must stay within source duration."));
    }
    previousWordEnd = word.end_ms;
  }

  let expectedWordStart = 0;
  for (const [index, phrase] of transcript.phrases.entries()) {
    const phrasePath = `${prefix}/phrases/${index}`;
    if (phrase.word_start !== expectedWordStart) {
      issues.push(
        semanticIssue(`${phrasePath}/word_start`, "Phrases must cover words contiguously."),
      );
    }
    if (
      phrase.word_end_exclusive <= phrase.word_start ||
      phrase.word_end_exclusive > transcript.words.length
    ) {
      issues.push(
        semanticIssue(phrasePath, "Phrase word bounds must identify a non-empty word span."),
      );
    } else {
      const firstWord = transcript.words[phrase.word_start]!;
      const lastWord = transcript.words[phrase.word_end_exclusive - 1]!;
      if (phrase.start_ms !== firstWord.start_ms || phrase.end_ms !== lastWord.end_ms) {
        issues.push(semanticIssue(phrasePath, "Phrase timing must bind exactly to its word span."));
      }
    }
    if (phrase.start_ms >= phrase.end_ms) {
      issues.push(semanticIssue(phrasePath, "Phrase start_ms must be before end_ms."));
    }
    expectedWordStart = phrase.word_end_exclusive;
  }
  if (expectedWordStart !== transcript.words.length) {
    issues.push(
      semanticIssue(`${prefix}/phrases`, "Phrases must cover every transcript word once."),
    );
  }
  return issues;
};

const semanticContractIssues = <Name extends ContractName>(
  contractName: Name,
  value: ContractDocument<Name>,
): readonly ContractValidationIssue[] => {
  if (contractName === "transcriptTiming") {
    return transcriptTimingIssues(value as ContractDocument<"transcriptTiming">);
  }
  if (contractName === "asrJobResult") {
    const result = value as ContractDocument<"asrJobResult">;
    if (result.status !== "SUCCEEDED") return [];
    return [
      ...transcriptTimingIssues(result.transcript, "/transcript"),
      ...(result.source_voiceover_sha256 === result.transcript.source.sha256
        ? []
        : [
            semanticIssue(
              "/source_voiceover_sha256",
              "Result source hash must match the transcript source hash.",
            ),
          ]),
      ...(result.model_sha256 === result.transcript.engine.model_sha256
        ? []
        : [
            semanticIssue(
              "/model_sha256",
              "Result model hash must match the transcript model hash.",
            ),
          ]),
      ...(result.diagnostics.source_duration_ms === result.transcript.source.duration_ms
        ? []
        : [
            semanticIssue(
              "/diagnostics/source_duration_ms",
              "Diagnostic duration must match the transcript source duration.",
            ),
          ]),
    ];
  }
  if (contractName === "renderJobResult") {
    const result = value as ContractDocument<"renderJobResult">;
    if (result.status !== "SUCCEEDED") return [];
    const issues: ContractValidationIssue[] = [];
    for (const field of ["asset_id", "sha256", "bytes"] as const) {
      if (result.output[field] !== result.probe[field]) {
        issues.push(
          semanticIssue(
            `/output/${field}`,
            `Render output ${field} must match its technical probe.`,
          ),
        );
      }
    }
    return issues;
  }
  if (contractName === "resolvedRenderManifest") {
    const manifest = value as ContractDocument<"resolvedRenderManifest">;
    const expectedSuffix = manifest.render_profile_version === "ffmpeg-render-v2" ? "v2" : "v1";
    const issues: ContractValidationIssue[] = [];
    for (const [index, segment] of manifest.segments.entries()) {
      if (
        segment.timeline_composition === "IMAGE_FULL" &&
        segment.render.zoom_profile !== `image-full-zoom-${expectedSuffix}`
      ) {
        issues.push(
          semanticIssue(
            `/segments/${index}/render/zoom_profile`,
            "Full-image zoom profile must match the render profile version.",
          ),
        );
      }
      if (
        segment.timeline_composition === "AVATAR_SPLIT_IMAGE" &&
        segment.render.right_image_zoom_profile !== `split-right-zoom-${expectedSuffix}`
      ) {
        issues.push(
          semanticIssue(
            `/segments/${index}/render/right_image_zoom_profile`,
            "Split-image zoom profile must match the render profile version.",
          ),
        );
      }
    }
    return issues;
  }
  return [];
};

export function validateContract<Name extends ContractName>(
  contractName: Name,
  value: unknown,
): ContractValidationResult<ContractDocument<Name>>;
export function validateContract(
  contractName: ContractName,
  value: unknown,
): ContractValidationResult<ContractDocument<ContractName>> {
  const validator = contractValidators[contractName];
  if (validator(value)) {
    const data = value as ContractDocument<ContractName>;
    const issues = semanticContractIssues(contractName, data);
    if (issues.length > 0) return { success: false, issues };
    return { success: true, data };
  }
  return { success: false, issues: normalizeIssues(validator.errors) };
}

export function assertContract<Name extends ContractName>(
  contractName: Name,
  value: unknown,
): ContractDocument<Name> {
  const result = validateContract(contractName, value);
  if (!result.success) throw new ContractValidationError(contractName, result.issues);
  return result.data;
}
