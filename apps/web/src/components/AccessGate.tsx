import {
  Aperture,
  ArrowRight,
  ChevronDown,
  Check,
  Chrome,
  Clapperboard,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { api } from "../lib/api";
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

export function AccessGate({
  access,
  onContinue,
  onTryAnotherAccount,
  ...fixturePickerProps
}: AccessGateProps) {
  const denied = access.state === "DENIED";
  const account = access.selectedAccount;
  const [method, setMethod] = useState<"EMAIL_PASSWORD" | "GOOGLE">("EMAIL_PASSWORD");
  const [authError, setAuthError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const email = account?.email ?? "";

  useEffect(() => {
    setMethod("EMAIL_PASSWORD");
    setAuthError(null);
  }, [email, fixturePickerProps.scenario]);

  async function authenticate() {
    if (!email) {
      setAuthError("No invited fixture account is selected.");
      return;
    }

    setPending(true);
    setAuthError(null);
    try {
      const invite = await api.issueFixtureInvite(email);
      await api.authenticateFixture(
        {
          method,
          email,
          emailPassword: method === "EMAIL_PASSWORD" ? invite.emailPassword : undefined,
          googleAccountEmail: method === "GOOGLE" ? email : undefined,
          googleAssertion: method === "GOOGLE" ? invite.googleAssertion : undefined,
          inviteCode: invite.code,
        },
        fixturePickerProps.scenario,
      );
      onContinue();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Fixture sign-in failed.");
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
              : `Continue to ${access.workspaceName} with the selected invited account.`}
          </p>

          {account ? (
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
            <div className="access-sign-in" aria-label="Provider-free authentication fixture">
              <fieldset className="access-methods">
                <legend>Choose sign-in method</legend>
                <div
                  className="access-method-options"
                  role="radiogroup"
                  aria-label="Sign-in method"
                >
                  <label
                    className={`access-method ${method === "EMAIL_PASSWORD" ? "selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="fixture-sign-in-method"
                      value="EMAIL_PASSWORD"
                      checked={method === "EMAIL_PASSWORD"}
                      onChange={() => setMethod("EMAIL_PASSWORD")}
                      aria-label="Email"
                    />
                    <span className="access-method-icon" aria-hidden="true">
                      <Mail size={17} />
                    </span>
                    <span className="access-method-copy">
                      <strong>Email</strong>
                      <small>Local fixture</small>
                    </span>
                    <span className="access-method-check" aria-hidden="true">
                      {method === "EMAIL_PASSWORD" ? <Check size={15} /> : null}
                    </span>
                  </label>
                  <label className={`access-method ${method === "GOOGLE" ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="fixture-sign-in-method"
                      value="GOOGLE"
                      checked={method === "GOOGLE"}
                      onChange={() => setMethod("GOOGLE")}
                      aria-label="Google"
                    />
                    <span
                      className="access-method-icon access-method-icon-google"
                      aria-hidden="true"
                    >
                      <Chrome size={17} />
                    </span>
                    <span className="access-method-copy">
                      <strong>Google</strong>
                      <small>Simulated locally</small>
                    </span>
                    <span className="access-method-check" aria-hidden="true">
                      {method === "GOOGLE" ? <Check size={15} /> : null}
                    </span>
                  </label>
                </div>
              </fieldset>

              <div className="access-local-note" id="access-local-note" role="note">
                <span className="access-local-note-icon" aria-hidden="true">
                  <ShieldCheck size={17} />
                </span>
                <span>
                  <strong>Fixture mode · $0 spend</strong>
                  <small>No email, Google, or external request will be sent.</small>
                </span>
              </div>

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
            onClick={denied ? onTryAnotherAccount : () => void authenticate()}
          >
            <span>
              {denied
                ? "Try another account"
                : pending
                  ? "Signing you in…"
                  : `Continue with ${method === "EMAIL_PASSWORD" ? "Email" : "Google"}`}
            </span>
            <ArrowRight size={19} aria-hidden="true" />
          </button>

          <p className="access-action-help">
            {denied
              ? "Use an invited account to enter this workspace."
              : "One click creates and redeems your local invite."}
          </p>

          <div className="access-footnote">
            {denied ? (
              <p>
                Workspace admin: <a href={`mailto:${access.adminContact}`}>{access.adminContact}</a>
              </p>
            ) : (
              <p>
                <Aperture size={14} aria-hidden="true" />
                Local fixture sign-in · nothing leaves this computer
              </p>
            )}
          </div>
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
