import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import {
  HostedPresetCreationScreen,
  HostedPresetCreationUnavailableScreen,
} from "../hosted/HostedProductScreens";
import { isHostedBetaMode, isHostedProviderMode } from "../hosted/provider-mode";
import { StylesHubScreen } from "../screens";

export const Route = createFileRoute("/styles")({ component: StylesRoute });

function StylesRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname.endsWith("/new")) {
    if (isHostedBetaMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE)) {
      return <HostedPresetCreationScreen kind="styles" />;
    }
    return isHostedProviderMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE) ? (
      <HostedPresetCreationUnavailableScreen kind="styles" />
    ) : (
      <Outlet />
    );
  }
  return <StylesHubScreen />;
}
