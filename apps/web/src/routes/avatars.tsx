import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import {
  HostedPresetCreationScreen,
  HostedPresetCreationUnavailableScreen,
} from "../hosted/HostedProductScreens";
import { isHostedBetaMode, isHostedProviderMode } from "../hosted/provider-mode";
import { AvatarHubScreen } from "../screens";

export const Route = createFileRoute("/avatars")({ component: AvatarRoute });

function AvatarRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname.endsWith("/new")) {
    if (isHostedBetaMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE)) {
      return <HostedPresetCreationScreen kind="avatars" />;
    }
    return isHostedProviderMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE) ? (
      <HostedPresetCreationUnavailableScreen kind="avatars" />
    ) : (
      <Outlet />
    );
  }
  return <AvatarHubScreen />;
}
