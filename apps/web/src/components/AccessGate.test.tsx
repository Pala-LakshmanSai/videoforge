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
  it("signs in with one local action without exposing fixture secrets", async () => {
    const onContinue = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "vf_one_time_secret_for_test",
            emailPassword: "vf_pw_fixture_value_for_test",
            googleAssertion: "vf_google_fixture_assertion_for_test",
            shownOnce: true,
          }),
          { status: 200 },
        ),
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
    expect(screen.getByRole("note")).toHaveTextContent(
      "No email, Google, or external request will be sent.",
    );
    expect(screen.queryByLabelText("Synthetic verified email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email password fixture")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("One-time invite code")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Email" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Google" })).not.toBeChecked();
    const action = screen.getByRole("button", { name: "Continue with Email" });
    expect(action).toBeEnabled();
    action.focus();
    expect(action).toHaveFocus();
    fireEvent.click(action);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/dev/shared-app/invites");
    expect(fetch.mock.calls[1]?.[0]).toBe("/api/v2/auth/fixture?fixture=invite_sign_in");
    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
  });

  it("uses the selected Google fixture method through the same one-click action", async () => {
    const onContinue = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "vf_one_time_secret_for_google_test",
            emailPassword: "vf_pw_fixture_value_for_google_test",
            googleAssertion: "vf_google_fixture_assertion_for_test",
            shownOnce: true,
          }),
          { status: 200 },
        ),
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

    fireEvent.click(screen.getByRole("radio", { name: "Google" }));
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());

    const body = JSON.parse((fetch.mock.calls[1]?.[1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      method: "GOOGLE",
      email: "lakshman.fixture@example.invalid",
      googleAccountEmail: "lakshman.fixture@example.invalid",
      googleAssertion: "vf_google_fixture_assertion_for_test",
      inviteCode: "vf_one_time_secret_for_google_test",
    });
  });

  it("surfaces a local invite error without exposing the fixture form", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "FIXTURE_INVITE_FAILED",
            detail: "The local fixture invite could not be created.",
            retryable: true,
          },
        }),
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    render(
      <AccessGate
        access={invitedAccess}
        enabled
        scenario="invite_sign_in"
        onContinue={vi.fn()}
        onTryAnotherAccount={vi.fn()}
        onScenarioChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue with Email" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The local fixture invite could not be created.",
      ),
    );
    expect(screen.getByRole("button", { name: "Continue with Email" })).toBeEnabled();
    expect(fetch).toHaveBeenCalledOnce();
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
