import {
  Aperture,
  ArrowRight,
  ChevronDown,
  Check,
  Clapperboard,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { ApiError, api } from "../lib/api";
import { scenarioIds, type FixtureAccessState, type ScenarioId } from "../lib/types";
import { AppSelect } from "./ui";
import "./AccessGate.css";

interface FixturePickerProps {
  enabled: boolean;
  scenario: ScenarioId;
  onScenarioChange: (scenario: ScenarioId) => void;
}

function FixturePicker({ enabled, scenario, onScenarioChange }: FixturePickerProps) {
  if (!enabled) return null;

  return (
    <details className="access-fixture-picker">
      <summary>
        <Aperture size={16} aria-hidden="true" />
        <span>Fixture</span>
        <ChevronDown className="access-fixture-chevron" size={16} aria-hidden="true" />
      </summary>
      <div className="access-fixture-field">
        <span>Scenario</span>
        <AppSelect
          label="Fixture scenario"
          value={scenario}
          onValueChange={(value) => onScenarioChange(value as ScenarioId)}
          options={scenarioIds.map((id) => ({ value: id, label: id }))}
        />
      </div>
      <small>Synthetic data · no provider calls · $0 spend</small>
    </details>
  );
}

interface AccessFrameProps extends FixturePickerProps {
  children: ReactNode;
}

function AccessFrame({ children, ...fixturePickerProps }: AccessFrameProps) {
  return (
    <div className="access-shell">
      <a className="skip-link" href="#access-content">
        Skip to content
      </a>
      <span className="access-orbit access-orbit-one" aria-hidden="true" />
      <span className="access-orbit access-orbit-two" aria-hidden="true" />
      <header className="access-header">
        <span className="access-brand" aria-label="VideoForge">
          <span className="access-brand-mark" aria-hidden="true">
            <Clapperboard size={25} />
          </span>
          <strong>VideoForge</strong>
        </span>
        <FixturePicker {...fixturePickerProps} />
      </header>
      <main className="access-main" id="access-content">
        {children}
      </main>
    </div>
  );
}

export interface AccessGateProps extends FixturePickerProps {
  access: FixtureAccessState;
  onContinue: () => void;
  onTryAnotherAccount: () => void;
}

type IssuedFixtureInvite = Awaited<ReturnType<typeof api.issueFixtureInvite>>;
type FixtureInvite = Pick<IssuedFixtureInvite, "code" | "googleAssertion">;

const FIXTURE_INVITE_STORAGE_PREFIX = "videoforge.fixture-invite.v1:";

function fixtureInviteStorageKey(email: string): string {
  return `${FIXTURE_INVITE_STORAGE_PREFIX}${email.trim().toLocaleLowerCase()}`;
}

function isFixtureInvite(value: unknown): value is FixtureInvite {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return ["code", "googleAssertion"].every(
    (key) => typeof candidate[key] === "string" && candidate[key],
  );
}

function readFixtureInvite(email: string): FixtureInvite | null {
  if (!email || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(fixtureInviteStorageKey(email));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isFixtureInvite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function storeFixtureInvite(email: string, invite: FixtureInvite): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(fixtureInviteStorageKey(email), JSON.stringify(invite));
  } catch {
    // Storage is best-effort; the current screen still holds the invite in memory.
  }
}

function clearFixtureInvite(email: string): void {
  if (!email || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(fixtureInviteStorageKey(email));
  } catch {
    // Storage is best-effort; successful authentication still completes normally.
  }
}

function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === "INVITE_EMAIL_EXISTS") {
    return "This invitation is already in progress. Retry from the same browser to finish it, or restart the local fixture session.";
  }
  if (error instanceof ApiError && error.code === "INVITE_ALREADY_USED") {
    return "This invitation was already used. Retry access to continue with the signed-in Google account.";
  }
  return error instanceof Error ? error.message : "Fixture sign-in failed.";
}

