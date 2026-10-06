import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { authClient, type BrowserAccounts } from "./auth-client";

export function AccountSwitcher({
  onSwitch,
  onAdd,
  browserAccounts,
  onRemove,
  onRefresh,
}: {
  onSwitch(sessionToken: string): Promise<void>;
  onAdd(): Promise<void>;
  browserAccounts: BrowserAccounts;
  onRemove(sessionToken: string): void;
  onRefresh(): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { accounts, activeId } = browserAccounts;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Account action failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-switch-list" aria-label="Accounts in this browser">
      {accounts.map(({ session, user }) => (
        <div className="account-switch-row" key={user.id}>
          <button
            type="button"
            className="account-switch-choice"
            disabled={busy || user.id === activeId}
            onClick={() => void run(() => onSwitch(session.token))}
          >
            <span>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            {user.id === activeId ? (
              <span className="account-current">
                <Check size={14} aria-hidden="true" />
                Current
              </span>
            ) : null}
          </button>
          {user.id !== activeId ? (
            <button
              type="button"
              className="account-remove"
              disabled={busy}
              aria-label={`Remove ${user.email} from this browser`}
              onClick={() =>
                void run(async () => {
                  const result = await authClient.multiSession.revoke({
                    sessionToken: session.token,
                  });
                  if (result.error)
                    throw new Error("Account could not be removed. Please try again.");
                  onRemove(session.token);
                })
              }
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="account-signout"
        disabled={busy || accounts.length >= 5}
        onClick={() => void run(onAdd)}
      >
        <Plus size={16} aria-hidden="true" />
        Add another account
      </button>
      {accounts.length >= 5 ? (
        <p className="account-switch-help">Remove an account to add another.</p>
      ) : null}
      {error || browserAccounts.error ? (
        <div role="alert" className="account-switch-error">
          {error ?? browserAccounts.error}
          {browserAccounts.error ? (
            <button type="button" disabled={busy} onClick={() => void run(onRefresh)}>
              Retry accounts
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
