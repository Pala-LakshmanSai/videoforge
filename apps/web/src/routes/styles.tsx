import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { HostedPresetCreationUnavailableScreen } from "../hosted/HostedProductScreens";
import { StylesHubScreen } from "../screens";

export const Route = createFileRoute("/styles")({ component: StylesRoute });

function StylesRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname.endsWith("/new")) {
    return import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE === "staging" ? (
      <HostedPresetCreationUnavailableScreen kind="styles" />
    ) : (
      <Outlet />
    );
  }
  return <StylesHubScreen />;
}
