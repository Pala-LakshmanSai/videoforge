import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HostedStagingApp } from "./hosted/HostedStagingApp";
import { isHostedProviderMode } from "./hosted/provider-mode";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000 },
    mutations: { retry: 0 },
  },
});

const router = createRouter({ routeTree, defaultPreload: "intent", scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("VideoForge root element is missing");

const providerMode = import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE;
const hostedBrowser = isHostedProviderMode(providerMode);

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {hostedBrowser ? (
        <HostedStagingApp>
          <RouterProvider router={router} />
        </HostedStagingApp>
      ) : (
        <RouterProvider router={router} />
      )}
    </QueryClientProvider>
  </StrictMode>,
);
