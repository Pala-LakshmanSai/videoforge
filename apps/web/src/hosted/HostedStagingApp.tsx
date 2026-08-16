import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";

interface Tenant {
  readonly account_id: string;
  readonly workspace_id: string;
  readonly workspace_name: string;
  readonly user: { readonly email: string; readonly name: string };
}

const authClient = createAuthClient({ baseURL: window.location.origin, basePath: "/api/auth" });

async function tenant(): Promise<Tenant | null> {
  const response = await fetch("/api/v2/tenant", { headers: { accept: "application/json" } });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("Hosted tenant check failed.");
  return response.json() as Promise<Tenant>;
}

export function HostedStagingApp() {
  const [scope, setScope] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setScope(await tenant());
    } catch {
      setMessage("Hosted staging is unavailable. No local fallback was used.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
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

  if (loading)
    return (
      <main className="hosted-stage">
        <section>
          <p>Checking private hosted access…</p>
        </section>
      </main>
    );
  if (scope) {
    return (
      <main className="hosted-stage">
        <section>
          <p>V2-06 private staging</p>
          <h1>{scope.workspace_name}</h1>
          <p>Signed in as {scope.user.email}</p>
          <dl>
            <dt>Account</dt>
            <dd>{scope.account_id}</dd>
            <dt>Workspace</dt>
            <dd>{scope.workspace_id}</dd>
            <dt>Database</dt>
            <dd>Neon tenant scope active</dd>
            <dt>Artifacts</dt>
            <dd>Private R2 signed ports</dd>
            <dt>CPU media</dt>
            <dd>Cloud Run Jobs, scale to zero</dd>
            <dt>GPU</dt>
            <dd>Disabled · fixture transport only</dd>
          </dl>
          <button type="button" onClick={() => void authClient.signOut().then(refresh)}>
            Sign out
          </button>
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
            Sign in
          </button>
          <button type="button" onClick={() => void signUp()}>
            Create invited account
          </button>
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
          <button type="button" onClick={() => void resetPassword()}>
            Reset password
          </button>
        </div>
        {message ? <p role="status">{message}</p> : null}
      </section>
    </main>
  );
}
