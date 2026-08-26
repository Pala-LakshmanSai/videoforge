import { canonicalSha256 } from "@videoforge/control-plane";

import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { createNeonPool } from "./neon";

const SHA = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HEX = /^[0-9a-f]{64}$/u;

interface StartParams {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly generationRequestId: string;
  readonly cancelAt: string;
  readonly stopAt: string;
}

interface StartDocument {
  readonly schemaVersion: "videoforge.v213-pair-workflow-start/v1";
  readonly workflowId: string;
  readonly requestSha256: string;
  readonly outerStateSha256: string;
  readonly params: StartParams;
}

interface QueryResult {
  readonly rows: readonly Record<string, unknown>[];
}

interface WorkflowStartDependencies {
  readonly query: (sql: string, values: readonly unknown[]) => Promise<QueryResult>;
  readonly close: () => Promise<void>;
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "content-security-policy": "default-src 'none'" },
  });
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function verifyHmac(token: string, preimage: string, signature: string | null): Promise<boolean> {
  if (!signature || !HEX.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(signature.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16)),
    new TextEncoder().encode(preimage),
  );
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") && header.length > 7 ? header.slice(7) : null;
}

function parseDocument(value: unknown): StartDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const doc = value as Record<string, unknown>;
  if (!exactKeys(doc, ["schemaVersion", "workflowId", "requestSha256", "outerStateSha256", "params"])) return null;
  if (!doc.params || typeof doc.params !== "object" || Array.isArray(doc.params)) return null;
  const params = doc.params as Record<string, unknown>;
  if (!exactKeys(params, ["accountId", "workspaceId", "generationRequestId", "cancelAt", "stopAt"])) return null;
  if (
    doc.schemaVersion !== "videoforge.v213-pair-workflow-start/v1" ||
    typeof doc.workflowId !== "string" ||
    typeof doc.requestSha256 !== "string" ||
    typeof doc.outerStateSha256 !== "string" ||
    !SHA.test(doc.requestSha256) ||
    !SHA.test(doc.outerStateSha256) ||
    ![params.accountId, params.workspaceId, params.generationRequestId].every((item) => typeof item === "string" && UUID.test(item)) ||
    typeof params.cancelAt !== "string" ||
    typeof params.stopAt !== "string" ||
    doc.workflowId !== `hosted-pair-${params.generationRequestId}`
  ) return null;
  return doc as unknown as StartDocument;
}

function result(doc: Pick<StartDocument, "workflowId" | "requestSha256" | "outerStateSha256">, state: "STARTED" | "EXISTING") {
  return {
    schemaVersion: "videoforge.v213-pair-workflow-start-result/v1",
    workflowId: doc.workflowId,
    requestSha256: doc.requestSha256,
    outerStateSha256: doc.outerStateSha256,
    state,
  } as const;
}

