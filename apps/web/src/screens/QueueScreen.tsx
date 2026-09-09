import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { PageHeader } from "../components/PageHeader";
import { isHostedProviderMode } from "../hosted/provider-mode";
import { Badge, Button, EmptyState, Metric, Panel, ProgressBar } from "../components/ui";
import { api } from "../lib/api";
import { currentScenario } from "../lib/scenario";
import { videoStageLabel } from "../features/shared/status";

interface HostedQueueProject {
  readonly project_id: string;
  readonly title: string;
  readonly state: "IN_PROGRESS" | "ACTION_REQUIRED" | "NEEDS_ATTENTION" | "CANCELLED" | "WAITING";
  readonly stage: string;
  readonly cancellable_attempt_id: string | null;
  readonly active_job_kind?: string | null;
  readonly latest_job_kind?: string | null;
  readonly latest_job_state?: string | null;
  readonly can_cancel_project?: boolean;
  readonly can_delete_project?: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

interface HostedQueueResponse {
  readonly schema_version: "videoforge-hosted-queue/v2";
  readonly worker_state: "ONLINE" | "BUSY" | "WAITING_FOR_YOUR_COMPUTER";
  readonly projects: readonly HostedQueueProject[];
}

type HostedQueueFilter = "ALL" | "IN_PROGRESS" | "ATTENTION" | "WAITING";

interface ArmedAction {
  readonly projectId: string;
  readonly kind: "CANCEL_JOB" | "CANCEL_PROJECT" | "DELETE";
}

const CONFIRMATION_WINDOW_MS = 6_000;

async function hostedQueue(): Promise<HostedQueueResponse> {
  const response = await fetch("/api/v2/hosted/queue", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Hosted queue could not be loaded.");
  return response.json() as Promise<HostedQueueResponse>;
}

async function hostedQueueMutation(
  input: string,
  init: RequestInit,
  fallbackMessage: string,
): Promise<void> {
  const response = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", accept: "application/json", ...init.headers },
  });
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  throw new Error(payload?.error?.message ?? fallbackMessage);
}

function hostedProjectTone(
  state: HostedQueueProject["state"],
): "danger" | "warning" | "info" | "neutral" {
  if (state === "NEEDS_ATTENTION") return "danger";
  if (state === "ACTION_REQUIRED" || state === "CANCELLED") return "warning";
  if (state === "IN_PROGRESS") return "info";
  return "neutral";
}

function hostedProjectLabel(state: HostedQueueProject["state"]): string {
  if (state === "NEEDS_ATTENTION") return "Needs attention";
  if (state === "ACTION_REQUIRED") return "Action required";
  if (state === "CANCELLED") return "Cancelled";
  if (state === "IN_PROGRESS") return "In progress";
  return "Waiting";
}

function hostedProjectExplanation(project: HostedQueueProject): string {
  if (project.state === "IN_PROGRESS")
    return project.active_job_kind === "ASR"
      ? "Your computer is transcribing the voiceover."
      : project.active_job_kind === "RENDER"
        ? "Your computer is assembling the final video."
        : `Working on ${project.stage.toLowerCase()}.`;
  if (project.state === "NEEDS_ATTENTION")
    return `${project.stage} stopped safely. Open the project to review and retry.`;
  if (project.state === "ACTION_REQUIRED")
    return "Transcription finished. Open the project to continue voiceover context.";
  if (project.state === "CANCELLED")
    return "Work was cancelled. Nothing is running for this video.";
  return `Waiting at ${project.stage.toLowerCase()}. Nothing is running yet.`;
}

function hostedRelativeTime(iso: string, now: number): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "unknown";
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(timestamp).toLocaleDateString();
}

function hostedAbsoluteTime(iso: string): string {
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : iso;
}

function hostedFilterMatches(filter: HostedQueueFilter, project: HostedQueueProject): boolean {
  if (filter === "ALL") return true;
  if (filter === "IN_PROGRESS") return project.state === "IN_PROGRESS";
  if (filter === "ATTENTION")
    return project.state === "NEEDS_ATTENTION" || project.state === "ACTION_REQUIRED";
  return project.state === "WAITING" || project.state === "CANCELLED";
}

