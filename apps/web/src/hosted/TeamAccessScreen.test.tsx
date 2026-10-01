import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostedIdentityContext } from "./HostedIdentity";
import { TeamAccessScreen } from "./TeamAccessScreen";
import { AccountMenu } from "./AccountMenu";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
const members = [
  { id: "owner", email: "lakshman121@gmail.com", owner: true, disabled: false },
  { id: "assistant", email: "assistant@example.test", owner: false, disabled: false },
];
function mount(canManageTeam = true, email = "lakshman121@gmail.com") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HostedIdentityContext.Provider value={{ email, canManageTeam, signOut: vi.fn() }}>
        <AccountMenu />
        <TeamAccessScreen />
      </HostedIdentityContext.Provider>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Team access UI", () => {
  it.each(["lakshman121@gmail.com", "demo9gss@gmail.com"])(
    "shows manager entry and functional invite for %s",
    async (email) => {
      const fetcher = vi.fn(async (_input: unknown, options?: RequestInit) =>
        options?.method === "POST"
          ? Response.json({ code: "private-code", expires_at: "2026-10-04T00:00:00Z" })
          : Response.json({ members, invites: [] }),
      );
      vi.stubGlobal("fetch", fetcher);
      const copy = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: copy },
        configurable: true,
      });
      mount(true, email);
      expect(await screen.findByText("assistant@example.test")).toBeVisible();
      expect(screen.getByRole("link", { name: /Team access/ })).toHaveAttribute("href", "/access");
      fireEvent.change(screen.getByLabelText("Google email"), {
        target: { value: "new@example.test" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
      expect(await screen.findByLabelText("Private invitation code")).toHaveValue("private-code");
      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
      await waitFor(() => expect(copy).toHaveBeenCalledWith("private-code"));
      expect(fetcher).toHaveBeenCalledWith(
        "/api/v2/team-access",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ operation: "INVITE", target: "new@example.test" }),
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Dismiss code" }));
      expect(screen.queryByLabelText("Private invitation code")).toBeNull();
    },
  );
  it("hides entry and makes no management request for assistants", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    mount(false, "other@example.test");
    expect(screen.queryByRole("link", { name: /Team access/ })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("two studio owners");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("confirms revoke, refreshes authoritative status, restores and protects owners", async () => {
    let disabled = false;
    const fetcher = vi.fn(async (_input: unknown, options?: RequestInit) => {
      if (options?.method === "POST") {
        disabled = JSON.parse(String(options.body)).operation === "REVOKE";
        return Response.json({ updated: true });
      }
      return Response.json({ members: [members[0], { ...members[1], disabled }], invites: [] });
    });
    vi.stubGlobal("fetch", fetcher);
    mount();
    await screen.findByText("assistant@example.test");
    expect(screen.getAllByRole("button", { name: "Revoke access" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }));
    await screen.findByRole("button", { name: "Restore access" });
    fireEvent.click(screen.getByRole("button", { name: "Restore access" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm restore" }));
    await screen.findByRole("button", { name: "Revoke access" });
  });
  it("filters members and revokes pending invitations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          members,
          invites: [
            {
              id: "invite",
              email: "pending@example.test",
              state: "ACTIVE",
              expires_at: "2026-10-04T00:00:00Z",
            },
          ],
        }),
      ),
    );
    mount();
    await screen.findByText("assistant@example.test");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search members" }), {
      target: { value: "missing" },
    });
    expect(screen.getByText("No members match your search.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Revoke invitation" }));
    expect(
      within(screen.getByRole("dialog", { name: "Revoke access?" })).getByText(
        "pending@example.test",
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Revoke access?" })).toBeNull();
  });
  it("shows retryable list and invitation errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "TEAM_ALREADY_ADMITTED" } }, { status: 409 }),
      ),
    );
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("already has access");
    fireEvent.change(screen.getByLabelText("Google email"), {
      target: { value: "old@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    await waitFor(() => expect(screen.getAllByText(/already has access/)).toHaveLength(2));
    expect(screen.queryByLabelText("Private invitation code")).toBeNull();
  });
});
