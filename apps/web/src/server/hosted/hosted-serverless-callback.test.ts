import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HostedRenderPlanAppendDatabase,
  HostedServerlessCallbackError,
  hostedServerlessCallbackDisabledResponse,
  hostedServerlessCallbackErrorResponse,
  parseHostedServerlessCallbackRequest,
} from "./hosted-serverless-callback";

const ID = "00000000-0000-4000-8000-000000000001";
const SHA256 = `sha256:${"a".repeat(64)}`;

describe("hosted serverless callback composition", () => {
  it("parses one exact bounded JSON request", async () => {
    const body = JSON.stringify({ schema_version: "callback/v1" });
    const request = new Request("https://videoforge.example/api/callback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(new TextEncoder().encode(body).byteLength),
      },
      body,
    });
    await expect(parseHostedServerlessCallbackRequest(request)).resolves.toEqual({
      schema_version: "callback/v1",
    });
  });

  it("rejects missing lengths, content-type drift, and truncated bodies", async () => {
    const missingLength = new Request("https://videoforge.example/api/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    await expect(parseHostedServerlessCallbackRequest(missingLength)).rejects.toMatchObject({
      code: "HOSTED_SERVERLESS_CALLBACK_MALFORMED",
    });

    const wrongType = new Request("https://videoforge.example/api/callback", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "content-length": "2" },
      body: "{}",
    });
    await expect(parseHostedServerlessCallbackRequest(wrongType)).rejects.toMatchObject({
      code: "HOSTED_SERVERLESS_CALLBACK_MALFORMED",
    });

    const driftedLength = new Request("https://videoforge.example/api/callback", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "3" },
      body: "{}",
    });
    await expect(parseHostedServerlessCallbackRequest(driftedLength)).rejects.toMatchObject({
      code: "HOSTED_SERVERLESS_CALLBACK_MALFORMED",
    });
  });

  it("routes the materializer's exact insert through the narrow append function", async () => {
    const queries: { sql: string; parameters: readonly unknown[] }[] = [];
    const database = {
      async execute() {},
      async query() {
        return { rows: [], affectedRows: 0 };
      },
      async transaction<Value>(work: (transaction: never) => Promise<Value>): Promise<Value> {
        const transaction = {
          async execute() {},
          async query(sql: string, parameters: readonly unknown[] = []) {
            queries.push({ sql, parameters });
            return { rows: [{ inserted: true }], affectedRows: 1 };
          },
        };
        return work(transaction as never);
      },
    };
    const adapter = new HostedRenderPlanAppendDatabase(database);
    const result = await adapter.transaction((transaction) =>
      transaction.query(
        `INSERT INTO hosted_render_plans (
           account_id, workspace_id, project_id, project_revision_id,
           schema_version, payload, payload_sha256
         ) VALUES ($1,$2,$3,$4,'videoforge-hosted-cpu-submission/v1',$5::jsonb,$6)
         ON CONFLICT (account_id, workspace_id, project_id, project_revision_id) DO NOTHING`,
        [ID, ID, ID, ID, JSON.stringify({ project_id: ID }), SHA256],
      ),
    );
    expect(result.affectedRows).toBe(1);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain("videoforge_append_hosted_render_plan");
    expect(queries[0]!.sql).not.toContain("UPDATE hosted_render_plans");
  });

  it("keeps the app route factual while no signer and qualified binding are composed", async () => {
    const response = hostedServerlessCallbackDisabledResponse();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_SERVERLESS_CALLBACK_DISABLED_UNQUALIFIED",
        retryable: false,
      },
    });
    const mapped = hostedServerlessCallbackErrorResponse(
      new HostedServerlessCallbackError("HOSTED_SERVERLESS_CALLBACK_FOREIGN"),
    );
    expect(mapped.status).toBe(403);
  });

  it("imports no dispatch or provider mutation surface", async () => {
    const source = await readFile(
      resolve(process.cwd(), "src/server/hosted/hosted-serverless-callback.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /dispatchOnce|commitPredispatch|requireLane|RunPod|server\/providers/u,
    );
    expect(source).toContain("createHostedServerlessOutputBarrier");
    expect(source).toContain("HostedR2OutputArtifactBarrier");
    expect(source).toContain("materializeHostedRenderPlan");
  });
});
