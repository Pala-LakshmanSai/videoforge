import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { HostedPresetCreationUnavailableScreen } from "../hosted/HostedProductScreens";
import { isHostedProviderMode } from "../hosted/provider-mode";
import { StylesHubScreen } from "../screens";

export const Route = createFileRoute("/styles")({ component: StylesRoute });

function StylesRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname.endsWith("/new")) {
    return isHostedProviderMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE) ? (
      <HostedPresetCreationUnavailableScreen kind="styles" />
    ) : (
      <Outlet />
    );
  }
  return <StylesHubScreen />;
}
