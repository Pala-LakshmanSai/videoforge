import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { HostedPresetCreationUnavailableScreen } from "../hosted/HostedProductScreens";
import { AvatarHubScreen } from "../screens";

export const Route = createFileRoute("/avatars")({ component: AvatarRoute });

function AvatarRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname.endsWith("/new")) {
    return import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE === "staging" ? (
      <HostedPresetCreationUnavailableScreen kind="avatars" />
    ) : (
      <Outlet />
    );
  }
  return <AvatarHubScreen />;
}
