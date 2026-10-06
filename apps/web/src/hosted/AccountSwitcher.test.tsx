import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ multiSession: { revoke: vi.fn() } }));
vi.mock("./auth-client", () => ({ authClient: auth }));
import { AccountSwitcher } from "./AccountSwitcher";
const owner = {
  session: { token: "owner-session" },
  user: { id: "owner", email: "owner@example.test", name: "Owner" },
};
const other = {
  session: { token: "other-session" },
  user: { id: "other", email: "other@example.test", name: "Other" },
};
const props = () => ({
  onSwitch: vi.fn(async () => {}),
  onAdd: vi.fn(async () => {}),
  onRemove: vi.fn(),
  onRefresh: vi.fn(async () => {}),
  browserAccounts: { accounts: [owner, other], activeId: "owner", error: null },
});
beforeEach(() => {
  auth.multiSession.revoke.mockResolvedValue({ data: { status: true }, error: null });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("shows every preloaded account immediately without another toggle or loading text", () => {
  render(<AccountSwitcher {...props()} />);
  expect(screen.getByRole("button", { name: "Other other@example.test" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Owner owner@example.test Current" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Switch account" })).not.toBeInTheDocument();
  expect(screen.queryByText("Please wait…")).not.toBeInTheDocument();
});
it("switches the selected session and disables repeated actions without a wait message", async () => {
  const p = props();
  p.onSwitch = vi.fn(() => new Promise<void>(() => {}));
  render(<AccountSwitcher {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Other other@example.test" }));
  expect(p.onSwitch).toHaveBeenCalledWith("other-session");
  expect(screen.getByRole("button", { name: "Add another account" })).toBeDisabled();
  expect(screen.queryByText("Please wait…")).not.toBeInTheDocument();
});
it("updates only the removed session after confirmed revocation, without refetching", async () => {
  const p = props();
  render(<AccountSwitcher {...p} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Remove other@example.test from this browser" }),
  );
  await waitFor(() => expect(p.onRemove).toHaveBeenCalledWith("other-session"));
  expect(auth.multiSession.revoke).toHaveBeenCalledWith({ sessionToken: "other-session" });
  expect(p.onRefresh).not.toHaveBeenCalled();
});
it("keeps all accounts on failed removal and retains the five-account limit", async () => {
  const p = props();
  p.browserAccounts.accounts = [
    owner,
    ...Array.from({ length: 4 }, (_, i) => ({
      ...other,
      user: { ...other.user, id: String(i), email: `other${i}@example.test` },
    })),
  ];
  auth.multiSession.revoke.mockResolvedValue({ error: { message: "offline" } });
  render(<AccountSwitcher {...p} />);
  expect(screen.getByRole("button", { name: "Add another account" })).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove other3@example.test from this browser" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Account could not be removed");
  expect(p.onRemove).not.toHaveBeenCalled();
  expect(screen.getByText("owner@example.test")).toBeInTheDocument();
});
it("adds an account and allows explicit recovery from a preload failure", async () => {
  const p = props();
  render(
    <AccountSwitcher
      {...p}
      browserAccounts={{ ...p.browserAccounts, error: "Accounts could not load." }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add another account" }));
  await waitFor(() => expect(p.onAdd).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Retry accounts" }));
  await waitFor(() => expect(p.onRefresh).toHaveBeenCalledOnce());
});
