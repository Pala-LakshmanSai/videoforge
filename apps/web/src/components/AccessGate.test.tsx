import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FixtureAccessState } from "../lib/types";
import { AccessGate } from "./AccessGate";

afterEach(cleanup);

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
  it("enters the fixture queue through one explicit synthetic sign-in action", () => {
    const onContinue = vi.fn();

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
    const action = screen.getByRole("button", { name: "Continue to queue" });
    action.focus();
    expect(action).toHaveFocus();
    fireEvent.click(action);
    expect(onContinue).toHaveBeenCalledOnce();
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
    const picker = screen.getByRole("combobox", { name: "Fixture scenario" });
    fireEvent.change(picker, { target: { value: "happy_generating" } });
    expect(onScenarioChange).toHaveBeenCalledWith("happy_generating");
  });
});
