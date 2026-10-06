import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  multiSession: { listDeviceSessions: vi.fn(), revoke: vi.fn() },
}));
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
beforeEach(() => {
  auth.getSession.mockResolvedValue({ data: owner, error: null });
  auth.multiSession.listDeviceSessions.mockResolvedValue({ data: [owner, other], error: null });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("lists current and remembered accounts and switches using the selected session", async () => {
  const onSwitch = vi.fn(async () => {});
  render(<AccountSwitcher onSwitch={onSwitch} onAdd={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
  const target = await screen.findByRole("button", { name: "Other other@example.test" });
  expect(screen.getByRole("button", { name: "Owner owner@example.test Current" })).toBeDisabled();
  fireEvent.click(target);
  await waitFor(() => expect(onSwitch).toHaveBeenCalledWith("other-session"));
});
it("adopts an existing current account missing from remembered accounts", async () => {
  auth.multiSession.listDeviceSessions.mockResolvedValue({ data: [other], error: null });
  const onAdd = vi.fn(async () => {});
  render(<AccountSwitcher onSwitch={async () => {}} onAdd={onAdd} />);
  fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
  expect(await screen.findByText("owner@example.test")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add another account" }));
  await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
});
it("removes only the selected browser session and refreshes the list", async () => {
  auth.multiSession.revoke.mockResolvedValue({ data: { status: true }, error: null });
  render(<AccountSwitcher onSwitch={async () => {}} onAdd={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
  const remove = await screen.findByRole("button", {
    name: "Remove other@example.test from this browser",
  });
  auth.multiSession.listDeviceSessions.mockResolvedValue({ data: [owner], error: null });
  fireEvent.click(remove);
  await waitFor(() => expect(screen.queryByText("other@example.test")).not.toBeInTheDocument());
  expect(auth.multiSession.revoke).toHaveBeenCalledWith({ sessionToken: "other-session" });
});
it("blocks adding a sixth account and surfaces failures without dropping current access", async () => {
  auth.multiSession.listDeviceSessions.mockResolvedValue({
    data: [
      owner,
      ...Array.from({ length: 4 }, (_, i) => ({
        ...other,
        user: { ...other.user, id: String(i), email: `other${i}@example.test` },
      })),
    ],
    error: null,
  });
  render(<AccountSwitcher onSwitch={async () => {}} onAdd={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
  await screen.findByText("other3@example.test");
  expect(screen.getByRole("button", { name: "Add another account" })).toBeDisabled();
  auth.multiSession.revoke.mockResolvedValue({ error: { message: "offline" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Remove other3@example.test from this browser" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Account could not be removed");
  expect(screen.getByText("owner@example.test")).toBeInTheDocument();
});

it("rejects an invalid session-list response with a readable error", async () => {
  auth.multiSession.listDeviceSessions.mockResolvedValue({
    data: "not an account list",
    error: null,
  });
  render(<AccountSwitcher onSwitch={async () => {}} onAdd={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Accounts could not load. Please try again.",
  );
});
