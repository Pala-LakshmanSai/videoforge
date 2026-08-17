import { createAuthClient } from "better-auth/react";
import { useQuery } from "@tanstack/react-query";
import { MediaWorkerSetup } from "../hosted/MediaWorkerSetup";
import { PageHeader } from "../components/PageHeader";
import { Badge, Button, Disclosure, Panel } from "../components/ui";
import { api } from "../lib/api";
import { currentScenario } from "../lib/scenario";

const hostedAuthClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
});

interface HostedTenant {
  readonly workspace_name: string;
  readonly user: { readonly email: string; readonly name: string };
}

function HostedSettingsScreen() {
  const tenant = useQuery({
    queryKey: ["hosted-tenant"],
    queryFn: async () => {
      const response = await fetch("/api/v2/tenant", { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Hosted tenant is unavailable.");
      return response.json() as Promise<HostedTenant>;
    },
  });

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid grid-2 settings-grid">
        <Panel eyebrow="Private staging" heading={tenant.data?.workspace_name ?? "Your workspace"}>
          <div className="settings-summary">
            <Badge tone={tenant.isError ? "danger" : "success"}>
              {tenant.isError ? "UNAVAILABLE" : "TENANT ISOLATED"}
            </Badge>
            <strong>{tenant.data?.user.email ?? "Checking signed-in account…"}</strong>
          </div>
          <Disclosure summary="Hosted boundaries">
            <div className="detail-facts">
              <span>
                <small>Database</small>
                <strong>Neon · account-scoped RLS</strong>
              </span>
              <span>
                <small>Artifacts</small>
                <strong>Private R2 · short-lived signed access</strong>
              </span>
              <span>
                <small>GPU</small>
                <strong>Disabled · fake transport only</strong>
              </span>
              <span>
                <small>CPU provider cost</small>
                <strong>$0 · your paired computer</strong>
              </span>
            </div>
          </Disclosure>
          <Button
            variant="secondary"
            onClick={() => void hostedAuthClient.signOut().then(() => window.location.assign("/"))}
          >
            Sign out
          </Button>
        </Panel>
        <MediaWorkerSetup />
      </div>
    </>
  );
}

export function SettingsScreen() {
  const scenario = currentScenario();
  const hostedStaging = import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE === "staging";
  const health = useQuery({
    queryKey: ["health", scenario],
    queryFn: () => api.health(scenario),
    enabled: !hostedStaging,
  });
  const mode = health.data?.mode;

  if (hostedStaging) return <HostedSettingsScreen />;

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid grid-2 settings-grid">
        <Panel eyebrow="Team" heading="Access">
          <div className="settings-summary">
            <Badge tone="success">ACTIVE</Badge>
            <strong>Lakshman · Admin</strong>
          </div>
          <Disclosure summary="Team details">
            <div className="detail-facts">
              <span>
                <small>Sign-in</small>
                <strong>Invite-only Google accounts</strong>
              </span>
              <span>
                <small>Workspace</small>
                <strong>5–10 invited teammates</strong>
              </span>
            </div>
          </Disclosure>
        </Panel>
        <Panel eyebrow="Connections" heading="Providers">
          <div className="settings-summary">
            {mode === "local" ? (
              <Badge tone="success">LOCAL · $0</Badge>
            ) : mode === "fixture" ? (
              <Badge tone="neutral">FIXTURE ONLY</Badge>
            ) : (
              <Badge tone={health.isError ? "danger" : "warning"}>
                {health.isError ? "MODE UNAVAILABLE" : "CHECKING MODE"}
              </Badge>
            )}
            <strong>
              {mode === "local"
                ? "External providers disabled"
                : mode === "fixture"
                  ? "External calls off"
                  : "Waiting for authoritative health"}
            </strong>
          </div>
          <Disclosure summary="Connection status">
            <div className="detail-facts">
              <span>
                <small>RunPod</small>
                <strong>
                  {mode === "local"
                    ? "Disabled in bounded local mode"
                    : mode === "fixture"
                      ? "Not configured in fixture mode"
                      : "Status unavailable"}
                </strong>
              </span>
              <span>
                <small>Runware</small>
                <strong>
                  {mode === "local"
                    ? "Disabled in bounded local mode"
                    : mode === "fixture"
                      ? "Not configured in fixture mode"
                      : "Status unavailable"}
                </strong>
              </span>
            </div>
          </Disclosure>
        </Panel>
        <Panel
          eyebrow="Execution"
          heading={
            mode === "local"
              ? "Local media slice"
              : mode === "fixture"
                ? "Fixture profile v1"
                : "Execution mode unavailable"
          }
        >
          <div className="settings-summary">
            <Badge tone="success">$0</Badge>
            <strong>
              {mode === "local"
                ? "Local processes only"
                : mode === "fixture"
                  ? "No GPU dispatch"
                  : "Execution unconfirmed"}
            </strong>
          </div>
          <Disclosure summary="Execution details">
            <div className="detail-facts">
              <span>
                <small>Endpoint</small>
                <strong>
                  {mode === "local"
                    ? "This development machine"
                    : mode === "fixture"
                      ? "None"
                      : "Unavailable"}
                </strong>
              </span>
              <span>
                <small>
                  {mode === "local"
                    ? "External spend"
                    : mode === "fixture"
                      ? "Rate limit"
                      : "Status"}
                </small>
                <strong>
                  {mode === "local" ? "$0 authorized" : mode === "fixture" ? "$0" : "Unavailable"}
                </strong>
              </span>
            </div>
          </Disclosure>
        </Panel>
        <Panel eyebrow="Defaults" heading="Documentary Stock v1">
          <div className="settings-summary">
            <Badge tone="info">BALANCED</Badge>
            <strong>
              {mode === "local"
                ? "$0.10 bounded request cap"
                : mode === "fixture"
                  ? "$1.50 suggested cap"
                  : "Defaults unavailable"}
            </strong>
          </div>
          <Disclosure summary="Default details">
            <div className="detail-facts">
              <span>
                <small>
                  {mode === "local"
                    ? "External spend"
                    : mode === "fixture"
                      ? "Contract ceiling"
                      : "Status"}
                </small>
                <strong>
                  {mode === "local" ? "$0" : mode === "fixture" ? "$2.00" : "Unavailable"}
                </strong>
              </span>
              <span>
                <small>Scheduler</small>
                <strong>scheduler-v2</strong>
              </span>
            </div>
          </Disclosure>
        </Panel>
      </div>
    </>
  );
}
