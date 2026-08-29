import { canonicalSha256, type TransactionalSqlExecutor } from "@videoforge/control-plane";
import { describe, expect, it } from "vitest";

import {
  createV213SqlCleanupReceiptFinalizer,
  V213_CLEANUP_RECEIPT_OPERATIONS,
  type V213CleanupReceiptPersistenceBoundary,
  type V213CleanupReceiptOperation,
} from "./v213-live-production-adapters.js";

const BOUNDARIES = Object.freeze([
  "BEFORE_INTENT_CLAIM",
  "AFTER_INTENT_CLAIM",
  "BEFORE_EVIDENCE_STORE",
  "AFTER_EVIDENCE_STORE",
  "BEFORE_RECEIPT_STORE",
  "AFTER_RECEIPT_STORE",
  "BEFORE_FACT_MATERIALIZATION",
  "AFTER_FACT_MATERIALIZATION",
] as const satisfies readonly V213CleanupReceiptPersistenceBoundary[]);

function durableDatabase() {
  const intents = new Map<string, Readonly<Record<string, unknown>>>();
  const evidence = new Map<string, Readonly<Record<string, unknown>>>();
  const receipts = new Map<string, Readonly<Record<string, unknown>>>();
  const facts = new Map<string, Readonly<Record<string, unknown>>>();
  const query = async (sql: string, values: readonly unknown[]) => {
    const supplied = JSON.parse(String(values[0])) as Record<string, unknown>;
    const operationId = String(supplied.operationId ?? supplied.completedOperationId ?? "");
    if (sql.includes("claim_v213_cleanup_receipt_intent")) {
      const intentDocument = Object.freeze({
        schemaVersion: "videoforge.v213-cleanup-receipt-intent/v1",
        fullLiveAuthorityId: supplied.fullLiveAuthorityId,
        operationId: supplied.operationId,
        outerStateSha256: supplied.outerStateSha256,
        providerCleanupEvidenceSha256: supplied.providerCleanupEvidenceSha256,
        receiptArtifactSha256: supplied.receiptArtifactSha256,
        receiptDocument: supplied.document,
      });
      const existing = intents.get(operationId);
      if (existing && canonicalSha256(existing) !== canonicalSha256(intentDocument))
        throw new Error("fixture intent drift");
      intents.set(operationId, existing ?? intentDocument);
      return {
        rows: [
          {
            value: {
              intentSha256: canonicalSha256(intentDocument),
              intentState: existing ? "ACK_UNKNOWN" : "NO_ATTEMPT",
              receiptArtifactSha256: supplied.receiptArtifactSha256,
            },
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("record_v213_signed_evidence")) {
      const key = String(supplied.artifactSha256);
      const existing = evidence.get(key);
      if (existing && canonicalSha256(existing) !== canonicalSha256(supplied))
        throw new Error("fixture evidence drift");
      evidence.set(key, existing ?? supplied);
      return { rows: [{ value: supplied.artifactSha256 }], rowCount: 1 };
    }
    if (sql.includes("load_v213_signed_evidence"))
      return { rows: [{ value: evidence.get(String(supplied.artifactSha256)) }], rowCount: 1 };
    if (sql.includes("record_v213_operation_receipt")) {
      const value = Object.freeze({
        artifactSha256: supplied.artifactSha256,
        operationId: supplied.operationId,
        document: supplied.document,
      });
      const existing = receipts.get(operationId);
      if (existing && canonicalSha256(existing) !== canonicalSha256(value))
        throw new Error("fixture receipt drift");
      receipts.set(operationId, existing ?? value);
      return { rows: [{ value: supplied.artifactSha256 }], rowCount: 1 };
    }
    if (sql.includes("read_v213_operation_receipt"))
      return { rows: [{ value: receipts.get(operationId) }], rowCount: 1 };
    if (
      sql.includes("materialize_v213_release_facts") ||
      sql.includes("read_v213_release_fact_materialization")
    ) {
      const unsigned = Object.freeze({
        schemaVersion: "videoforge.v213-release-fact-materialization/v1",
        fullLiveAuthorityId: supplied.fullLiveAuthorityId,
        completedOperationId: supplied.completedOperationId,
        completedEvidenceSha256: supplied.completedEvidenceSha256,
        releaseIdentitySha256: null,
        gateFactSha256s: {},
      });
      const value = Object.freeze({
        ...unsigned,
        materializationSha256: canonicalSha256(unsigned),
      });
      const existing = facts.get(operationId);
      if (existing && canonicalSha256(existing) !== canonicalSha256(value))
        throw new Error("fixture fact drift");
      if (sql.includes("materialize_v213_release_facts")) facts.set(operationId, existing ?? value);
      return { rows: [{ value: facts.get(operationId) }], rowCount: 1 };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  const database = {
    transaction: (work) => work({ query } as never),
  } as TransactionalSqlExecutor;
  return { database, evidence, facts, intents, receipts };
}

function request(operationId: V213CleanupReceiptOperation) {
  const summary = Object.freeze({ operationId, providerCleanup: "terminal-exact" });
  return Object.freeze({
    fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
    operationId,
    outerStateSha256: canonicalSha256({ operationId, outer: true }),
    providerCleanupEvidenceSha256: canonicalSha256(summary),
    summary,
    readbackOnly: false,
    failureCleanup: false,
  });
}

describe("V2-13 cleanup receipt crash recovery", () => {
  for (const operationId of V213_CLEANUP_RECEIPT_OPERATIONS) {
    it(`${operationId} resumes every DB persistence boundary without a second durable row`, async () => {
      for (const crashBoundary of BOUNDARIES) {
        const durable = durableDatabase();
        let injected = false;
        const first = createV213SqlCleanupReceiptFinalizer({
          database: durable.database,
          evidenceSigningKey: Buffer.alloc(32, 19),
          onPersistenceBoundary: (boundary) => {
            if (!injected && boundary === crashBoundary) {
              injected = true;
              throw new Error(`CRASH:${boundary}`);
            }
          },
        });
        await expect(first(request(operationId))).rejects.toThrow(`CRASH:${crashBoundary}`);

        const recoveredIntentStates: string[] = [];
        const recovered = createV213SqlCleanupReceiptFinalizer({
          database: durable.database,
          evidenceSigningKey: Buffer.alloc(32, 19),
          onPersistenceBoundary: (boundary, intentState) => {
            if (boundary === "AFTER_INTENT_CLAIM") recoveredIntentStates.push(String(intentState));
          },
        });
        await expect(
          recovered({ ...request(operationId), readbackOnly: true }),
        ).resolves.toMatchObject({ operationId, readbackOnly: true });
        expect(recoveredIntentStates).toEqual([
          crashBoundary === "BEFORE_INTENT_CLAIM" ? "NO_ATTEMPT" : "ACK_UNKNOWN",
        ]);
        expect(durable.intents.size).toBe(1);
        expect(durable.evidence.size).toBe(1);
        expect(durable.receipts.size).toBe(1);
        expect(durable.facts.size).toBe(1);
      }
    });
  }
});
