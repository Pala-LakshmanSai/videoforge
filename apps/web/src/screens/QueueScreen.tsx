import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2, Video } from "lucide-react";

import { PageHeader } from "../components/PageHeader";
import { Badge, Button, EmptyState, Metric, Panel, ProgressBar } from "../components/ui";
import { api } from "../lib/api";
import { currentScenario } from "../lib/scenario";
import { videoStageLabel } from "../features/shared/status";

export function QueueScreen() {
  const scenario = currentScenario();
  const bootstrap = useQuery({
    queryKey: ["bootstrap", scenario],
    queryFn: () => api.bootstrap(scenario),
  });
  const queue = useQuery({
    queryKey: ["private-fair-queue", scenario],
    queryFn: () => api.privateFairQueue(scenario),
  });
  const queueMutation = useMutation({
    mutationFn: (action: {
      entryId: string;
      kind: "UP" | "DOWN" | "CANCEL";
      position: number;
      version: number;
    }) => {
      return action.kind === "CANCEL"
        ? api.cancelPrivateWaiting(action.entryId, action.version, scenario)
        : api.reorderPrivateQueue(
            action.entryId,
            action.position + (action.kind === "UP" ? -1 : 1),
            action.version,
            scenario,
          );
    },
    onSuccess: (data) => queue.refetch().then(() => data),
  });

  if (bootstrap.isPending || queue.isPending) {
    return (
      <>
        <PageHeader title="Queue" />
        <Panel heading="Loading your private queue">
          <div className="empty-state" aria-busy="true">
            <span className="spinner" aria-hidden="true" />
            <p>Reading durable admission state…</p>
          </div>
        </Panel>
      </>
    );
  }
  if (bootstrap.isError || queue.isError || !queue.data) {
    return (
      <>
        <PageHeader title="Queue" />
        <EmptyState
          icon={<AlertTriangle />}
          title="Queue unavailable"
          body="No fallback position or cross-account state is being inferred."
          action={
            <Button variant="secondary" onClick={() => void queue.refetch()}>
              Retry load
            </Button>
          }
        />
      </>
    );
  }

  const projects = bootstrap.data?.projects ?? [];
  const active = queue.data.requests.filter((request) => request.state === "ACTIVE").length;
  const waiting = queue.data.requests.filter((request) => request.state === "WAITING").length;
  const complete = projects.filter((project) =>
    ["READY_FOR_REVIEW", "APPROVED"].includes(project.status),
  ).length;

  return (
    <>
      <PageHeader
        title="Queue"
        actions={
          <Link
            to="/projects/new"
            search={{ fixture: scenario } as never}
            className="button button-primary"
          >
            <Plus size={16} />
            New project
          </Link>
        }
      />
      <div className="grid grid-4 queue-overview">
        <Metric label="Your active" value={String(active)} tone="info" />
        <Metric label="Your waiting" value={String(waiting)} />
        <Metric label="Account limit" value="1" detail="active workload" />
        <Metric label="Ready" value={String(complete)} tone="success" />
      </div>

      <Panel
        className="queue-panel"
        eyebrow="Private fair admission"
        heading="Your generation queue"
      >
        <div className="notice" role="status">
          Two global slots rotate deterministically across eligible accounts. This view exposes only
          your projects; your reorder never changes another account&apos;s turn.
        </div>
        {queue.data.requests.length === 0 ? (
          <p>
            Idle. Generate adds a private waiting request; preparation begins only after admission.
          </p>
        ) : (
          <div className="queue-list" aria-label="Your private generation queue">
            {queue.data.requests.map((request) => (
              <article className="queue-card" key={request.id}>
                <div className="queue-card__identity">
                  <span className="project-icon">
                    <Video size={18} />
                  </span>
                  <div>
                    <strong>{request.title}</strong>
                    <small>{videoStageLabel(request.stage)}</small>
                  </div>
                </div>
                <div className="queue-card__status">
                  <Badge tone={request.state === "ACTIVE" ? "info" : "neutral"}>
                    {request.state}
                  </Badge>
                  <span>Your order {request.accountPosition}</span>
                </div>
                <div className="queue-card__facts">
                  {request.canReorder ? (
                    <>
                      <Button
                        variant="secondary"
                        aria-label={`Move ${request.title} up in your queue`}
                        disabled={request.accountPosition <= 1 || queueMutation.isPending}
                        onClick={() =>
                          queueMutation.mutate({
                            entryId: request.id,
                            kind: "UP",
                            position: request.accountPosition,
                            version: request.version,
                          })
                        }
                      >
                        <ArrowUp size={16} />
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={`Move ${request.title} down in your queue`}
                        disabled={
                          request.accountPosition >= queue.data.requests.length ||
                          queueMutation.isPending
                        }
                        onClick={() =>
                          queueMutation.mutate({
                            entryId: request.id,
                            kind: "DOWN",
                            position: request.accountPosition,
                            version: request.version,
                          })
                        }
                      >
                        <ArrowDown size={16} />
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={`Cancel waiting project ${request.title}`}
                        disabled={!request.canCancel || queueMutation.isPending}
                        onClick={() =>
                          queueMutation.mutate({
                            entryId: request.id,
                            kind: "CANCEL",
                            position: request.accountPosition,
                            version: request.version,
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </Button>
                    </>
                  ) : (
                    <small>Active work cannot be moved.</small>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {queueMutation.isError ? (
          <div className="validation validation-danger" role="alert">
            {queueMutation.error.message}
          </div>
        ) : null}
      </Panel>

      <Panel className="queue-panel" heading="Projects">
        {projects.length === 0 ? (
          <EmptyState
            icon={<Video />}
            title="Queue is clear"
            body="Start a new video when you are ready."
            action={
              <Link
                className="button button-primary"
                to="/projects/new"
                search={{ fixture: scenario } as never}
              >
                New project
              </Link>
            }
          />
        ) : (
          <div className="queue-list">
            {projects.map((project) => {
              const percent = project.total
                ? Math.round((project.completed / project.total) * 100)
                : 0;
              return (
                <Link
                  className="queue-card"
                  key={project.id}
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                  search={{ fixture: scenario } as never}
                >
                  <div className="queue-card__identity">
                    <span className="project-icon">
                      <Video size={18} />
                    </span>
                    <div>
                      <strong>{project.title}</strong>
                      <small>{project.stage}</small>
                    </div>
                  </div>
                  <div className="queue-card__progress">
                    <ProgressBar value={percent} label={`${project.title} progress`} />
                    <span>{percent}%</span>
                  </div>
                  <div className="queue-card__status">
                    <Badge tone={project.status === "FAILED" ? "danger" : "neutral"}>
                      {project.status.replaceAll("_", " ")}
                    </Badge>
                    <span>{project.eta}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}
