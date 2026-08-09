import {
  Aperture,
  ArrowRight,
  ChevronDown,
  Clapperboard,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";

import { scenarioIds, type FixtureAccessState, type ScenarioId } from "../lib/types";
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
      <label>
        <span>Scenario</span>
        <select
          aria-label="Fixture scenario"
          value={scenario}
          onChange={(event) => onScenarioChange(event.target.value as ScenarioId)}
        >
          {scenarioIds.map((id) => (
            <option value={id} key={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
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

  return (
    <AccessFrame {...fixturePickerProps}>
      <section className={`access-card ${denied ? "access-card-denied" : ""}`}>
        <div className={`access-lock ${denied ? "access-lock-denied" : ""}`} aria-hidden="true">
          {denied ? <LockKeyhole size={26} /> : <ShieldCheck size={27} />}
        </div>
        <p className="access-eyebrow">{denied ? "Access blocked" : "Invite only"}</p>
        <h1>{denied ? "Invite required" : "Enter VideoForge"}</h1>
        <p className="access-lead">
          {denied
            ? `${account?.email ?? "This account"} cannot access ${access.workspaceName}.`
            : `Continue to ${access.workspaceName} with the selected invited account.`}
        </p>

        {account ? (
          <div className="access-account" aria-label="Selected account">
            <span className="access-account-avatar" aria-hidden="true">
              <UserRound size={22} />
            </span>
            <span>
              <strong>{account.displayName}</strong>
              <small>{account.email}</small>
            </span>
            <span className={`access-account-state ${denied ? "is-denied" : ""}`}>
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
        ) : null}

        <button
          className={`access-primary-action ${denied ? "access-secondary-action" : ""}`}
          type="button"
          onClick={denied ? onTryAnotherAccount : onContinue}
        >
          <span>{denied ? "Try another account" : "Continue to queue"}</span>
          <ArrowRight size={19} aria-hidden="true" />
        </button>

        <div className="access-footnote">
          {denied ? (
            <p>
              Workspace admin: <a href={`mailto:${access.adminContact}`}>{access.adminContact}</a>
            </p>
          ) : (
            <p>
              <Aperture size={14} aria-hidden="true" />
              Fixture sign-in · no Google request will be sent
            </p>
          )}
        </div>
      </section>
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
