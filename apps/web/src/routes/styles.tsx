import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { StylesHubScreen } from "../screens";

export const Route = createFileRoute("/styles")({ component: StylesRoute });

function StylesRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname.endsWith("/new") ? <Outlet /> : <StylesHubScreen />;
}
