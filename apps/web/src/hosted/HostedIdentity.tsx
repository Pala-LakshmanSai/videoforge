import { createContext, useContext } from "react";
import type { BrowserAccounts } from "./auth-client";
export interface HostedIdentity {
  readonly email: string;
  readonly canManageTeam: boolean;
  readonly canViewCentralizedLibrary?: boolean;
  signOut(): Promise<void>;
  switchAccount?(sessionToken: string): Promise<void>;
  addAccount?(): Promise<void>;
  readonly browserAccounts?: BrowserAccounts;
  removeBrowserAccount?(sessionToken: string): void;
  refreshBrowserAccounts?(): Promise<void>;
}
export const HostedIdentityContext = createContext<HostedIdentity | null>(null);
export const useHostedIdentity = () => useContext(HostedIdentityContext);
