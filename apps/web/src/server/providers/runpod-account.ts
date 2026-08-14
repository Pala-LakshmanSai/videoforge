import { createHash } from "node:crypto";

import { SUJAL_RUNPOD_ACCOUNT_ID_SHA256 } from "./keychain";

const DEFAULT_GRAPHQL_URL = "https://api.runpod.io/graphql";

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class RunPodAccountError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RunPodAccountError";
  }
}

const hashAccountId = (value: string): string =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

export async function assertSujalRunPodAccount(
  apiKey: string,
  options: {
    readonly fetch?: FetchPort;
    readonly graphqlUrl?: string;
    readonly timeoutMs?: number;
    readonly expectedAccountIdHash?: string;
  } = {},
): Promise<{ readonly accountIdHash: string }> {
  if (apiKey.trim() !== apiKey || apiKey.length < 20) {
    throw new RunPodAccountError("RUNPOD_AUTH_INVALID");
  }
  const fetchPort = options.fetch ?? fetch;
  const graphqlUrl = options.graphqlUrl ?? DEFAULT_GRAPHQL_URL;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const expectedAccountIdHash = options.expectedAccountIdHash ?? SUJAL_RUNPOD_ACCOUNT_ID_SHA256;
  if (
    (graphqlUrl !== DEFAULT_GRAPHQL_URL && !graphqlUrl.startsWith("http://127.0.0.1:")) ||
    (options.expectedAccountIdHash !== undefined && graphqlUrl === DEFAULT_GRAPHQL_URL) ||
    !/^sha256:[a-f0-9]{64}$/u.test(expectedAccountIdHash) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000
  ) {
    throw new RunPodAccountError("RUNPOD_ACCOUNT_PREFLIGHT_INVALID");
  }

  let response: Response;
  try {
    response = await fetchPort(graphqlUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "query VideoForgeAccountIdentity { myself { id } }" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new RunPodAccountError("RUNPOD_ACCOUNT_READ_AMBIGUOUS");
  }
  if (!response.ok) {
    throw new RunPodAccountError(
      response.status === 401 || response.status === 403
        ? "RUNPOD_AUTH_REJECTED"
        : "RUNPOD_ACCOUNT_READ_FAILED",
    );
  }

  let accountId: string | null = null;
  try {
    const value = JSON.parse(await response.text()) as {
      readonly data?: { readonly myself?: { readonly id?: unknown } };
      readonly errors?: unknown;
    };
    accountId = typeof value.data?.myself?.id === "string" ? value.data.myself.id : null;
    if (accountId === null || value.errors !== undefined) throw new Error("invalid");
  } catch {
    throw new RunPodAccountError("RUNPOD_ACCOUNT_RESPONSE_INVALID");
  }

  const accountIdHash = hashAccountId(accountId);
  if (accountIdHash !== expectedAccountIdHash) {
    throw new RunPodAccountError("RUNPOD_ACCOUNT_NOT_SUJAL");
  }
  return Object.freeze({ accountIdHash });
}
