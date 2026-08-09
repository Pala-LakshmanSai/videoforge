import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell";

export interface RootSearch {
  fixture?: string;
  returnTo?: string;
}

export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>): RootSearch => ({
    fixture: typeof search.fixture === "string" ? search.fixture : undefined,
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
  notFoundComponent: () => (
    <div className="empty-state">
      <h1>That production view does not exist.</h1>
      <p>Use the navigation dock to return to a VideoForge workspace.</p>
    </div>
  ),
});
