import { createAuthClient } from "better-auth/react";
import { multiSessionClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
  plugins: [multiSessionClient()],
});

export interface BrowserAccounts {
  readonly accounts: readonly {
    readonly session: { readonly token: string };
    readonly user: { readonly id: string; readonly email: string; readonly name: string };
  }[];
  readonly activeId: string | null;
  readonly error: string | null;
}

export async function readBrowserAccounts(): Promise<BrowserAccounts> {
  // Adopt existing sessions before reading the browser's signed session cookies.
  const current = await authClient.getSession();
  if (current.error) throw new Error("Accounts could not load. Please try again.");
  const saved = await authClient.multiSession.listDeviceSessions();
  if (saved.error || !Array.isArray(saved.data))
    throw new Error("Accounts could not load. Please try again.");
  return {
    accounts: current.data
      ? [current.data, ...saved.data.filter((item) => item.user.id !== current.data?.user.id)]
      : saved.data,
    activeId: current.data?.user.id ?? null,
    error: null,
  };
}
