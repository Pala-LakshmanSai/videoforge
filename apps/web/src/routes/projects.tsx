import { createFileRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { currentScenario } from "../lib/scenario";

export const Route = createFileRoute("/projects")({ component: ProjectsRoute });

function ProjectsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname === "/projects" || pathname === "/projects/") {
    return <Navigate to="/" search={{ fixture: currentScenario() } as never} replace />;
  }
  return <Outlet />;
}
