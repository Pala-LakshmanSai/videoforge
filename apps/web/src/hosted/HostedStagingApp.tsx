import { HostedCreateDraftProvider } from "./HostedCreateDraft";
import { HostedIdentityContext } from "./HostedIdentity";
import { authClient, readBrowserAccounts, type BrowserAccounts } from "./auth-client";
import { QueryClientContext } from "@tanstack/react-query";
import { useContext } from "react";
import { AccountSwitcher } from "./AccountSwitcher";
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";

interface Tenant {
  readonly schema_version: "videoforge-hosted-tenant/v1";
  readonly account_id: string;
  readonly workspace_id: string;
  readonly workspace_name: string;
  readonly can_manage_team?: boolean;
  readonly can_view_centralized_library?: boolean;
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
    can_manage_team: value.can_manage_team === true,
    can_view_centralized_library: value.can_view_centralized_library === true,
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

function notifyAccountChange(existingChannel?: BroadcastChannel | null) {
  if (existingChannel) {
    existingChannel.postMessage("changed");
    return;
  }
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("videoforge-account");
  channel.postMessage("changed");
  channel.close();
}

export function HostedStagingApp({
  children,
  onAccountSwitch,
}: PropsWithChildren<{ onAccountSwitch?: () => Promise<void> }>) {
  const queryClient = useContext(QueryClientContext);
  const admittedIdentity = useRef<string | null>(null);
  const [access, setAccess] = useState<HostedAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [redeemingInvite, setRedeemingInvite] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<HostedStatus | null>(null);
  const refreshRequest = useRef(0);
  const accountsRequest = useRef(0);
  const accountChannel = useRef<BroadcastChannel | null>(null);
  const [browserAccounts, setBrowserAccounts] = useState<BrowserAccounts>({
    accounts: [],
    activeId: null,
    error: null,
  });
  const loadAccounts = useCallback(async () => {
    try {
      return await readBrowserAccounts();
    } catch {
      return { accounts: [], activeId: null, error: "Accounts could not load. Please try again." };
    }
  }, []);

  async function refreshBrowserAccounts() {
    const requestId = ++accountsRequest.current;
    const next = await loadAccounts();
    if (requestId === accountsRequest.current) setBrowserAccounts(next);
  }

  function removeBrowserAccount(sessionToken: string) {
    setBrowserAccounts((previous) => ({
      ...previous,
      accounts: previous.accounts.filter(({ session }) => session.token !== sessionToken),
    }));
  }

  const refresh = useCallback(
    async (preserveAdmittedView = false, knownAccounts?: BrowserAccounts) => {
      const requestId = ++refreshRequest.current;
      const accountRequestId = ++accountsRequest.current;
      const preloaded = preserveAdmittedView
        ? null
        : knownAccounts
          ? Promise.resolve(knownAccounts)
          : loadAccounts();
      if (!preserveAdmittedView) {
        setLoading(true);
        setAccess(null);
        queryClient?.clear();
      }
      try {
        const nextAccess = await tenantAccess();
        if (requestId === refreshRequest.current) {
          const identity =
            nextAccess.state === "ADMITTED"
              ? `${nextAccess.tenant.account_id}:${nextAccess.tenant.workspace_id}`
              : null;
          const changed = identity !== admittedIdentity.current;
          if (changed) {
            queryClient?.clear();
            setAccess(null);
            setLoading(true);
          }
          // Warm existing query keys after admission; never warm another tenant's cache.
          if (
            nextAccess.state === "ADMITTED" &&
            (!preserveAdmittedView || changed) &&
            queryClient
          ) {
            for (const [key, url] of [
              ["hosted-queue", "/api/v2/hosted/queue"],
              ["hosted-library", "/api/v2/library"],
              ["voiceover-voices", "/api/v2/voiceovers/voices"],
            ] as const) {
              void queryClient.prefetchQuery({
                queryKey: [key],
                staleTime: key === "voiceover-voices" ? 60_000 : 5_000,
                retry: false,
                queryFn: async ({ signal }) => {
                  const response = await fetch(url, {
                    signal,
                    headers: { accept: "application/json" },
                  });
                  if (!response.ok) throw new Error("Navigation data unavailable.");
                  return response.json();
                },
              });
            }
            // Keep the large product screen chunk out of the initial application bundle.
            void import("./HostedProductScreens")
              .then(({ readHostedCatalog }) => {
                if (requestId !== refreshRequest.current) return;
                return queryClient.prefetchQuery({
                  queryKey: ["hosted-project-catalog"],
                  queryFn: ({ signal }) => readHostedCatalog(signal),
                  retry: false,
                });
              })
              .catch(() => {});
          }
          const nextAccounts = await (preloaded ?? (changed ? loadAccounts() : null));
          if (requestId !== refreshRequest.current) return;
          if (nextAccounts && accountRequestId === accountsRequest.current)
            setBrowserAccounts(nextAccounts);
          admittedIdentity.current = identity;
          setAccess(nextAccess);
          setLoading(false);
        }
      } catch {
        if (requestId === refreshRequest.current) {
          setAccess(null);
          setMessage("Hosted staging is unavailable. No local fallback was used.");
        }
      } finally {
        if (requestId === refreshRequest.current && !preserveAdmittedView) setLoading(false);
      }
    },
    [queryClient, loadAccounts],
  );

  useEffect(() => {
    void refresh();
    if (window.location.hash === "#account-added") {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      notifyAccountChange(accountChannel.current);
    }
    void fetch("/api/v2/hosted/status", { headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error("Hosted status failed.");
        return response.json() as Promise<HostedStatus>;
      })
      .then(setStatus)
      .catch(() => setMessage("Hosted staging is unavailable. No local fallback was used."));
    return () => {
      refreshRequest.current += 1;
      accountsRequest.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === "visible" && admittedIdentity.current !== null) {
        void refresh(true);
      }
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, [refresh]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("videoforge-account");
    accountChannel.current = channel;
    channel.onmessage = () => void refresh();
    return () => {
      accountChannel.current = null;
      channel.close();
    };
  }, [refresh]);

  async function switchAccount(sessionToken: string) {
    refreshRequest.current += 1;
    admittedIdentity.current = null;
    setAccess(null);
    setLoading(true);
    queryClient?.clear();
    accountsRequest.current += 1;
    try {
      const result = await authClient.multiSession.setActive({ sessionToken });
      if (result.error)
        throw new Error("This account session expired or was removed. Sign in again.");
      notifyAccountChange(accountChannel.current);
      // Reset the route and all private UI state without downloading the app again.
      if (onAccountSwitch) {
        await onAccountSwitch();
        await refresh(false, { ...browserAccounts, activeId: result.data?.user.id ?? null });
      } else window.location.assign("/");
    } catch (error) {
      await refresh();
      setMessage(
        error instanceof Error ? error.message : "Account switching failed. Please try again.",
      );
    }
  }

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
    admittedIdentity.current = null;
    setAccess(null);
    setLoading(true);
    accountsRequest.current += 1;
    setBrowserAccounts({ accounts: [], activeId: null, error: null });
    queryClient?.clear();
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setMessage("Sign-out failed. Please try again.");
        setLoading(false);
        return;
      }
      notifyAccountChange(accountChannel.current);
      await refresh();
    } catch {
      setMessage("Sign-out failed. Please try again.");
      setLoading(false);
    }
  }

  async function startGoogleSignIn() {
    setMessage(null);
    // Remember the active session before OAuth replaces the primary cookie.
    const current = await authClient.getSession();
    if (current.error) throw new Error("Could not keep your current account. Please try again.");

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: `${window.location.origin}/#account-added`,
      });
      if (result.error) throw new Error(result.error.message ?? "Google sign-in failed.");
    } catch {
      throw new Error("Google sign-in failed. Please try again.");
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
    return (
      <HostedIdentityContext.Provider
        value={{
          email: access.tenant.user.email,
          canManageTeam: access.tenant.can_manage_team === true,
          canViewCentralizedLibrary: access.tenant.can_view_centralized_library === true,
          signOut,
          switchAccount,
          addAccount: startGoogleSignIn,
          browserAccounts,
          removeBrowserAccount,
          refreshBrowserAccounts,
        }}
      >
        <HostedCreateDraftProvider
          key={`${access.tenant.account_id}:${access.tenant.workspace_id}`}
        >
          {message ? (
            <p role="status" className="account-notice">
              {message}
            </p>
          ) : null}
          {children}
        </HostedCreateDraftProvider>
      </HostedIdentityContext.Provider>
    );
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
          <AccountSwitcher
            onSwitch={switchAccount}
            onAdd={startGoogleSignIn}
            browserAccounts={browserAccounts}
            onRemove={removeBrowserAccount}
            onRefresh={refreshBrowserAccounts}
          />
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
              void startGoogleSignIn().catch((error: Error) => setMessage(error.message))
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
        <AccountSwitcher
          onSwitch={switchAccount}
          onAdd={startGoogleSignIn}
          browserAccounts={browserAccounts}
          onRemove={removeBrowserAccount}
          onRefresh={refreshBrowserAccounts}
        />
        {message ? <p role="status">{message}</p> : null}
      </section>
    </main>
  );
}
