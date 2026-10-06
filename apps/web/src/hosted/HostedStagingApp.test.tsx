import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  signIn: { email: vi.fn(), social: vi.fn() },
  signUp: { email: vi.fn() },
  requestPasswordReset: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  multiSession: { listDeviceSessions: vi.fn(), setActive: vi.fn(), revoke: vi.fn() },
}));

vi.mock("better-auth/react", () => ({ createAuthClient: () => auth }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useHostedIdentity } from "./HostedIdentity";
import { useHostedCreateDraftState } from "./HostedCreateDraft";
import { AccountMenu } from "./AccountMenu";
import { HostedStagingApp } from "./HostedStagingApp";

beforeEach(() => {
  auth.getSession.mockResolvedValue({ data: null, error: null });
  auth.multiSession.listDeviceSessions.mockResolvedValue({ data: [], error: null });
});

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

  it("keeps the current product page visible while focus revalidation is pending", async () => {
    let tenantChecks = 0;
    let finishRevalidation: ((response: Response) => void) | undefined;
    const pendingRevalidation = new Promise<Response>((resolve) => {
      finishRevalidation = resolve;
    });
    const admittedTenant = {
      schema_version: "videoforge-hosted-tenant/v1",
      account_id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "22222222-2222-4222-8222-222222222222",
      workspace_name: "Private workspace",
      user: {
        id: "33333333-3333-4333-8333-333333333333",
        email: "owner@example.test",
        name: "Owner",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/v2/tenant") {
          tenantChecks += 1;
          return tenantChecks === 1 ? Response.json(admittedTenant) : pendingRevalidation;
        }
        return Response.json({ authentication: ["GOOGLE"] });
      }),
    );

    render(
      <HostedStagingApp>
        <div>Private product data</div>
      </HostedStagingApp>,
    );

    expect(await screen.findByText("Private product data")).toBeInTheDocument();
    fireEvent.focus(window);
    await waitFor(() => expect(tenantChecks).toBe(2));

    expect(screen.getByText("Private product data")).toBeInTheDocument();
    expect(screen.queryByText("Checking private hosted access…")).not.toBeInTheDocument();

    finishRevalidation?.(Response.json(admittedTenant));
    await waitFor(() => expect(screen.getByText("Private product data")).toBeInTheDocument());
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

  it("starts Google OAuth without revoking remembered accounts", async () => {
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
    expect(events).toEqual(["google"]);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(auth.getSession).toHaveBeenCalled();
    expect(auth.signIn.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: `${window.location.origin}/#account-added`,
    });
  });
});

function PrivateProbe() {
  const identity = useHostedIdentity();
  const [draft, setDraft] = useHostedCreateDraftState("title", "");
  return (
    <>
      <p>{identity?.email}</p>
      <input
        aria-label="Private draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button onClick={() => void identity?.switchAccount?.("expired-session")}>
        Switch saved account
      </button>
    </>
  );
}

it("discards queries and drafts when another tab changes account, but preserves them for same-account focus", async () => {
  let second = false;
  const client = new QueryClient();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) =>
      String(input) === "/api/v2/tenant"
        ? Response.json({
            schema_version: "videoforge-hosted-tenant/v1",
            account_id: second ? "other" : "owner",
            workspace_id: second ? "other-workspace" : "owner-workspace",
            workspace_name: "Private",
            user: {
              id: second ? "other" : "owner",
              email: second ? "other@example.test" : "owner@example.test",
              name: "User",
            },
          })
        : Response.json({ authentication: ["GOOGLE"] }),
    ),
  );
  render(
    <QueryClientProvider client={client}>
      <HostedStagingApp>
        <PrivateProbe />
      </HostedStagingApp>
    </QueryClientProvider>,
  );
  await screen.findByText("owner@example.test");
  client.setQueryData(["private-library"], { private: "owner-only" });
  fireEvent.change(screen.getByLabelText("Private draft"), { target: { value: "owner draft" } });
  fireEvent.focus(window);
  await waitFor(() =>
    expect(client.getQueryData(["private-library"])).toEqual({ private: "owner-only" }),
  );
  expect(screen.getByLabelText("Private draft")).toHaveValue("owner draft");
  second = true;
  fireEvent.focus(window);
  await screen.findByText("other@example.test");
  expect(client.getQueryData(["private-library"])).toBeUndefined();
  expect(screen.getByLabelText("Private draft")).toHaveValue("");
  expect(screen.queryByText("owner@example.test")).not.toBeInTheDocument();
});

