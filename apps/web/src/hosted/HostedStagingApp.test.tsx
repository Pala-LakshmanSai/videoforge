import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  cleanup();
  vi.clearAllMocks();
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
            schema_version: "videoforge-hosted-tenant/v1",
            account_id: "11111111-1111-4111-8111-111111111111",
            workspace_id: "22222222-2222-4222-8222-222222222222",
            workspace_name: "Private workspace",
            user: {
              id: "33333333-3333-4333-8333-333333333333",
              email: "owner@example.test",
              name: "Owner",
            },
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

  it("does not admit a malformed tenant response", async () => {
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
        return Response.json({ authentication: ["GOOGLE"] });
      }),
    );

    render(
      <HostedStagingApp>
        <div>Private product data</div>
      </HostedStagingApp>,
    );

    expect(
      await screen.findByText("Hosted staging is unavailable. No local fallback was used."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Private product data")).not.toBeInTheDocument();
  });

  it("requires the exact invitation code after Google authentication", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v2/tenant") {
          return Response.json({ error: { code: "INVITE_REQUIRED" } }, { status: 403 });
        }
        return Response.json({ authentication: ["GOOGLE", "EMAIL_PASSWORD"] });
      }),
    );

    render(
      <HostedStagingApp>
        <div>Private product data</div>
      </HostedStagingApp>,
    );

    expect(
      await screen.findByRole("heading", { name: "Enter your invitation code" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Invitation code")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Redeem invitation" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with email" })).not.toBeInTheDocument();
    expect(screen.queryByText("Private product data")).not.toBeInTheDocument();
  });

  it("redeems one presented code and mounts the private product only after admission", async () => {
    let admitted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/v2/tenant") {
        return admitted
          ? Response.json({
              schema_version: "videoforge-hosted-tenant/v1",
              account_id: "11111111-1111-4111-8111-111111111111",
              workspace_id: "22222222-2222-4222-8222-222222222222",
              workspace_name: "Private workspace",
              user: {
                id: "33333333-3333-4333-8333-333333333333",
                email: "owner@example.test",
                name: "Owner",
              },
            })
          : Response.json({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, { status: 403 });
      }
      if (String(input) === "/api/v2/hosted/status") {
        return Response.json({ authentication: ["GOOGLE"] });
      }
      if (String(input) === "/api/v2/invite/redemption") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          schema_version: "videoforge-hosted-invite-redemption/v1",
          invite_code: "test-invitation-code-0001",
        });
        admitted = true;
        return Response.json({
          schema_version: "videoforge-hosted-invite-redemption/v1",
          outcome: "ADMITTED",
        });
      }
      throw new Error(`Unexpected request ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HostedStagingApp>
        <div>Private product data</div>
      </HostedStagingApp>,
    );

    fireEvent.change(await screen.findByLabelText("Invitation code"), {
      target: { value: "test-invitation-code-0001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Redeem invitation" }));

    expect(await screen.findByText("Private product data")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invitation code")).not.toBeInTheDocument();
  });

  it("unmounts private product children when focus revalidation returns 403", async () => {
    let tenantChecks = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v2/tenant") {
        tenantChecks += 1;
        if (tenantChecks > 1) {
          return Response.json({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, { status: 403 });
        }
        return Response.json({
          schema_version: "videoforge-hosted-tenant/v1",
          account_id: "11111111-1111-4111-8111-111111111111",
          workspace_id: "22222222-2222-4222-8222-222222222222",
          workspace_name: "Private workspace",
          user: {
            id: "33333333-3333-4333-8333-333333333333",
            email: "owner@example.test",
            name: "Owner",
          },
        });
      }
      return Response.json({ authentication: ["GOOGLE"] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HostedStagingApp>
        <div>Private product data</div>
      </HostedStagingApp>,
    );

    expect(await screen.findByText("Private product data")).toBeInTheDocument();
    fireEvent.focus(window);

    expect(
      await screen.findByRole("heading", { name: "Enter your invitation code" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Private product data")).not.toBeInTheDocument();
  });

  it("unmounts private product children when focus revalidation fails", async () => {
    let tenantChecks = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/v2/tenant") {
        tenantChecks += 1;
        if (tenantChecks > 1) throw new Error("network down");
        return Response.json({
          schema_version: "videoforge-hosted-tenant/v1",
          account_id: "11111111-1111-4111-8111-111111111111",
          workspace_id: "22222222-2222-4222-8222-222222222222",
          workspace_name: "Private workspace",
          user: {
            id: "33333333-3333-4333-8333-333333333333",
            email: "owner@example.test",
            name: "Owner",
          },
        });
      }
      return Response.json({ authentication: ["GOOGLE"] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <HostedStagingApp>
        <div>Private product data</div>
      </HostedStagingApp>,
    );

    expect(await screen.findByText("Private product data")).toBeInTheDocument();
    fireEvent.focus(window);

    expect(
      await screen.findByText("Hosted staging is unavailable. No local fallback was used."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Private product data")).not.toBeInTheDocument();
  });

  it("clears a rejected verifier and never reflects its value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v2/tenant") {
          return Response.json({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, { status: 403 });
        }
        if (String(input) === "/api/v2/hosted/status") {
          return Response.json({ authentication: ["GOOGLE"] });
        }
        if (String(input) === "/api/v2/invite/redemption") {
          return Response.json(
            { error: { code: "INVITE_INVALID", retryable: false } },
            { status: 400 },
          );
        }
        throw new Error(`Unexpected request ${String(input)}`);
      }),
    );

    render(
      <HostedStagingApp>
        <div>Private product data</div>
      </HostedStagingApp>,
    );

    const field = await screen.findByLabelText("Invitation code");
    fireEvent.change(field, { target: { value: "rejected-invitation-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Redeem invitation" }));

    expect(await screen.findByText("That invitation code is invalid.")).toBeInTheDocument();
    expect(field).toHaveValue("");
    expect(screen.queryByText("rejected-invitation-code")).not.toBeInTheDocument();
  });

  it("signs out explicitly from an invite-required state and then returns to sign-in", async () => {
    let signedOut = false;
    auth.signOut.mockImplementationOnce(async () => {
      signedOut = true;
      return { data: { success: true }, error: null };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v2/tenant") {
          return signedOut
            ? Response.json({ error: { code: "AUTHENTICATION_REQUIRED" } }, { status: 401 })
            : Response.json({ error: { code: "INVITE_REQUIRED" } }, { status: 403 });
        }
        return Response.json({ authentication: ["GOOGLE"] });
      }),
    );

    render(
      <HostedStagingApp>
        <div>Private product data</div>
      </HostedStagingApp>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "Enter VideoForge" })).toBeInTheDocument();
  });

  it("fails closed and surfaces a sign-out error", async () => {
    auth.signOut.mockResolvedValueOnce({
      data: null,
      error: { message: "Unable to sign out" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v2/tenant") {
          return Response.json({ error: { code: "INVITE_REQUIRED" } }, { status: 403 });
        }
        return Response.json({ authentication: ["GOOGLE"] });
      }),
    );

    render(
      <HostedStagingApp>
        <div>Private product data</div>
      </HostedStagingApp>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("Sign-out failed. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("Private product data")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Enter VideoForge" })).toBeInTheDocument();
  });

  it("clears a prior session before starting Google OAuth", async () => {
    const events: string[] = [];
    auth.signOut.mockImplementationOnce(async () => {
      events.push("sign-out");
      return { data: { success: true }, error: null };
    });
    auth.signIn.social.mockImplementationOnce(async () => {
      events.push("google");
      return { data: { url: "https://accounts.google.com" }, error: null };
    });
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

    fireEvent.click(await screen.findByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(auth.signIn.social).toHaveBeenCalledTimes(1));
    expect(events).toEqual(["sign-out", "google"]);
    expect(auth.signIn.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: window.location.origin,
    });
  });
});
