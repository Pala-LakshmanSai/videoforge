import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { CompositionPreview } from "../components/CompositionPreview";
import { MediaArtifactPreview } from "../components/MediaArtifactPreview";
import { PageHeader } from "../components/PageHeader";
import {
  Badge,
  Button,
  Disclosure,
  EmptyState,
  Metric,
  Panel,
  ProgressBar,
  ProgressRing,
  StageTimeline,
} from "../components/ui";
import { ActionToast, NoticeBanner } from "../features/shared/FixtureFeedback";
import { humanize, statusTone } from "../features/shared/status";
import { TimelineInspectionPanel } from "../features/timeline/TimelineInspectionPanel";
import { api } from "../lib/api";
import { currentScenario } from "../lib/scenario";
import type { ProjectSummary } from "../lib/types";

export function ProjectScreen({ projectId }: { projectId: string }) {
  const scenario = currentScenario();
  const health = useQuery({
    queryKey: ["health", scenario],
    queryFn: () => api.health(scenario),
  });
  const localMode = health.data?.mode === "local";
  const query = useQuery({
    queryKey: ["project", projectId, scenario],
    queryFn: () => api.project(projectId, scenario),
    refetchInterval: localMode ? 1_000 : 10_000,
  });
  const compute = useQuery({
    queryKey: ["execution-profiles", scenario],
    queryFn: () => api.executionProfiles(scenario),
  });
  const timelineInspection = useQuery({
    queryKey: ["timeline-inspection", projectId, scenario],
    queryFn: () => api.timelineInspection(projectId, scenario),
    refetchInterval: localMode ? 1_000 : 10_000,
  });
  const [action, setAction] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    tone: "info" | "danger";
    text: string;
  } | null>(null);
  if (query.isPending) {
    return (
      <Panel className="loading-panel" eyebrow="Project" heading="Loading progress">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Connecting to the authoritative project state…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError || !query.data) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Project progress is unavailable"
        body="The local API did not return a project. No fallback status is being shown."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }

  const project: ProjectSummary = query.data.project;
  const percent = Math.round((project.completed / Math.max(1, project.total)) * 100);
  const stages = project.stages;
  const actionableStageIndex = stages.findIndex((stage) =>
    [
      "STARTING",
      "RUNNING",
      "RETRYING",
      "BLOCKED",
      "FAILED",
      "CANCEL_REQUESTED",
      "CANCELLED",
    ].includes(stage.status),
  );
  const nextStageIndex = stages.findIndex((stage) => ["PENDING", "QUEUED"].includes(stage.status));
  const currentStageIndex =
    actionableStageIndex >= 0
      ? actionableStageIndex
      : nextStageIndex >= 0
        ? nextStageIndex
        : Math.max(0, stages.length - 1);
  const imagePercent = Math.round(
    (project.lanes.image.completed / Math.max(1, project.lanes.image.total)) * 100,
  );
  const avatarPercent = Math.round(
    (project.lanes.avatar.completed / Math.max(1, project.lanes.avatar.total)) * 100,
  );
  const imageCompute = compute.data?.lanes.find((lane) => lane.lane === "image_media");
  const avatarCompute = compute.data?.lanes.find((lane) => lane.lane === "avatar_primary");

  async function perform(label: string, path: string) {
    if (action !== null) return;
    setAction(label);
    setActionNotice({
      tone: "info",
      text:
        label === "retry"
          ? "Retry request pending. Duplicate submission is disabled."
          : "Cancellation request pending. Duplicate submission is disabled.",
    });
    try {
      await api.mutate(path, { project_id: project.id }, scenario, {
        ifMatch: project.versionToken,
      });
      setActionNotice({
        tone: "info",
        text:
          label === "retry"
            ? `Retry accepted for the failed item set only. Next ${localMode ? "local" : "fixture"} check in ${localMode ? 1 : 10} second${localMode ? "" : "s"}.`
            : `Cancellation accepted. Running work is settling; next ${localMode ? "local" : "fixture"} check in ${localMode ? 1 : 10} second${localMode ? "" : "s"}.`,
      });
      await query.refetch();
    } catch (error) {
      setActionNotice({
        tone: "danger",
        text: error instanceof Error ? error.message : "The action could not be accepted.",
      });
    } finally {
      setAction(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={`${project.status.replaceAll("_", " ")} · REV ${project.revisionId.split("_").at(-1)?.toUpperCase() ?? "—"}`}
        title={project.title}
        description={`${project.owner} · ${project.mode.replaceAll("_", " ")}`}
        actions={
          project.allowedActions.includes("RETRY_FAILED_ITEMS") ||
          project.allowedActions.includes("CANCEL") ? (
            <>
              {project.allowedActions.includes("RETRY_FAILED_ITEMS") ? (
                <Button
                  variant="secondary"
                  busy={action === "retry"}
                  disabled={action !== null}
                  onClick={() => perform("retry", `/api/v1/projects/${project.id}/retry`)}
                >
                  <RefreshCw size={15} />
                  Retry
                </Button>
              ) : null}
              {project.allowedActions.includes("CANCEL") ? (
                <Button
                  variant="danger"
                  busy={action === "cancel"}
                  disabled={action !== null}
                  onClick={() => perform("cancel", `/api/v1/projects/${project.id}/cancel`)}
                >
                  <X size={15} />
                  Cancel
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      <NoticeBanner notice={query.data.notice} />
      <ActionToast
        message={actionNotice?.tone === "danger" ? actionNotice.text : null}
        onDismiss={() => setActionNotice(null)}
      />
      {actionNotice?.tone === "info" ? (
        <div className="notice" role="status" aria-live="polite">
          {actionNotice.text}
        </div>
      ) : null}
      <section className="progress-hero" aria-label="Project progress">
        <ProgressRing value={percent} label="Project progress" detail="complete" />
        <div className="progress-hero-body">
          <div className="progress-hero-heading">
            <div>
              <p className="eyebrow">Current action</p>
              <h2>{humanize(project.stage)}</h2>
            </div>
            <Badge tone={statusTone(project.status)}>{project.status.replaceAll("_", " ")}</Badge>
          </div>
          <div className="progress-metrics">
            <Metric
              label="Stage"
              value={`${String(currentStageIndex + 1).padStart(2, "0")}/${String(stages.length).padStart(2, "0")}`}
              detail={stages[currentStageIndex]?.label ?? project.stage}
              tone="info"
            />
            <Metric
              label="Status"
              value={humanize(project.status)}
              detail={
                project.status === "RECONCILING"
                  ? "Checking durable worker truth"
                  : project.status === "CANCEL_REQUESTED"
                    ? "Workers are settling"
                    : project.status === "CANCELLED"
                      ? "Run stopped before completion"
                      : project.status === "READY_FOR_REVIEW"
                        ? "Human approval required"
                        : project.status === "APPROVED"
                          ? "Final revision locked"
                          : "Authoritative project state"
              }
              tone={statusTone(project.status)}
            />
            <Metric
              label={
                project.status === "FAILED" || project.status === "CANCELLED"
                  ? "Runtime"
                  : "Estimated"
              }
              value={project.eta}
              detail={
                project.status === "FAILED" || project.status === "CANCELLED"
                  ? "no work active"
                  : "remaining"
              }
            />
            <Metric
              label="Cost"
              value={`$${project.actualCost.toFixed(2)}`}
              detail={`$${project.capUsd.toFixed(2)} cap`}
              tone="success"
            />
          </div>
          <ProgressBar value={percent} label="Overall project progress" />
        </div>
      </section>

      <TimelineInspectionPanel
        inspection={timelineInspection.data}
        loading={timelineInspection.isPending}
        failed={timelineInspection.isError}
        onRetry={() => void timelineInspection.refetch()}
      />

      <div className="progress-workspace">
        <Panel className="pipeline-panel" eyebrow="Pipeline" heading="Production stages">
          <StageTimeline stages={stages} />
        </Panel>

        <div className="progress-side">
          <Panel className="latest-artifact-panel" eyebrow="Latest" heading="Live preview">
            <div className="latest-artifact-frame">
              {project.latestArtifact?.kind === "IMAGE" ? (
                <img src={project.latestArtifact.url} alt={project.latestArtifact.label} />
              ) : project.latestArtifact?.kind === "VIDEO" ? (
                <MediaArtifactPreview
                  artifact={project.latestArtifact}
                  fixtureFallback={
                    <div
                      className="video-artifact-placeholder"
                      aria-label={project.latestArtifact.label}
                    >
                      <CompositionPreview type="AVATAR_SPLIT_IMAGE" />
                      <Badge tone="info">SYNTHETIC CANDIDATE</Badge>
                    </div>
                  }
                />
              ) : (
                <CompositionPreview type="IMAGE_FULL" />
              )}
            </div>
            <div className="artifact-caption">
              <span>{project.latestArtifact?.label ?? "Waiting for first accepted asset"}</span>
              <Badge tone={project.latestArtifact ? "success" : "neutral"}>
                {project.latestArtifact ? "Accepted" : "Waiting"}
              </Badge>
            </div>
          </Panel>

          <Panel className="lane-panel" eyebrow="Parallel work" heading="Media lanes">
            <div className="lane-list">
              <div className="lane-row">
                <div className="lane-title">
                  <span>Images</span>
                  <strong>
                    {project.lanes.image.completed} / {project.lanes.image.total}
                  </strong>
                  <span className="compute-status">
                    <i aria-hidden="true" />
                    {imageCompute?.status.provider_state === "NOT_CONNECTED"
                      ? localMode
                        ? "Local · no provider GPU"
                        : health.data?.mode === "fixture"
                          ? "Fixture · no GPU"
                          : "No provider GPU"
                      : (imageCompute?.status.label ?? "Status unavailable")}
                  </span>
                </div>
                <ProgressBar value={imagePercent} label="Image lane progress" />
                <small>{project.lanes.image.action}</small>
              </div>
              <div className="lane-row">
                <div className="lane-title">
                  <span>Avatar</span>
                  <strong>
                    {project.lanes.avatar.completed} / {project.lanes.avatar.total}
                  </strong>
                  <span className="compute-status">
                    <i aria-hidden="true" />
                    {avatarCompute?.status.provider_state === "NOT_CONNECTED"
                      ? localMode
                        ? "Local · no provider GPU"
                        : health.data?.mode === "fixture"
                          ? "Fixture · no GPU"
                          : "No provider GPU"
                      : (avatarCompute?.status.label ?? "Status unavailable")}
                  </span>
                </div>
                <ProgressBar value={avatarPercent} label="Avatar lane progress" />
                <small>{project.lanes.avatar.action}</small>
              </div>
            </div>
          </Panel>

          <Disclosure
            className="project-details"
            summary={
              <>
                <span>Project details</span>
                <small>Inputs, activity, and provenance</small>
              </>
            }
          >
            <div className="detail-facts">
              <span>
                <small>Avatar</small>
                <strong>{project.pins.avatarProfileVersionId ?? "Not pinned"}</strong>
              </span>
              <span>
                <small>Image style</small>
                <strong>{project.pins.imageStyleVersionId}</strong>
              </span>
              <span>
                <small>Estimate</small>
                <strong>${project.estimatedCost.toFixed(2)}</strong>
              </span>
              <span>
                <small>Revision</small>
                <strong>{project.revisionId}</strong>
              </span>
            </div>
            <div className="activity-list">
              {(query.data?.events ?? []).map((event) => (
                <div className="timeline-event" key={event.id}>
                  <span>{event.at}</span>
                  <i />
                  <strong>{event.detail}</strong>
                </div>
              ))}
            </div>
          </Disclosure>

          {project.allowedActions.includes("REVIEW") ? (
            <Link
              className="button button-primary progress-review-action"
              to="/projects/$projectId/review"
              params={{ projectId }}
              search={{ fixture: scenario } as never}
            >
              Review output
              <ArrowRight size={18} />
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );
}
