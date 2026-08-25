import { createAuthClient } from "better-auth/react";
import { useEffect, useState, type PropsWithChildren } from "react";

interface Tenant {
  readonly account_id: string;
  readonly workspace_id: string;
  readonly workspace_name: string;
  readonly user: { readonly email: string; readonly name: string };
}

interface HostedStatus {
  readonly authentication: readonly ("GOOGLE" | "EMAIL_PASSWORD")[];
}

type HostedAccess =
  | { readonly state: "SIGNED_OUT" }
  | { readonly state: "INVITE_REQUIRED" }
  | { readonly state: "ADMITTED"; readonly tenant: Tenant };

const authClient = createAuthClient({ baseURL: window.location.origin, basePath: "/api/auth" });

async function tenantAccess(): Promise<HostedAccess> {
  const response = await fetch("/api/v2/tenant", { headers: { accept: "application/json" } });
  if (response.status === 401) return { state: "SIGNED_OUT" };
  if (response.status === 403) return { state: "INVITE_REQUIRED" };
  if (!response.ok) throw new Error("Hosted tenant check failed.");
  return { state: "ADMITTED", tenant: (await response.json()) as Tenant };
}

export function HostedStagingApp({ children }: PropsWithChildren) {
  const [access, setAccess] = useState<HostedAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<HostedStatus | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setAccess(await tenantAccess());
    } catch {
      setMessage("Hosted staging is unavailable. No local fallback was used.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    void fetch("/api/v2/hosted/status", { headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error("Hosted status failed.");
        return response.json() as Promise<HostedStatus>;
      })
      .then(setStatus)
      .catch(() => setMessage("Hosted staging is unavailable. No local fallback was used."));
  }, []);

  async function signIn() {
    setMessage(null);
    const result = await authClient.signIn.email({ email, password });
    if (result.error) setMessage(result.error.message ?? "Sign-in failed.");
    else await refresh();
  }

  async function signUp() {
    setMessage(null);
    const result = await authClient.signUp.email({
      email,
      password,
      name: email.split("@")[0] || "VideoForge user",
    });
    setMessage(
      result.error?.message ?? "Check the invited email address to verify it before signing in.",
    );
  }

  async function resetPassword() {
    setMessage(null);
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setMessage(
      result.error?.message ?? "If this invited account exists, a reset email was requested.",
    );
  }

  async function signOut() {
    setMessage(null);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setMessage("Sign-out failed. Please try again.");
        return;
      }
      await refresh();
    } catch {
      setMessage("Sign-out failed. Please try again.");
    }
  }

  if (loading)
    return (
      <main className="hosted-stage">
        <section>
          <p>Checking private hosted access…</p>
        </section>
      </main>
    );
  if (access?.state === "ADMITTED") {
    return children;
  }
  if (access?.state === "INVITE_REQUIRED") {
    return (
      <main className="hosted-stage">
        <section>
          <p>V2-06 private staging</p>
          <h1>Invite required</h1>
          <p>This signed-in account does not have access to VideoForge.</p>
          <p>Ask for an invitation, or sign out and use a different invited account.</p>
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
          {message ? <p role="status">{message}</p> : null}
        </section>
      </main>
    );
  }
  return (
    <main className="hosted-stage">
      <section>
        <p>V2-06 private staging</p>
        <h1>Enter VideoForge</h1>
        <p>Only pre-invited, verified accounts are admitted.</p>
        <div>
          <button
            type="button"
            onClick={() =>
              void authClient.signIn.social({
                provider: "google",
                callbackURL: window.location.origin,
              })
            }
          >
            Continue with Google
          </button>
        </div>
        {status?.authentication.includes("EMAIL_PASSWORD") ? (
          <>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <div>
              <button type="button" onClick={() => void signIn()}>
                Sign in with email
              </button>
              <button type="button" onClick={() => void signUp()}>
                Create invited account
              </button>
              <button type="button" onClick={() => void resetPassword()}>
                Reset password
              </button>
            </div>
          </>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
      </section>
    </main>
  );
}