export async function handleV213OperatorWorkflowStart(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  dependencies?: WorkflowStartDependencies,
): Promise<Response | null> {
  const url = new URL(request.url);
  const base = "/api/operator/v2-13/pair-workflows";
  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return null;
  if (config.environment !== "production" || config.gpuTransport !== "QUALIFIED_EXACT")
    return response({ error: { code: "V213_OPERATOR_WORKFLOW_DISABLED" } }, 503);
  const token = bearer(request);
  if (!token || token !== environment.VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN)
    return response({ error: { code: "V213_OPERATOR_WORKFLOW_UNAUTHORIZED" } }, 401);

  let document: StartDocument | null = null;
  let preimage = "";
  if (request.method === "POST" && url.pathname === base) {
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json")
      return response({ error: { code: "V213_OPERATOR_WORKFLOW_INVALID" } }, 400);
    const raw = await request.text();
    try { document = parseDocument(JSON.parse(raw)); } catch { document = null; }
    preimage = raw;
  } else if (request.method === "GET") {
    const workflowId = decodeURIComponent(url.pathname.slice(base.length + 1));
    const requestSha256 = request.headers.get("x-videoforge-request-sha256") ?? "";
    const outerStateSha256 = request.headers.get("x-videoforge-outer-state-sha256") ?? "";
    const generationRequestId = workflowId.slice("hosted-pair-".length);
    document = parseDocument({
      schemaVersion: "videoforge.v213-pair-workflow-start/v1",
      workflowId,
      requestSha256,
      outerStateSha256,
      params: { accountId: "00000000-0000-4000-8000-000000000000", workspaceId: "00000000-0000-4000-8000-000000000000", generationRequestId, cancelAt: "GET", stopAt: "GET" },
    });
    preimage = `${workflowId}\n${requestSha256}\n${outerStateSha256}`;
  }
  if (!document || request.headers.get("x-videoforge-request-sha256") !== document.requestSha256 ||
      !(await verifyHmac(token, preimage, request.headers.get("x-videoforge-signature"))))
    return response({ error: { code: "V213_OPERATOR_WORKFLOW_UNAUTHORIZED" } }, 401);
  if (request.method === "POST") {
    const computed = canonicalSha256({ workflowId: document.workflowId, outerStateSha256: document.outerStateSha256, params: document.params });
    if (computed !== document.requestSha256) return response({ error: { code: "V213_OPERATOR_WORKFLOW_REQUEST_DRIFT" } }, 409);
  }

  const pool = dependencies ?? (() => {
    const instance = createNeonPool(config.neon.databaseUrl);
    return { query: (sql: string, values: readonly unknown[]) => instance.query(sql, [...values]), close: () => instance.end() };
  })();
  const tokenSha256 = await sha256(token);
  try {
    const claim = request.method === "POST"
      ? await pool.query("SELECT public.videoforge_claim_v213_workflow_start($1::jsonb) AS claim", [JSON.stringify({
          tokenSha256, workflowId: document.workflowId, generationRequestId: document.params.generationRequestId,
          requestSha256: document.requestSha256, outerStateSha256: document.outerStateSha256,
          paramsSha256: canonicalSha256(document.params),
        })])
      : await pool.query("SELECT public.videoforge_load_v213_workflow_start($1::jsonb) AS claim", [JSON.stringify({
          tokenSha256, workflowId: document.workflowId, requestSha256: document.requestSha256,
          outerStateSha256: document.outerStateSha256,
        })]);
    const value = claim.rows[0]?.claim as { action?: string; result?: unknown } | undefined;
    if (value?.action === "EXISTING") return response(value.result, 200);
    const workflow = environment.HOSTED_PAIR_WORKFLOW;
    if (!workflow) return response({ error: { code: "HOSTED_PAIR_WORKFLOW_BINDING_MISSING" } }, 503);
    let state: "STARTED" | "EXISTING" = "EXISTING";
    if (value?.action === "CREATE") {
      try {
        const created = await workflow.create({ id: document.workflowId, params: document.params });
        if (created.id !== document.workflowId) throw new Error("WORKFLOW_ID_MISMATCH");
        state = "STARTED";
      } catch {
        const recovered = await workflow.get(document.workflowId);
        await recovered.status();
      }
    } else {
      const recovered = await workflow.get(document.workflowId);
      await recovered.status();
    }
    const completed = result(document, state);
    const completion = await pool.query("SELECT public.videoforge_complete_v213_workflow_start($1::jsonb) AS result", [JSON.stringify({
      tokenSha256, workflowId: document.workflowId, requestSha256: document.requestSha256,
      outerStateSha256: document.outerStateSha256, result: completed,
    })]);
    return response(completion.rows[0]?.result ?? completed, state === "STARTED" ? 201 : 200);
  } catch {
    return response({ error: { code: "V213_OPERATOR_WORKFLOW_REJECTED" } }, 409);
  } finally {
    await pool.close();
  }
}
