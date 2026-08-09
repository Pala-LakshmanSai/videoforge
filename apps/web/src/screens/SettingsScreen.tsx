import { PageHeader } from "../components/PageHeader";
import { Badge, Disclosure, Panel } from "../components/ui";

export function SettingsScreen() {
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
            <Badge tone="neutral">FIXTURE ONLY</Badge>
            <strong>External calls off</strong>
          </div>
          <Disclosure summary="Connection status">
            <div className="detail-facts">
              <span>
                <small>RunPod</small>
                <strong>Not configured in fixture mode</strong>
              </span>
              <span>
                <small>Runware</small>
                <strong>Not configured in fixture mode</strong>
              </span>
            </div>
          </Disclosure>
        </Panel>
        <Panel eyebrow="Execution" heading="Fixture profile v1">
          <div className="settings-summary">
            <Badge tone="success">$0</Badge>
            <strong>No GPU dispatch</strong>
          </div>
          <Disclosure summary="Execution details">
            <div className="detail-facts">
              <span>
                <small>Endpoint</small>
                <strong>None</strong>
              </span>
              <span>
                <small>Rate limit</small>
                <strong>$0</strong>
              </span>
            </div>
          </Disclosure>
        </Panel>
        <Panel eyebrow="Defaults" heading="Documentary Stock v1">
          <div className="settings-summary">
            <Badge tone="info">BALANCED</Badge>
            <strong>$1.50 suggested cap</strong>
          </div>
          <Disclosure summary="Default details">
            <div className="detail-facts">
              <span>
                <small>Contract ceiling</small>
                <strong>$2.00</strong>
              </span>
              <span>
                <small>Scheduler</small>
                <strong>scheduler-v1</strong>
              </span>
            </div>
          </Disclosure>
        </Panel>
      </div>
    </>
  );
}