function HostedQueueScreen() {
  const [armed, setArmed] = useState<ArmedAction | null>(null);
  const [filter, setFilter] = useState<HostedQueueFilter>("ALL");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [actionError, setActionError] = useState<{ projectId: string; message: string } | null>(
    null,
  );
  const queue = useQuery({
    queryKey: ["hosted-queue"],
    queryFn: hostedQueue,
    refetchInterval: 5_000,
  });
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const runAction = (projectId: string, action: () => Promise<void>) => {
    setActionError(null);
    action()
      .then(() => queue.refetch())
      .catch((error: unknown) => {
        setActionError({
          projectId,
          message: error instanceof Error ? error.message : "That action could not be completed.",
        });
      });
  };

  const cancelJob = useMutation({
    mutationFn: (attemptId: string) =>
      hostedQueueMutation(
        `/api/v2/cpu-attempts/${attemptId}`,
        {
          method: "POST",
          body: JSON.stringify({
            schema_version: "videoforge-hosted-cpu-cancellation/v1",
            attempt_id: attemptId,
            confirmation: "STOP",
          }),
        },
        "The job could not be cancelled.",
      ),
  });
  const cancelProject = useMutation({
    mutationFn: (projectId: string) =>
      hostedQueueMutation(
        `/api/v2/hosted/projects/${projectId}/cancel`,
        {
          method: "POST",
          body: JSON.stringify({
            schema_version: "videoforge-hosted-project-cancellation/v1",
            project_id: projectId,
            confirmation: "STOP",
          }),
        },
        "This project could not be cancelled.",
      ),
  });
  const deleteProject = useMutation({
    mutationFn: (projectId: string) =>
      hostedQueueMutation(
        `/api/v2/hosted/projects/${projectId}`,
        { method: "DELETE", body: "{}" },
        "This project could not be deleted.",
      ),
  });

  useEffect(() => {
    if (!armed) return;
    const timeout = window.setTimeout(() => setArmed(null), CONFIRMATION_WINDOW_MS);
    return () => window.clearTimeout(timeout);
  }, [armed]);
  useEffect(() => {
    if (!armed) return;
    if (!queue.data?.projects.some((project) => project.project_id === armed.projectId)) {
      setArmed(null);
    }
  }, [armed, queue.data?.projects]);

  const confirmFirst = (action: ArmedAction, run: () => void) => {
    if (armed?.projectId !== action.projectId || armed.kind !== action.kind) {
      setActionError(null);
      setArmed(action);
      return;
    }
    setArmed(null);
    run();
  };

  if (queue.isPending) {
    return (
      <Panel heading="Loading projects">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Checking your projects and connected computer…</p>
        </div>
      </Panel>
    );
  }
  if (queue.isError || !queue.data) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Queue unavailable"
        body="Your projects could not be loaded. Try again."
        action={
          <Button variant="secondary" onClick={() => void queue.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }
  const projects = queue.data.projects;
  const active = projects.filter((project) => project.state === "IN_PROGRESS").length;
  const attention = projects.filter((project) =>
    ["ACTION_REQUIRED", "NEEDS_ATTENTION"].includes(project.state),
  ).length;
  const waiting = projects.filter((project) =>
    ["WAITING", "CANCELLED"].includes(project.state),
  ).length;
  const normalisedSearch = search.trim().toLowerCase();
  const visible = projects.filter(
    (project) =>
      hostedFilterMatches(filter, project) &&
      (normalisedSearch === "" || project.title.toLowerCase().includes(normalisedSearch)),
  );
  const filters: readonly { key: HostedQueueFilter; label: string; count: number }[] = [
    { key: "ALL", label: "All", count: projects.length },
    { key: "ATTENTION", label: "Needs attention", count: attention },
    { key: "IN_PROGRESS", label: "In progress", count: active },
    { key: "WAITING", label: "Waiting", count: waiting },
  ];

  return (
    <>
      <PageHeader
        title="Queue"
        actions={
          <>
            <Button
              variant="secondary"
              busy={queue.isFetching}
              onClick={() => void queue.refetch()}
            >
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </Button>
            <Link to="/projects/new" className="button button-primary">
              <Plus size={16} aria-hidden="true" /> New project
            </Link>
          </>
        }
      />
      <div className="grid grid-4 queue-overview">
        <Metric
          label="In progress"
          value={String(active)}
          detail="1 video at a time"
          tone={active ? "info" : "neutral"}
        />
        <Metric
          label="Action needed"
          value={String(attention)}
          detail={attention ? "open these first" : "nothing waiting on you"}
          tone={attention ? "warning" : "neutral"}
        />
        <Metric label="Waiting" value={String(waiting)} detail="not started yet" />
        <Metric
          label="Your computer"
          value={
            queue.data.worker_state === "ONLINE"
              ? "Connected"
              : queue.data.worker_state === "BUSY"
                ? "Working"
                : "Not connected"
          }
          detail={
            queue.data.worker_state === "WAITING_FOR_YOUR_COMPUTER"
              ? "work waits safely"
              : "transcription and assembly"
          }
          tone={queue.data.worker_state === "WAITING_FOR_YOUR_COMPUTER" ? "warning" : "success"}
        />
      </div>
      <Panel heading="Your projects">
        <div className="notice" role="status">
          Your computer handles transcription and final assembly. If it disconnects, work waits
          safely until it reconnects.
        </div>
        {projects.length === 0 ? (
          <EmptyState
            icon={<Video />}
            title="No media jobs yet"
            body="Connect your computer in Settings before generating a video."
            action={
              <Link className="button button-primary" to="/settings">
                Open Settings
              </Link>
            }
          />
        ) : (
          <>
            <div className="queue-toolbar">
              <div className="queue-filters" role="group" aria-label="Filter your projects">
                {filters.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={`queue-filter${filter === entry.key ? " queue-filter--active" : ""}`}
                    aria-pressed={filter === entry.key}
                    onClick={() => setFilter(entry.key)}
                  >
                    {entry.label} <span>{entry.count}</span>
                  </button>
                ))}
              </div>
              <label className="queue-search">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  placeholder="Search projects"
                  aria-label="Search your projects"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
            </div>
            {visible.length === 0 ? (
              <p className="helper">No project matches this filter.</p>
            ) : (
              <div className="queue-list">
                {visible.map((project) => {
                  const cancellableAttemptId = project.cancellable_attempt_id;
                  const canCancelProject = project.can_cancel_project === true;
                  const canDelete = project.can_delete_project !== false && !cancellableAttemptId;
                  const busyProject =
                    (cancelJob.isPending && cancelJob.variables === cancellableAttemptId) ||
                    (cancelProject.isPending && cancelProject.variables === project.project_id) ||
                    (deleteProject.isPending && deleteProject.variables === project.project_id);
                  return (
                    <article className="queue-card" key={project.project_id}>
                      <div className="queue-card__identity">
                        <span className="project-icon">
                          <Video size={18} />
                        </span>
                        <div>
                          <Link
                            to="/projects/$projectId"
                            params={{ projectId: project.project_id }}
                            aria-label={`Open ${project.title}`}
                          >
                            <strong>{project.title}</strong>
                          </Link>
                          <small>{project.stage}</small>
                          <small className="queue-card__explanation">
                            {hostedProjectExplanation(project)}
                          </small>
                        </div>
                      </div>
                      <div className="queue-card__status">
                        <Badge tone={hostedProjectTone(project.state)}>
                          {hostedProjectLabel(project.state)}
                        </Badge>
                        <span title={hostedAbsoluteTime(project.updated_at)}>
                          Updated {hostedRelativeTime(project.updated_at, now)}
                        </span>
                        <span title={hostedAbsoluteTime(project.created_at)}>
                          Created {hostedRelativeTime(project.created_at, now)}
                        </span>
                      </div>
                      <div className="queue-card__facts queue-card__actions">
                        <Link
                          className="button button-secondary"
                          to="/projects/$projectId"
                          params={{ projectId: project.project_id }}
                        >
                          Open
                        </Link>
                        {cancellableAttemptId ? (
                          <Button
                            variant="secondary"
                            busy={
                              cancelJob.isPending && cancelJob.variables === cancellableAttemptId
                            }
                            disabled={busyProject}
                            onClick={() =>
                              confirmFirst(
                                { projectId: project.project_id, kind: "CANCEL_JOB" },
                                () =>
                                  runAction(project.project_id, () =>
                                    cancelJob.mutateAsync(cancellableAttemptId),
                                  ),
                              )
                            }
                          >
                            <X size={15} aria-hidden="true" />
                            {armed?.projectId === project.project_id && armed.kind === "CANCEL_JOB"
                              ? "Confirm cancel"
                              : "Cancel job"}
                          </Button>
                        ) : null}
                        {canCancelProject ? (
                          <Button
                            variant="secondary"
                            busy={
                              cancelProject.isPending &&
                              cancelProject.variables === project.project_id
                            }
                            disabled={busyProject}
                            onClick={() =>
                              confirmFirst(
                                { projectId: project.project_id, kind: "CANCEL_PROJECT" },
                                () =>
                                  runAction(project.project_id, () =>
                                    cancelProject.mutateAsync(project.project_id),
                                  ),
                              )
                            }
                          >
                            <X size={15} aria-hidden="true" />
                            {armed?.projectId === project.project_id &&
                            armed.kind === "CANCEL_PROJECT"
                              ? "Confirm stop"
                              : "Stop project"}
                          </Button>
                        ) : null}
                        <Button
                          variant="danger"
                          busy={
                            deleteProject.isPending &&
                            deleteProject.variables === project.project_id
                          }
                          disabled={busyProject || !canDelete}
                          title={
                            canDelete
                              ? "Remove this project from Queue and Progress"
                              : "Cancel the active work before deleting this project"
                          }
                          onClick={() =>
                            confirmFirst({ projectId: project.project_id, kind: "DELETE" }, () =>
                              runAction(project.project_id, () =>
                                deleteProject.mutateAsync(project.project_id),
                              ),
                            )
                          }
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          {armed?.projectId === project.project_id && armed.kind === "DELETE"
                            ? "Confirm delete"
                            : "Delete"}
                        </Button>
                      </div>
                      {armed?.projectId === project.project_id ? (
                        <p className="queue-card__confirm" role="status">
                          {armed.kind === "DELETE"
                            ? "Deleting removes this project from Queue and Progress. Billing and security history stays preserved."
                            : "Nothing is retried automatically. Press again within a few seconds to confirm."}
                        </p>
                      ) : null}
                      {actionError?.projectId === project.project_id ? (
                        <div className="validation validation-danger" role="alert">
                          {actionError.message}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

export function QueueScreen() {
  return isHostedProviderMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE) ? (
    <HostedQueueScreen />
  ) : (
    <FixtureQueueScreen />
  );
}

function FixtureQueueScreen() {
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
