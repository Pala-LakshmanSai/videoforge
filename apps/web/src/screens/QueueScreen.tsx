import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Download,
  Plus,
  RefreshCw,
  Trash2,
  Video,
} from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Badge, Button, EmptyState, Metric, Panel, ProgressBar } from "../components/ui";
import { humanize, statusTone } from "../features/shared/status";
import { api } from "../lib/api";
import { currentScenario } from "../lib/scenario";

export function QueueScreen() {
  const scenario = currentScenario();
  const query = useQuery({
    queryKey: ["bootstrap", scenario],
    queryFn: () => api.bootstrap(scenario),
  });
  const shared = useQuery({
    queryKey: ["shared-app", scenario],
    queryFn: () => api.sharedApp(scenario),
  });
  const queueMutation = useMutation({
    mutationFn: (action: { entryId: string; kind: "UP" | "DOWN" | "REMOVE"; position: number }) => {
      const version = shared.data?.session?.queueVersion;
      if (version === undefined) throw new Error("Queue version unavailable.");
      return action.kind === "REMOVE"
        ? api.removeSharedQueue(action.entryId, version, scenario)
        : api.reorderSharedQueue(
            action.entryId,
            action.position + (action.kind === "UP" ? -1 : 1),
            version,
            scenario,
          );
    },
    onSuccess: () => void shared.refetch(),
  });
  const advanceMutation = useMutation({
    mutationFn: () => api.advanceSharedOrchestration(scenario),
    onSuccess: () => void shared.refetch(),
  });
  const cancelMutation = useMutation({
    mutationFn: () => api.cancelSharedActive(scenario),
    onSuccess: () => void shared.refetch(),
  });
  const projects = query.data?.projects ?? [];
  const running = projects.filter((project) => project.status === "RUNNING").length;
  const attention = projects.filter((project) => project.status === "NEEDS_ATTENTION").length;
  const complete = projects.filter((project) =>
    ["READY_FOR_REVIEW", "APPROVED"].includes(project.status),
  ).length;
  const orchestrationProjects = shared.data?.orchestration.projects ?? [];
  const completedFixtureProjects = orchestrationProjects.filter(
    (project) => project.stage === "READY_FOR_REVIEW" && project.finalAsset !== null,
  );
  const activeOrchestrationProject = orchestrationProjects.find((project) =>
    ["BOOTING", "PREPARING", "GENERATING", "RENDERING"].includes(project.stage),
  );

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Queue" />
        <Panel heading="Loading projects">
          <div className="empty-state" aria-busy="true">
            <span className="spinner" aria-hidden="true" />
            <p>Connecting to the authoritative queue…</p>
          </div>
        </Panel>
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <PageHeader title="Queue" />
        <EmptyState
          icon={<AlertTriangle />}
          title="Queue unavailable"
          body="The local API did not return project data. No empty queue is being inferred."
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry load
            </Button>
          }
        />
      </>
    );
  }

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
        <Metric
          label="Active"
          value={String(
            shared.data?.queue.filter((entry) => entry.state === "ACTIVE").length ?? running,
          )}
          tone="info"
        />
        <Metric
          label="Queued"
          value={String(
            shared.data?.queue.filter((entry) => entry.state === "WAITING").length ??
              projects.filter((project) => project.status === "QUEUED").length,
          )}
        />
        <Metric
          label="Needs attention"
          value={String(attention)}
          tone={attention ? "warning" : "success"}
        />
        <Metric label="Ready" value={String(complete)} tone="success" />
      </div>
      <Panel
        className="queue-panel"
        eyebrow="One shared boundary"
        heading="Global generation queue"
      >
        {shared.isError ? (
          <div className="validation validation-danger" role="alert">
            Global queue unavailable. Refresh before changing order.
          </div>
        ) : shared.isPending ? (
          <div className="empty-state" aria-busy="true">
            <span className="spinner" />
            <p>Loading global queue…</p>
          </div>
        ) : shared.data.queue.length === 0 ? (
          <p>Idle. The next Generate locks both selected GPU receipts for everyone.</p>
        ) : (
          <div className="queue-list" aria-label="Global generation queue">
            {shared.data.queue.map((entry) => (
              <article className="queue-card" key={entry.id}>
                <div className="queue-card__identity">
                  <span className="project-icon">
                    <Video size={18} />
                  </span>
                  <div>
                    <strong>{entry.title}</strong>
                    <small>
                      {entry.actor} · equal rights ·{" "}
                      {orchestrationProjects.find(
                        (project) => project.projectId === entry.projectId,
                      )?.stage ?? entry.state}
                    </small>
                  </div>
                </div>
                <div className="queue-card__status">
                  <Badge tone={entry.state === "ACTIVE" ? "info" : "neutral"}>{entry.state}</Badge>
                  <span>Position {entry.position}</span>
                </div>
                <div className="queue-card__facts">
                  {entry.state === "WAITING" ? (
                    <>
                      <Button
                        variant="secondary"
                        aria-label={`Move ${entry.title} up`}
                        disabled={entry.position <= 2 || queueMutation.isPending}
                        onClick={() =>
                          queueMutation.mutate({
                            entryId: entry.id,
                            kind: "UP",
                            position: entry.position,
                          })
                        }
                      >
                        <ArrowUp size={16} />
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={`Move ${entry.title} down`}
                        disabled={
                          entry.position >= shared.data.queue.length || queueMutation.isPending
                        }
                        onClick={() =>
                          queueMutation.mutate({
                            entryId: entry.id,
                            kind: "DOWN",
                            position: entry.position,
                          })
                        }
                      >
                        <ArrowDown size={16} />
                      </Button>
                      <Button
                        variant="secondary"
                        aria-label={`Remove ${entry.title}`}
                        disabled={queueMutation.isPending}
                        onClick={() =>
                          queueMutation.mutate({
                            entryId: entry.id,
                            kind: "REMOVE",
                            position: entry.position,
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </Button>
                    </>
                  ) : (
                    <small>Active entry cannot move or delete</small>
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
      {shared.data?.orchestration.session ? (
        <Panel className="queue-panel" eyebrow="$0 fixture" heading="Synthetic lane truth">
          <div className="grid grid-2">
            {(["mage_image", "echo_avatar"] as const).map((laneName) => {
              const lane = shared.data.orchestration.session!.lanes[laneName];
              const attempt = lane.attempts.at(-1)!;
              return (
                <article className="queue-card" key={laneName}>
                  <div className="queue-card__identity">
                    <div>
                      <strong>{laneName.replaceAll("_", " ")}</strong>
                      <small>{lane.selectedGpuSku}</small>
                    </div>
                  </div>
                  <div className="queue-card__status">
                    <Badge tone={attempt.phase === "ABSENCE_VERIFIED" ? "success" : "info"}>
                      {humanize(attempt.phase)}
                    </Badge>
                    <span>{lane.volumeId}</span>
                  </div>
                  <div className="queue-card__facts">
                    <small>
                      Attempt {lane.attempts.length} · callback {attempt.callbackSequence}
                    </small>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="button-row">
            <Button
              variant="secondary"
              disabled={advanceMutation.isPending}
              onClick={() => advanceMutation.mutate()}
            >
              <RefreshCw size={16} />
              Advance $0 fixture
            </Button>
            {activeOrchestrationProject ? (
              <Button
                variant="secondary"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                Cancel active
              </Button>
            ) : null}
          </div>
          {advanceMutation.isError || cancelMutation.isError ? (
            <div className="validation validation-danger" role="alert">
              {(advanceMutation.error ?? cancelMutation.error)?.message}
            </div>
          ) : null}
        </Panel>
      ) : shared.data?.orchestration.lastClosedSession ? (
        <Panel className="queue-panel" eyebrow="$0 fixture" heading="Last session closed">
          <p>
            Both synthetic Pods absent. Mage and Echo volumes retained. GPU pair unlocked after
            queue drain.
          </p>
        </Panel>
      ) : null}
      {completedFixtureProjects.length > 0 ? (
        <Panel className="queue-panel" heading="Provider-free final MP4s">
          <div className="grid grid-2">
            {completedFixtureProjects.map((project) => {
              const download = `${project.finalAsset!.downloadPath}?fixture=${encodeURIComponent(scenario)}`;
              const source = `${download}&inline=1`;
              return (
                <article className="queue-card" key={project.projectId}>
                  <div className="queue-card__identity">
                    <div>
                      <strong>{project.title}</strong>
                      <small>
                        1920×1080 · H.264/AAC · {(project.finalAsset!.byteSize / 1024).toFixed(1)}{" "}
                        KB
                      </small>
                    </div>
                  </div>
                  <video
                    controls
                    preload="metadata"
                    src={source}
                    aria-label={`${project.title} final MP4`}
                  />
                  <a className="button button-secondary" href={download}>
                    <Download size={16} />
                    Download MP4
                  </a>
                </article>
              );
            })}
          </div>
        </Panel>
      ) : null}
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
        ) : null}
        {projects.length ? (
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
                      <small>
                        {project.owner} · {project.mode.replaceAll("_", " ")}
                      </small>
                    </div>
                  </div>
                  <div className="queue-card__status">
                    <Badge tone={statusTone(project.status)}>
                      {project.status.replaceAll("_", " ")}
                    </Badge>
                    <span>{humanize(project.stage)}</span>
                  </div>
                  <div className="queue-card__progress">
                    <strong>{percent}%</strong>
                    <ProgressBar value={percent} label={`${project.title} progress`} />
                  </div>
                  <div className="queue-card__facts">
                    <span>
                      <small>ETA</small>
                      <strong>{project.eta}</strong>
                    </span>
                    <span>
                      <small>Cost</small>
                      <strong>${project.actualCost.toFixed(2)}</strong>
                    </span>
                    <ArrowRight size={20} aria-hidden="true" />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : null}
      </Panel>
    </>
  );
}
