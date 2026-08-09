import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Plus, Video } from "lucide-react";
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
  const projects = query.data?.projects ?? [];
  const running = projects.filter((project) => project.status === "RUNNING").length;
  const attention = projects.filter((project) => project.status === "NEEDS_ATTENTION").length;
  const complete = projects.filter((project) =>
    ["READY_FOR_REVIEW", "APPROVED"].includes(project.status),
  ).length;

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Your queue" />
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
        <PageHeader title="Your queue" />
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
        title="Your queue"
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
        <Metric label="Active" value={String(running)} tone="info" />
        <Metric
          label="Queued"
          value={String(projects.filter((project) => project.status === "QUEUED").length)}
        />
        <Metric
          label="Needs attention"
          value={String(attention)}
          tone={attention ? "warning" : "success"}
        />
        <Metric label="Ready" value={String(complete)} tone="success" />
      </div>
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
