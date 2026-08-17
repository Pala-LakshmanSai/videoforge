import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  signIn: { email: vi.fn(), social: vi.fn() },
  signUp: { email: vi.fn() },
  requestPasswordReset: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("better-auth/react", () => ({ createAuthClient: () => auth }));

import { HostedStagingApp } from "./HostedStagingApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("hosted staging access boundary", () => {
  it("mounts the real product router only after hosted tenant admission", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v2/tenant") {
          return Response.json({
            account_id: "11111111-1111-4111-8111-111111111111",
            workspace_id: "22222222-2222-4222-8222-222222222222",
            workspace_name: "Private workspace",
            user: { email: "owner@example.test", name: "Owner" },
          });
        }
        if (String(input) === "/api/v2/hosted/status") {
          return Response.json({ authentication: ["GOOGLE"] });
        }
        throw new Error(`Unexpected request ${String(input)}`);
      }),
    );

    render(
      <HostedStagingApp>
        <div>Real VideoForge router</div>
      </HostedStagingApp>,
    );

    expect(await screen.findByText("Real VideoForge router")).toBeInTheDocument();
    expect(screen.queryByText("Neon tenant scope active")).not.toBeInTheDocument();
  });

  it("does not expose product children to an unauthenticated browser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v2/tenant") {
          return Response.json({ error: { code: "AUTHENTICATION_REQUIRED" } }, { status: 401 });
        }
        return Response.json({ authentication: ["GOOGLE"] });
      }),
    );

    render(
      <HostedStagingApp>
        <div>Private product data</div>
      </HostedStagingApp>,
    );

    expect(await screen.findByRole("heading", { name: "Enter VideoForge" })).toBeInTheDocument();
    expect(screen.queryByText("Private product data")).not.toBeInTheDocument();
  });
});
