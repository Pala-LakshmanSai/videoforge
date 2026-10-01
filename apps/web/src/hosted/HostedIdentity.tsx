import { createContext, useContext } from "react";
export interface HostedIdentity {
  readonly email: string;
  readonly canManageTeam: boolean;
  signOut(): Promise<void>;
}
export const HostedIdentityContext = createContext<HostedIdentity | null>(null);
export const useHostedIdentity = () => useContext(HostedIdentityContext);
