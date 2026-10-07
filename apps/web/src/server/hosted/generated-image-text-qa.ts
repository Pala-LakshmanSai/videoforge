import type { SqlPrimitive, TransactionalSqlExecutor } from "@videoforge/control-plane";
import { inspectGeneratedImageText } from "../providers/generated-image-text-qa";
import type { KieImageArtifact } from "../providers/kie-image-job";

/** Provider image remains SUBMITTED until its exact pixels have a durable PASS receipt. */
export function generatedImageTextQa(input: {
  readonly database: TransactionalSqlExecutor;
  readonly accountId: string;
  readonly apiKey?: string;
  readonly fetcher?: typeof fetch;
}) {
  const query = async (sql: string, values: readonly SqlPrimitive[]) => input.database.transaction(async (tx) => {
    await tx.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", input.accountId]);
    const result = await tx.query<{ value: unknown }>(sql, values);
    return result.rows[0]?.value;
  });
  return async (artifact: KieImageArtifact, bytes: Uint8Array): Promise<"PASS" | "TEXT" | "UNCERTAIN" | "PENDING"> => {
    const claim = await query("SELECT public.videoforge_claim_image_text_qa($1,$2,$3,$4) AS value",
      [artifact.objectKey, artifact.sha256, crypto.randomUUID(), Boolean(input.apiKey?.trim())]) as
      { id?: string; state?: string; dispatch?: boolean } | undefined;
    if (claim?.state === "HISTORICAL" || claim?.state === "PASS") return "PASS";
    if (claim?.state === "TEXT" || claim?.state === "UNCERTAIN") return claim.state;
    if (claim?.state !== "RESERVED" || !claim.id || !input.apiKey?.trim()) return "PENDING";
    // Polling never submits another inference, including after a lost response or DB write.
    let receipt;
    try {
      receipt = await inspectGeneratedImageText({ apiKey: input.apiKey, taskId: claim.id, bytes,
        contentType: artifact.contentType, dispatch: claim.dispatch === true, fetcher: input.fetcher });
    } catch { return "PENDING"; }
    if (!receipt) return "PENDING";
    const finished = await query("SELECT public.videoforge_finish_image_text_qa($1,$2,$3,$4,$5,$6,$7) AS value",
      [claim.id, artifact.sha256, receipt.verdict, receipt.responseHash, receipt.costMicroUsd,
        receipt.promptTokens, receipt.completionTokens]);
    return finished === true ? receipt.verdict : "PENDING";
  };
}
