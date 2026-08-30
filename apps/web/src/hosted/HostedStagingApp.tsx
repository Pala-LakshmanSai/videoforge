import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";

interface Tenant {
  readonly schema_version: "videoforge-hosted-tenant/v1";
  readonly account_id: string;
  readonly workspace_id: string;
  readonly workspace_name: string;
  readonly user: { readonly id: string; readonly email: string; readonly name: string };
}

interface HostedStatus {
  readonly authentication: readonly ("GOOGLE" | "EMAIL_PASSWORD")[];
}

interface HostedInviteProblem {
  readonly error?: { readonly code?: string };
}

type HostedAccess =
  | { readonly state: "SIGNED_OUT" }
  | { readonly state: "INVITE_REQUIRED" }
  | { readonly state: "ADMITTED"; readonly tenant: Tenant };

const authClient = createAuthClient({ baseURL: window.location.origin, basePath: "/api/auth" });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTenant(value: unknown): Tenant {
  if (!isRecord(value) || value.schema_version !== "videoforge-hosted-tenant/v1") {
    throw new Error("Hosted tenant response invalid.");
  }
  const user = value.user;
  if (
    !isNonEmptyString(value.account_id) ||
    !isNonEmptyString(value.workspace_id) ||
    !isNonEmptyString(value.workspace_name) ||
    !isRecord(user) ||
    !isNonEmptyString(user.id) ||
    !isNonEmptyString(user.email) ||
    !isNonEmptyString(user.name)
  ) {
    throw new Error("Hosted tenant response invalid.");
  }
  return {
    schema_version: "videoforge-hosted-tenant/v1",
    account_id: value.account_id,
    workspace_id: value.workspace_id,
    workspace_name: value.workspace_name,
    user: { id: user.id, email: user.email, name: user.name },
  };
}

async function tenantAccess(): Promise<HostedAccess> {
  const response = await fetch("/api/v2/tenant", { headers: { accept: "application/json" } });
  if (response.status === 401) return { state: "SIGNED_OUT" };
  if (response.status === 403) return { state: "INVITE_REQUIRED" };
  if (!response.ok) throw new Error("Hosted tenant check failed.");
  return { state: "ADMITTED", tenant: parseTenant(await response.json()) };
}

export function HostedStagingApp({ children }: PropsWithChildren) {
  const [access, setAccess] = useState<HostedAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [redeemingInvite, setRedeemingInvite] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<HostedStatus | null>(null);
  const refreshRequest = useRef(0);

  const refresh = useCallback(async (preserveAdmittedView = false) => {
    const requestId = ++refreshRequest.current;
    if (!preserveAdmittedView) {
      setLoading(true);
      setAccess(null);
    }
    try {
      const nextAccess = await tenantAccess();
      if (requestId === refreshRequest.current) setAccess(nextAccess);
    } catch {
      if (requestId === refreshRequest.current) {
        setAccess(null);
        setMessage("Hosted staging is unavailable. No local fallback was used.");
      }
    } finally {
      if (requestId === refreshRequest.current && !preserveAdmittedView) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void fetch("/api/v2/hosted/status", { headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error("Hosted status failed.");
        return response.json() as Promise<HostedStatus>;
      })
      .then(setStatus)
      .catch(() => setMessage("Hosted staging is unavailable. No local fallback was used."));
  }, [refresh]);

  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === "visible" && access?.state === "ADMITTED") {
        void refresh(true);
      }
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [access?.state, refresh]);

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
    refreshRequest.current += 1;
    setAccess(null);
    setLoading(true);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setMessage("Sign-out failed. Please try again.");
        setLoading(false);
        return;
      }
      await refresh();
    } catch {
      setMessage("Sign-out failed. Please try again.");
      setLoading(false);
    }
  }

  async function startGoogleSignIn() {
    setMessage(null);
    refreshRequest.current += 1;
    setAccess(null);
    setLoading(true);

    try {
      const signOutResult = await authClient.signOut();
      if (signOutResult.error) {
        setMessage("Could not clear the previous session. Please try again.");
        setLoading(false);
        return;
      }
    } catch {
      setMessage("Could not clear the previous session. Please try again.");
      setLoading(false);
      return;
    }

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
      });
      if (result.error) setMessage(result.error.message ?? "Google sign-in failed.");
    } catch {
      setMessage("Google sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function redeemInvite() {
    const presentedCode = inviteCode;
    setInviteCode("");
    setMessage(null);
    setRedeemingInvite(true);
    try {
      const response = await fetch("/api/v2/invite/redemption", {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          schema_version: "videoforge-hosted-invite-redemption/v1",
          invite_code: presentedCode,
        }),
      });
      if (response.ok) {
        await refresh();
        return;
      }
      if (response.status === 401) {
        await refresh();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as HostedInviteProblem;
      const code = body.error?.code;
      setMessage(
        code === "INVITE_ALREADY_USED"
          ? "That invitation code was already used."
          : code === "INVITE_REVOKED"
            ? "That invitation code was revoked."
            : code === "INVITE_EXPIRED"
              ? "That invitation code expired."
              : code === "INVITE_EMAIL_MISMATCH"
                ? "That invitation code belongs to a different Google account."
                : code === "EMAIL_VERIFICATION_REQUIRED"
                  ? "Google must verify this email before admission."
                  : "That invitation code is invalid.",
      );
    } catch {
      setMessage("Invitation redemption is unavailable. No local fallback was used.");
    } finally {
      setRedeemingInvite(false);
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
          <h1>Enter your invitation code</h1>
          <p>The code must match this signed-in, verified Google account.</p>
          <label>
            Invitation code
            <input
              type="password"
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
            />
          </label>
          <div>
            <button
              type="button"
              disabled={inviteCode.length === 0 || redeemingInvite}
              onClick={() => void redeemInvite()}
            >
              {redeemingInvite ? "Checking…" : "Redeem invitation"}
            </button>
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
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
          <button type="button" onClick={() => void startGoogleSignIn()}>
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
