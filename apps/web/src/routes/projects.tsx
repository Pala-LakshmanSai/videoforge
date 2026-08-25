import { createFileRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { currentScenario } from "../lib/scenario";

export const Route = createFileRoute("/projects")({ component: ProjectsRoute });

function ProjectsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname === "/projects" || pathname === "/projects/") {
    if (
      import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE === "staging" ||
      import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE === "production"
    ) {
      return <Navigate to="/" replace />;
    }
    return <Navigate to="/" search={{ fixture: currentScenario() } as never} replace />;
  }
  return <Outlet />;
}
