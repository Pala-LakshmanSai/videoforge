import { useState } from "react";
import { Check, Plus, Repeat2, X } from "lucide-react";
import { authClient } from "./auth-client";

interface BrowserAccount {
  readonly session: { readonly token: string };
  readonly user: { readonly id: string; readonly email: string; readonly name: string };
}

export function AccountSwitcher({
  onSwitch,
  onAdd,
}: {
  onSwitch(sessionToken: string): Promise<void>;
  onAdd(): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<readonly BrowserAccount[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    // The server adopts pre-release sessions into signed, HttpOnly cookies.
    const current = await authClient.getSession();
    if (current.error) throw new Error("Accounts could not load. Please try again.");
    const result = await authClient.multiSession.listDeviceSessions();
    if (result.error || !Array.isArray(result.data))
      throw new Error("Accounts could not load. Please try again.");
    const saved = result.data ?? [];
    setAccounts(
      current.data
        ? [current.data, ...saved.filter((item) => item.user.id !== current.data?.user.id)]
        : saved,
    );
    setActiveId(current.data?.user.id ?? null);
  }

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
    <div className="account-switcher">
      <button
        type="button"
        className="account-signout"
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          setOpen(!open);
          if (!open) void run(load);
        }}
      >
        <Repeat2 size={16} aria-hidden="true" />
        Switch account
      </button>
      {open ? (
        <div className="account-switch-list" aria-label="Accounts in this browser">
          {busy ? <p role="status">Please wait…</p> : null}
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
                      await load();
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
          <p className="account-switch-help">
            {accounts.length >= 5 ? "Remove an account to add another. " : ""}Accounts stay signed
            in on this browser. Switching clears unsaved project inputs.
          </p>
          {error ? (
            <p role="alert" className="account-switch-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
