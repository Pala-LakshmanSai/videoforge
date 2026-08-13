import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "../components/PageHeader";
import { Badge, Disclosure, Panel } from "../components/ui";
import { api } from "../lib/api";
import { currentScenario } from "../lib/scenario";

export function SettingsScreen() {
  const scenario = currentScenario();
  const health = useQuery({
    queryKey: ["health", scenario],
    queryFn: () => api.health(scenario),
  });
  const mode = health.data?.mode;

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
