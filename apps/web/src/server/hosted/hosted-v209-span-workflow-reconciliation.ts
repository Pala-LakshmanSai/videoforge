import type { JsonValue } from "@videoforge/contracts";

import type { HostedR2BucketBinding } from "./configuration";
import { sha256Bytes } from "./crypto";

const DATABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const RESULT_OBJECT_KEY =
  /^tenant\/([^/]+)\/workspace\/([^/]+)\/project\/([^/]+)\/revision\/([^/]+)\/lane\/input\/job\/([^/]+)\/artifact\/result-document$/u;

export interface HostedV209SpanTerminalProjection {
  readonly attemptId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly kind: string;
  readonly state: string;
  readonly resultObjectKey: string | null;
  readonly resultContentLength: number | null;
  readonly resultChecksumSha256: string | null;
}

export interface HostedV209SpanWorkflowDependencies {
  readonly bucket: HostedR2BucketBinding;
  readonly finalize: (input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly attemptId: string;
    readonly resultDocument: JsonValue;
  }) => Promise<unknown>;
  readonly resumePair: (identity: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly projectId: string;
  }) => Promise<void>;
}

export type HostedV209SpanWorkflowReconciliation =
  | { readonly state: "NOT_SPAN_AUDIO" }
  | { readonly state: "FINALIZATION_PENDING" }
  | { readonly state: "FINALIZED"; readonly pairResumed: boolean };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactTerminal(terminal: HostedV209SpanTerminalProjection) {
  const key =
    terminal.resultObjectKey === null ? null : RESULT_OBJECT_KEY.exec(terminal.resultObjectKey);
  if (
    terminal.kind !== "SPAN_AUDIO" ||
    terminal.state !== "SUCCEEDED" ||
    ![terminal.attemptId, terminal.accountId, terminal.workspaceId].every((value) =>
      DATABASE_UUID.test(value),
    ) ||
    !key ||
    key[1] !== terminal.accountId ||
    key[2] !== terminal.workspaceId ||
    key[5] !== terminal.attemptId ||
    terminal.resultContentLength === null ||
    !Number.isSafeInteger(terminal.resultContentLength) ||
    terminal.resultContentLength < 1 ||
    terminal.resultContentLength > 1_048_576 ||
    terminal.resultChecksumSha256 === null ||
    !SHA256.test(terminal.resultChecksumSha256)
  ) {
    throw new Error("HOSTED_V209_SPAN_TERMINAL_INVALID");
  }
  return {
    objectKey: terminal.resultObjectKey as string,
    contentLength: terminal.resultContentLength,
    checksumSha256: terminal.resultChecksumSha256,
  };
}

function exactFinalization(
  value: unknown,
  terminal: HostedV209SpanTerminalProjection,
): {
  readonly pairReady: boolean;
  readonly identity: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly projectId: string;
  };
} {
  const row = record(value);
  if (
    !row ||
    row.schemaVersion !== "videoforge.hosted-v209-span-audio-finalization/v1" ||
    row.accountId !== terminal.accountId ||
    row.workspaceId !== terminal.workspaceId ||
    row.attemptId !== terminal.attemptId ||
    typeof row.pairReady !== "boolean" ||
    ![row.userId, row.projectId].every(
      (identity) => typeof identity === "string" && DATABASE_UUID.test(identity),
    )
  ) {
    throw new Error("HOSTED_V209_SPAN_FINALIZATION_INVALID");
  }
  return {
    pairReady: row.pairReady,
    identity: {
      accountId: terminal.accountId,
      workspaceId: terminal.workspaceId,
      userId: row.userId as string,
      projectId: row.projectId as string,
    },
  };
}

async function reconcile(
  dependencies: HostedV209SpanWorkflowDependencies,
  terminal: HostedV209SpanTerminalProjection,
): Promise<
  Exclude<HostedV209SpanWorkflowReconciliation, { readonly state: "FINALIZATION_PENDING" }>
> {
  if (terminal.kind !== "SPAN_AUDIO" || terminal.state !== "SUCCEEDED") {
    return Object.freeze({ state: "NOT_SPAN_AUDIO" as const });
  }
  const expected = exactTerminal(terminal);
  const object = await dependencies.bucket.get(expected.objectKey);
  if (
    !object ||
    object.size !== expected.contentLength ||
    object.httpMetadata?.contentType !== "application/json"
  ) {
    throw new Error("HOSTED_V209_SPAN_RESULT_INVALID");
  }
  const bytes = await object.arrayBuffer();
  if (
    bytes.byteLength !== expected.contentLength ||
    (await sha256Bytes(bytes)) !== expected.checksumSha256
  ) {
    throw new Error("HOSTED_V209_SPAN_RESULT_INVALID");
  }
  let resultDocument: JsonValue;
  try {
    const decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
    if (!record(decoded)) throw new Error("HOSTED_V209_SPAN_RESULT_INVALID");
    resultDocument = decoded as JsonValue;
  } catch {
    throw new Error("HOSTED_V209_SPAN_RESULT_INVALID");
  }
  const finalized = exactFinalization(
    await dependencies.finalize({
      accountId: terminal.accountId,
      workspaceId: terminal.workspaceId,
      attemptId: terminal.attemptId,
      resultDocument,
    }),
    terminal,
  );
  if (finalized.pairReady) await dependencies.resumePair(finalized.identity);
  return Object.freeze({ state: "FINALIZED" as const, pairResumed: finalized.pairReady });
}

/**
 * A failed R2 read, finalization, or pair resume remains non-terminal. The enclosing Workflow owns
 * the bounded sleep/retry horizon, so a lost browser completion response cannot strand SPAN_AUDIO.
 */
export async function attemptHostedV209SpanWorkflowReconciliation(
  dependencies: HostedV209SpanWorkflowDependencies,
  terminal: HostedV209SpanTerminalProjection,
): Promise<HostedV209SpanWorkflowReconciliation> {
  try {
    return await reconcile(dependencies, terminal);
  } catch {
    return Object.freeze({ state: "FINALIZATION_PENDING" as const });
  }
}
