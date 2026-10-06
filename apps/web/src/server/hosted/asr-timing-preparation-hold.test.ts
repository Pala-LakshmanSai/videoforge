import { expect, it, vi } from "vitest";
import type { HostedRuntimeConfiguration } from "./configuration";

const database = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }));
vi.mock("./neon", () => ({
  createNeonPool: () => ({ end: database.end }),
  createNeonExecutor: () => ({
    transaction: async (run: (db: typeof database) => Promise<unknown>) => run(database),
  }),
}));
import { writeProjectPrompts } from "./hosted-prompt-route";
import { HOSTED_PROMPT_RESERVATION_MICRO_USD } from "./runware-prompt-execution";

it("honors the durable preparation-only hold before any provider read, paid claim or continuation", async () => {
  database.query.mockImplementation(async (sql: string) =>
    sql.includes("videoforge_load_hosted_prompt_plan")
      ? { rows: [{ plan: { preparation_only: true } }] }
      : { rows: [] },
  );
  const outbound = vi.fn(() => {
    throw new Error("no provider access is authorized");
  });
  vi.stubGlobal("fetch", outbound);
  const waitUntil = vi.fn();
  const projectId = "11111111-1111-4111-8111-111111111111";
  try {
    const result = await writeProjectPrompts(
      new Request(`https://videoforge.buzz/api/v2/hosted/projects/${projectId}/prompts`, {
        method: "POST",
        headers: { origin: "https://videoforge.buzz", "content-type": "application/json" },
        body: JSON.stringify({
          maximum_prompt_spend_micro_usd: HOSTED_PROMPT_RESERVATION_MICRO_USD,
        }),
      }),
      projectId,
      {
        publicOrigin: "https://videoforge.buzz",
        neon: { databaseUrl: "unused" },
        styleAnalysis: { apiKey: "fixture" },
      } as HostedRuntimeConfiguration,
      { waitUntil },
      { account_id: "account", workspace_id: "workspace", user_id: "owner" },
    );
    expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject({ state: "WAITING" });
    expect(outbound).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
    expect(
      database.query.mock.calls.some(([sql]) => String(sql).includes("prepare_hosted_prompt_run")),
    ).toBe(false);
    expect(database.end).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("returns the settled prompt failure instead of masking it with already claimed", async () => {
  database.query.mockImplementation(async (sql: string) =>
    sql.includes("videoforge_load_hosted_prompt_plan")
      ? {
          rows: [
            {
              plan: {
                existing_run_state: "FAILED",
                existing_run_problem_code: "HOSTED_PROMPT_OUTPUT_INVALID",
              },
            },
          ],
        }
      : { rows: [] },
  );
  const outbound = vi.fn(() => {
    throw new Error("no provider access is authorized");
  });
  vi.stubGlobal("fetch", outbound);
  try {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const result = await writeProjectPrompts(
      new Request(`https://videoforge.buzz/api/v2/hosted/projects/${projectId}/prompts`, {
        method: "POST",
        headers: { origin: "https://videoforge.buzz", "content-type": "application/json" },
        body: JSON.stringify({
          maximum_prompt_spend_micro_usd: HOSTED_PROMPT_RESERVATION_MICRO_USD,
        }),
      }),
      projectId,
      {
        publicOrigin: "https://videoforge.buzz",
        neon: { databaseUrl: "unused" },
        styleAnalysis: { apiKey: "fixture" },
      } as HostedRuntimeConfiguration,
      { waitUntil: vi.fn() },
      { account_id: "account", workspace_id: "workspace", user_id: "owner" },
    );
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ error: { code: "HOSTED_PROMPT_OUTPUT_INVALID" } });
    expect(outbound).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
