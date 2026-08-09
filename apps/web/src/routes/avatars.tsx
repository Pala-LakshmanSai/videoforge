import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AvatarHubScreen } from "../screens";

export const Route = createFileRoute("/avatars")({ component: AvatarRoute });

function AvatarRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname.endsWith("/new") ? <Outlet /> : <AvatarHubScreen />;
}
