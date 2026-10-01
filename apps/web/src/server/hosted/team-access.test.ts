import { describe, expect, it, vi } from "vitest";
import { handleTeamAccess, canManageTeam } from "./team-access";
const origin = "https://videoforge.test";
function request(operation?: string, target = "assistant@example.test", source = origin) {
  return new Request(
    origin + "/api/v2/team-access",
    operation
      ? {
          method: "POST",
          headers: { origin: source, "content-type": "application/json" },
          body: JSON.stringify({ operation, target }),
        }
      : {},
  );
}
function dependencies(email = "lakshman121@gmail.com") {
  return {
    publicOrigin: origin,
    authenticate: vi.fn(async () => ({ token: "private-session-token", email })),
    execute: vi.fn(async () => ({ members: [], invites: [] }) as Record<string, unknown>),
  };
}
describe("hosted Team access boundary", () => {
  it.each(["lakshman121@gmail.com", "demo9gss@gmail.com"])(
    "admits only exact manager %s",
    async (email) => {
      const deps = dependencies(email);
      expect((await handleTeamAccess(request(), deps)).status).toBe(200);
    },
  );
  it.each(["other@gmail.com", "lakshman121+team@gmail.com", "demo9gss@gmail.com.evil"])(
    "denies %s without a database management call",
    async (email) => {
      const deps = dependencies(email);
      expect((await handleTeamAccess(request(), deps)).status).toBe(403);
      expect(deps.execute).not.toHaveBeenCalled();
    },
  );
  it("normalizes manager comparison", () =>
    expect(canManageTeam(" Demo9gss@gmail.com ")).toBe(true));
  it("denies foreign-origin mutation before authentication", async () => {
    const deps = dependencies();
    expect(
      (await handleTeamAccess(request("INVITE", "a@b.test", "https://evil.test"), deps)).status,
    ).toBe(403);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });
  it("returns a random code once and passes only its hash to persistence", async () => {
    const deps = dependencies();
    deps.execute.mockResolvedValue({ invite_id: "test", expires_at: "2026-10-04T00:00:00Z" });
    const first = await handleTeamAccess(request("INVITE"), deps);
    const data = (await first.json()) as { code: string };
    expect(first.status).toBe(201);
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(data.code).toMatch(/^[a-f0-9]{64}$/u);
    expect(deps.execute).toHaveBeenCalledWith(
      "private-session-token",
      "INVITE",
      "assistant@example.test",
      expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    );
    expect(JSON.stringify(deps.execute.mock.calls)).not.toContain(data.code);
    const second = (await (await handleTeamAccess(request("INVITE"), deps)).json()) as {
      code: string;
    };
    expect(second.code).not.toBe(data.code);
  });
  it("rejects extra fields, invalid emails, oversized streamed bodies and unsupported methods", async () => {
    const deps = dependencies();
    for (const req of [
      request("INVITE", "bad email"),
      request("DELETE"),
      new Request(origin + "/api/v2/team-access", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ operation: "INVITE", target: "a@b.test", email: "spoof" }),
      }),
      new Request(origin + "/api/v2/team-access", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: " ".repeat(5000),
      }),
    ])
      expect((await handleTeamAccess(req, deps)).status).toBe(400);
    expect(
      (
        await handleTeamAccess(
          new Request(origin + "/api/v2/team-access", { method: "DELETE" }),
          deps,
        )
      ).status,
    ).toBe(405);
    expect(deps.execute).not.toHaveBeenCalled();
  });
  it("preserves authentication and rate-limit denials", async () => {
    for (const status of [401, 429]) {
      const deps = {
        ...dependencies(),
        authenticate: async () => Response.json({ error: { code: "denied" } }, { status }),
      };
      expect((await handleTeamAccess(request(), deps)).status).toBe(status);
      expect(deps.execute).not.toHaveBeenCalled();
    }
  });
  it("returns actionable conflicts and never leaks database errors", async () => {
    const deps = dependencies();
    deps.execute.mockResolvedValue({ error: "TEAM_ALREADY_ADMITTED" });
    expect((await handleTeamAccess(request("INVITE"), deps)).status).toBe(409);
    deps.execute.mockRejectedValue(new Error("secret database details"));
    const res = await handleTeamAccess(request("INVITE"), deps);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("secret");
  });
});