it("recovers the admitted account after a failed switch and exposes the failure", async () => {
  auth.multiSession.setActive.mockResolvedValueOnce({ error: { message: "Expired" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) =>
      String(input) === "/api/v2/tenant"
        ? Response.json({
            schema_version: "videoforge-hosted-tenant/v1",
            account_id: "owner",
            workspace_id: "workspace",
            workspace_name: "Private",
            user: { id: "owner", email: "owner@example.test", name: "Owner" },
          })
        : Response.json({ authentication: ["GOOGLE"] }),
    ),
  );
  render(
    <HostedStagingApp>
      <PrivateProbe />
    </HostedStagingApp>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Switch saved account" }));
  expect(
    await screen.findByText("This account session expired or was removed. Sign in again."),
  ).toBeInTheDocument();
  expect(screen.getByText("owner@example.test")).toBeInTheDocument();
});

const admittedTenant = (second = false) => ({
  schema_version: "videoforge-hosted-tenant/v1",
  account_id: second ? "other" : "owner",
  workspace_id: second ? "other-workspace" : "owner-workspace",
  workspace_name: "Private",
  user: {
    id: second ? "other" : "owner",
    email: second ? "other@example.test" : "owner@example.test",
    name: second ? "Other" : "Owner",
  },
});
const savedAccounts = [
  {
    session: { token: "owner-session" },
    user: { id: "owner", email: "owner@example.test", name: "Owner" },
  },
  {
    session: { token: "other-session" },
    user: { id: "other", email: "other@example.test", name: "Other" },
  },
];
it("preloads all browser accounts before exposing the app, so opening the menu makes zero requests", async () => {
  let release: (value: unknown) => void = () => {};
  auth.getSession.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  auth.multiSession.listDeviceSessions.mockResolvedValue({ data: savedAccounts, error: null });
  const fetchMock = vi.fn(async (input) =>
    Response.json(
      String(input) === "/api/v2/tenant" ? admittedTenant() : { authentication: ["GOOGLE"] },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <HostedStagingApp>
      <AccountMenu />
      <p>Private app ready</p>
    </HostedStagingApp>,
  );
  await waitFor(() => expect(auth.getSession).toHaveBeenCalledOnce());
  expect(screen.queryByText("Private app ready")).not.toBeInTheDocument();
  release({ data: savedAccounts[0], error: null });
  await screen.findByText("Private app ready");
  const calls = [
    fetchMock.mock.calls.length,
    auth.getSession.mock.calls.length,
    auth.multiSession.listDeviceSessions.mock.calls.length,
  ];
  fireEvent.click(screen.getByText("Account", { exact: true }));
  expect(screen.getByRole("button", { name: "Other other@example.test" })).toBeInTheDocument();
  expect(screen.queryByText("Please wait…")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Switch account" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Account", { exact: true }));
  fireEvent.click(screen.getByText("Account", { exact: true }));
  expect([
    fetchMock.mock.calls.length,
    auth.getSession.mock.calls.length,
    auth.multiSession.listDeviceSessions.mock.calls.length,
  ]).toEqual(calls);
});
it("switches in the running app without a document reload, clears private state and warms new-account navigation", async () => {
  let second = false;
  auth.getSession.mockResolvedValue({ data: savedAccounts[0], error: null });
  auth.multiSession.listDeviceSessions.mockResolvedValue({ data: savedAccounts, error: null });
  auth.multiSession.setActive.mockImplementation(async () => {
    second = true;
    return { data: savedAccounts[1], error: null };
  });
  const client = new QueryClient();
  const resetRoute = vi.fn(async () => {});
  const fetchMock = vi.fn(async (input) =>
    Response.json(
      String(input) === "/api/v2/tenant"
        ? admittedTenant(second)
        : String(input) === "/api/v2/hosted/status"
          ? { authentication: ["GOOGLE"] }
          : { owner: second ? "other" : "owner" },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={client}>
      <HostedStagingApp onAccountSwitch={resetRoute}>
        <PrivateProbe />
      </HostedStagingApp>
    </QueryClientProvider>,
  );
  await screen.findByText("owner@example.test");
  await waitFor(() =>
    expect(client.getQueryData(["voiceover-voices"])).toEqual({ owner: "owner" }),
  );
  client.setQueryData(["private-library"], { private: "owner" });
  fireEvent.change(screen.getByLabelText("Private draft"), {
    target: { value: "private owner draft" },
  });
  const reads = auth.getSession.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Switch saved account" }));
  await screen.findByText("other@example.test");
  expect(resetRoute).toHaveBeenCalledOnce();
  expect(auth.getSession.mock.calls.length).toBe(reads);
  expect(client.getQueryData(["private-library"])).toBeUndefined();
  expect(screen.getByLabelText("Private draft")).toHaveValue("");
  await waitFor(() =>
    expect(client.getQueryData(["voiceover-voices"])).toEqual({ owner: "other" }),
  );
  expect(client.getQueryData(["hosted-library"])).toEqual({ owner: "other" });
  expect(client.getQueryData(["hosted-queue"])).toEqual({ owner: "other" });
});
it("shows an explicit retry when account preloading fails without hiding admitted access", async () => {
  auth.multiSession.listDeviceSessions.mockResolvedValueOnce({ data: "invalid", error: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) =>
      Response.json(
        String(input) === "/api/v2/tenant" ? admittedTenant() : { authentication: ["GOOGLE"] },
      ),
    ),
  );
  render(
    <HostedStagingApp>
      <AccountMenu />
    </HostedStagingApp>,
  );
  await screen.findByText("Account", { exact: true });
  fireEvent.click(screen.getByText("Account", { exact: true }));
  expect(screen.getByRole("alert")).toHaveTextContent("Accounts could not load");
  auth.getSession.mockResolvedValue({ data: savedAccounts[0], error: null });
  auth.multiSession.listDeviceSessions.mockResolvedValue({ data: savedAccounts, error: null });
  fireEvent.click(screen.getByRole("button", { name: "Retry accounts" }));
  expect(
    await screen.findByRole("button", { name: "Other other@example.test" }),
  ).toBeInTheDocument();
});