export function AccessGate({
  access,
  onContinue,
  onTryAnotherAccount,
  ...fixturePickerProps
}: AccessGateProps) {
  const denied = access.state === "DENIED";
  const account = access.selectedAccount;
  const [authError, setAuthError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [invite, setInvite] = useState<FixtureInvite | null>(null);
  const email = account?.email ?? "";

  useEffect(() => {
    setInvite(readFixtureInvite(email));
    setAuthError(null);
  }, [email, fixturePickerProps.scenario]);

  async function beginGoogleSignIn() {
    if (!email) {
      setAuthError("No invited fixture account is selected.");
      return;
    }

    const existing = readFixtureInvite(email);
    if (existing) {
      setInvite(existing);
      return;
    }

    setPending(true);
    setAuthError(null);
    try {
      const issued = await api.issueFixtureInvite(email);
      const safeInvite: FixtureInvite = {
        code: issued.code,
        googleAssertion: issued.googleAssertion,
      };
      storeFixtureInvite(email, safeInvite);
      setInvite(safeInvite);
    } catch (error) {
      setAuthError(authErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function finishInvitation() {
    if (!email) {
      setAuthError("No invited fixture account is selected.");
      return;
    }
    const issued = invite ?? readFixtureInvite(email);
    if (!issued) {
      setAuthError("Start with Google to prepare the invitation.");
      return;
    }

    setPending(true);
    setAuthError(null);
    try {
      await api.authenticateFixture(
        {
          method: "GOOGLE",
          email,
          googleAccountEmail: email,
          googleAssertion: issued.googleAssertion,
          inviteCode: issued.code,
        },
        fixturePickerProps.scenario,
      );
      clearFixtureInvite(email);
      setInvite(null);
      onContinue();
    } catch (error) {
      setAuthError(authErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <AccessFrame {...fixturePickerProps}>
      <div className={`access-layout ${denied ? "access-layout-denied" : ""}`}>
        {!denied ? (
          <aside className="access-context" aria-label="VideoForge Studio">
            <div className="access-context-mark" aria-hidden="true">
              <Clapperboard size={21} />
            </div>
            <p className="access-context-kicker">VideoForge Studio</p>
            <h2>Turn a voiceover into a finished cut.</h2>
            <p>
              Build an authentic, documentary-style video in one focused workspace—from first frame
              to final download.
            </p>
            <div className="access-context-points" aria-label="Workspace features">
              <span>
                <Check size={15} aria-hidden="true" />
                Private by default
              </span>
              <span>
                <Check size={15} aria-hidden="true" />
                Invite-only access
              </span>
              <span>
                <Check size={15} aria-hidden="true" />
                Fixture mode available
              </span>
            </div>
          </aside>
        ) : null}

        <section
          className={`access-card ${denied ? "access-card-denied" : ""}`}
          aria-labelledby="access-heading"
        >
          <div className={`access-lock ${denied ? "access-lock-denied" : ""}`} aria-hidden="true">
            {denied ? <LockKeyhole size={26} /> : <ShieldCheck size={27} />}
          </div>
          <p className="access-eyebrow">{denied ? "Access blocked" : "Invite only"}</p>
          <h1 id="access-heading">{denied ? "Invite required" : "Enter VideoForge"}</h1>
          <p className="access-lead">
            {denied
              ? `${account?.email ?? "This account"} cannot access ${access.workspaceName}.`
              : `${access.workspaceName} is invite-only. Use the Google account that received the invitation.`}
          </p>

          {denied && account ? (
            <div className="access-account" aria-label="Selected invited account">
              <span className="access-account-avatar" aria-hidden="true">
                <UserRound size={21} />
              </span>
              <span className="access-account-copy">
                <small>Signing in as</small>
                <strong>{account.displayName}</strong>
                <span>{account.email}</span>
              </span>
              <span className={`access-account-state ${denied ? "is-denied" : ""}`}>
                {!denied ? <Check size={13} aria-hidden="true" /> : null}
                {denied ? "Not invited" : "Invited"}
              </span>
            </div>
          ) : null}

          {denied ? (
            <div className="access-blocker" role="alert">
              <LockKeyhole size={18} aria-hidden="true" />
              <span>
                <strong>Workspace invite missing</strong>
                <small>{access.reason ?? "Ask a workspace admin to invite this account."}</small>
              </span>
            </div>
          ) : (
            <div className="access-sign-in" aria-label="Google sign-in">
              <div className="access-local-note" id="access-local-note" role="note">
                <span className="access-local-note-icon" aria-hidden="true">
                  <ShieldCheck size={17} />
                </span>
                <span>
                  <strong>Fixture mode · $0 spend</strong>
                  <small>
                    Google sign-in is simulated locally. No request leaves this computer.
                  </small>
                </span>
              </div>

              {invite ? (
                <div className="access-local-note" role="status">
                  <span className="access-local-note-icon" aria-hidden="true">
                    <Check size={17} />
                  </span>
                  <span>
                    <strong>Google verified</strong>
                    <small>Your one-time invitation is ready to finish.</small>
                  </span>
                </div>
              ) : null}

              {authError ? (
                <div className="access-blocker" role="alert">
                  <LockKeyhole size={18} aria-hidden="true" />
                  <span>{authError}</span>
                </div>
              ) : null}
            </div>
          )}

          <button
            className={`access-primary-action ${denied ? "access-secondary-action" : ""}`}
            type="button"
            disabled={pending || (!denied && !email)}
            onClick={
              denied
                ? onTryAnotherAccount
                : invite
                  ? () => void finishInvitation()
                  : () => void beginGoogleSignIn()
            }
          >
            <span>
              {denied
                ? "Try another account"
                : pending
                  ? "Signing you in…"
                  : invite
                    ? "Finish invitation"
                    : "Continue with Google"}
            </span>
            <ArrowRight size={19} aria-hidden="true" />
          </button>

          <p className="access-action-help">
            {denied
              ? "Use an invited account to enter this workspace."
              : invite
                ? "Confirm once to enter your workspace."
                : "Use the Google account that received this invite."}
          </p>

          {denied ? (
            <div className="access-footnote">
              <p>
                Workspace admin: <a href={`mailto:${access.adminContact}`}>{access.adminContact}</a>
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </AccessFrame>
  );
}

export function AccessGatePending(props: FixturePickerProps) {
  return (
    <AccessFrame {...props}>
      <section className="access-card access-card-pending" aria-busy="true" aria-live="polite">
        <span className="access-spinner" aria-hidden="true" />
        <p className="access-eyebrow">Invite only</p>
        <h1>Checking access</h1>
        <p className="access-lead">Confirming the selected fixture account.</p>
      </section>
    </AccessFrame>
  );
}

export interface AccessGateUnavailableProps extends FixturePickerProps {
  onRetry: () => void;
}

export function AccessGateUnavailable({ onRetry, ...props }: AccessGateUnavailableProps) {
  return (
    <AccessFrame {...props}>
      <section className="access-card access-card-denied" role="alert">
        <div className="access-lock access-lock-denied" aria-hidden="true">
          <LockKeyhole size={26} />
        </div>
        <p className="access-eyebrow">Access check failed</p>
        <h1>Could not verify access</h1>
        <p className="access-lead">
          The local fixture API did not respond. Retry before entering the workspace.
        </p>
        <button
          className="access-primary-action access-secondary-action"
          type="button"
          onClick={onRetry}
        >
          <span>Retry access check</span>
          <ArrowRight size={19} aria-hidden="true" />
        </button>
      </section>
    </AccessFrame>
  );
}
