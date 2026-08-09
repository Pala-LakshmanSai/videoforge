import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { ProjectScreen } from "../../screens";

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectRoute,
});

function ProjectRoute() {
  const { projectId } = Route.useParams();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname.endsWith("/review")) return <Outlet />;
  return <ProjectScreen projectId={projectId} />;
}
