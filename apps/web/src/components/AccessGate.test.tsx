import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FixtureAccessState } from "../lib/types";
import { AccessGate } from "./AccessGate";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const invitedAccess: FixtureAccessState = {
  state: "SIGN_IN_REQUIRED",
  selectedAccount: {
    displayName: "Lakshman (fixture)",
    email: "lakshman.fixture@example.invalid",
  },
  workspaceName: "VideoForge Studio",
  adminContact: "admin.fixture@example.invalid",
  reason: null,
};

const deniedAccess: FixtureAccessState = {
  state: "DENIED",
  selectedAccount: {
    displayName: "Guest account (fixture)",
    email: "guest.fixture@example.invalid",
  },
  workspaceName: "VideoForge Studio",
  adminContact: "admin.fixture@example.invalid",
  reason: "This account has not been invited to this workspace.",
};

describe("AccessGate", () => {
  it("enters through provider-free invite admission and clears the one-time code", async () => {
    const onContinue = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "vf_one_time_secret_for_test", shownOnce: true }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            outcome: "ADMITTED",
            email: "lakshman.fixture@example.invalid",
            rights: "EQUAL",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);

    render(
      <AccessGate
        access={invitedAccess}
        enabled
        scenario="invite_sign_in"
        onContinue={onContinue}
        onTryAnotherAccount={vi.fn()}
        onScenarioChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Enter VideoForge" })).toBeVisible();
    expect(screen.getByText("Fixture sign-in · no Google request will be sent")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create one-time local invite" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const action = screen.getByRole("button", { name: "Continue to queue" });
    action.focus();
    expect(action).toHaveFocus();
    fireEvent.click(action);
    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("One-time invite code")).toHaveValue("");
  });

  it("shows the exact invite blocker without rendering workspace console data", () => {
    const onTryAnotherAccount = vi.fn();

    render(
      <AccessGate
        access={deniedAccess}
        enabled
        scenario="invite_access_denied"
        onContinue={vi.fn()}
        onTryAnotherAccount={onTryAnotherAccount}
        onScenarioChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Invite required" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Workspace invite missing");
    expect(screen.getByText("This account has not been invited to this workspace.")).toBeVisible();
    expect(
      screen.queryByRole("navigation", { name: "Primary navigation" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("How to Recognize a Sweet Watermelon")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try another account" }));
    expect(onTryAnotherAccount).toHaveBeenCalledOnce();
  });

  it("keeps a development-only fixture escape reachable", () => {
    const onScenarioChange = vi.fn();

    render(
      <AccessGate
        access={deniedAccess}
        enabled
        scenario="invite_access_denied"
        onContinue={vi.fn()}
        onTryAnotherAccount={vi.fn()}
        onScenarioChange={onScenarioChange}
      />,
    );

    fireEvent.click(screen.getByText("Fixture"));
    fireEvent.click(screen.getByLabelText("Fixture scenario"));
    fireEvent.click(screen.getByRole("option", { name: "happy_generating" }));
    expect(onScenarioChange).toHaveBeenCalledWith("happy_generating");
  });
});
