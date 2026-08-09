import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Download, FileJson, RefreshCw, ShieldCheck, Video } from "lucide-react";
import { useState } from "react";
import { CompositionPreview } from "../components/CompositionPreview";
import { PageHeader } from "../components/PageHeader";
import { Badge, Button, Disclosure, EmptyState, Panel } from "../components/ui";
import { ActionToast, NoticeBanner } from "../features/shared/FixtureFeedback";
import { humanize } from "../features/shared/status";
import { api } from "../lib/api";
import { currentScenario } from "../lib/scenario";

export function ReviewScreen({ projectId }: { projectId: string }) {
  const scenario = currentScenario();
  const query = useQuery({
    queryKey: ["project", projectId, scenario],
    queryFn: () => api.project(projectId, scenario),
    refetchInterval: 10_000,
  });
  const [sameClipMode, setSameClipMode] = useState<"AVATAR_FULL" | "AVATAR_SPLIT_IMAGE">(
    "AVATAR_FULL",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [approvalRecorded, setApprovalRecorded] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [reviewActionNotice, setReviewActionNotice] = useState<string | null>(null);
  const project = query.data?.project;
  const approved = approvalRecorded || project?.review.state === "APPROVED";
  const shots = [
    {
      id: "seg_0001",
      time: "00:00–00:04",
      type: sameClipMode,
      status: "SELECTED",
    },
    {
      id: "seg_0002",
      time: "00:04–00:10",
      type: "IMAGE_FULL" as const,
      status: "SELECTED",
    },
    {
      id: "seg_0003",
      time: "00:10–00:14",
      type: "AVATAR_SPLIT_IMAGE" as const,
      status: scenario === "avatar_lip_failure" ? "FLAGGED" : "SELECTED",
    },
  ];

  async function act(id: string) {
    if (busy !== null) return;
    setBusy(id);
    setApprovalError(null);
    setReviewActionNotice(null);
    try {
      if (id === "approve") {
        await api.mutate(
          `/api/v1/projects/${projectId}/approve`,
          {
            project_id: projectId,
            candidate_id: project?.review.candidateId,
            candidate_sha256: project?.review.candidateSha256,
          },
          scenario,
          { ifMatch: project?.versionToken },
        );
        setApprovalRecorded(true);
        await query.refetch();
      } else if (id === "retry") {
        await api.mutate(
          `/api/v1/projects/${projectId}/retry`,
          { project_id: projectId },
          scenario,
          { ifMatch: project?.versionToken },
        );
        setReviewActionNotice("Targeted repair accepted. Next project check in 10 seconds.");
        await query.refetch();
      } else if (id === "fallback") {
        await api.mutate(
          `/api/v1/projects/${projectId}/fallback-approval`,
          { project_id: projectId, approved_increment_usd: 0.18 },
          scenario,
          { ifMatch: project?.versionToken },
        );
        setReviewActionNotice("The $0.18 fallback reservation was approved for this fixture.");
        await query.refetch();
      } else {
        throw new Error("This review action is not implemented in fixture mode.");
      }
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "Approval could not be recorded.");
    } finally {
      setBusy(null);
    }
  }

  if (query.isPending) {
    return (
      <Panel eyebrow="Review" heading="Loading candidate">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Checking candidate and approval state…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError || !project) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Review unavailable"
        body="No candidate is inferred when project state cannot be loaded."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }
  if (!project.allowedActions.includes("REVIEW") && !approved) {
    return (
      <>
        <PageHeader
          eyebrow={humanize(project.status)}
          title="Review"
          description="No candidate yet"
        />
        <EmptyState
          icon={<Video />}
          title="Output is not ready for review"
          body="Return to Progress. Approval stays unavailable until a candidate passes technical checks."
          action={
            <Link
              className="button button-primary"
              to="/projects/$projectId"
              params={{ projectId }}
              search={{ fixture: scenario } as never}
            >
              Open progress
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={approved ? "Approved" : "Candidate v3"}
        title="Review"
        description={approved ? "Final output locked" : "Ready for review"}
        actions={
          <>
            <Link
              className="button button-secondary"
              to="/projects/$projectId"
              params={{ projectId }}
              search={{ fixture: scenario } as never}
            >
              Progress
            </Link>
            {project.allowedActions.includes("APPROVE") || approved ? (
              <Button
                busy={busy === "approve"}
                disabled={approved || busy !== null}
                onClick={() => act("approve")}
              >
                <ShieldCheck size={16} />
                {approved ? "Approved" : "Approve final"}
              </Button>
            ) : null}
            {project.allowedActions.includes("RETRY_FAILED_ITEMS") ? (
              <Button busy={busy === "retry"} disabled={busy !== null} onClick={() => act("retry")}>
                <RefreshCw size={16} />
                Retry failed item
              </Button>
            ) : null}
            {project.allowedActions.includes("APPROVE_FALLBACK") ? (
              <Button
                busy={busy === "fallback"}
                disabled={busy !== null}
                onClick={() => act("fallback")}
              >
                Approve $0.18 fallback
              </Button>
            ) : null}
          </>
        }
      />
      <NoticeBanner notice={query.data.notice} />
      <ActionToast message={approvalError} onDismiss={() => setApprovalError(null)} />
      {busy === "approve" || approved ? (
        <div className="notice" role="status" aria-live="polite">
          <strong>{busy === "approve" ? "Approving…" : "Approval recorded."}</strong>{" "}
          {busy === "approve"
            ? "Candidate and checksum are being verified."
            : "Synthetic preview ready. Real MP4 rendering remains in Phase 0C."}
        </div>
      ) : null}
      {reviewActionNotice ? (
        <div className="notice" role="status" aria-live="polite">
          {reviewActionNotice}
        </div>
      ) : null}
      <Panel className="review-player" eyebrow="Final output" heading="Preview">
        <div className="review-player-frame">
          <CompositionPreview type={sameClipMode} />
        </div>
        <div className="review-player-meta">
          <span>1920×1080 · 30 fps · synthetic preview</span>
          <Badge tone={approved ? "success" : "warning"}>
            {approved ? "Approved" : "Review needed"}
          </Badge>
        </div>
      </Panel>
      <Panel
        className="review-segments"
        eyebrow="Review strip"
        heading="Segments"
        action={
          <div className="cluster">
            <Button
              variant={sameClipMode === "AVATAR_FULL" ? "primary" : "secondary"}
              aria-pressed={sameClipMode === "AVATAR_FULL"}
              onClick={() => setSameClipMode("AVATAR_FULL")}
            >
              Full
            </Button>
            <Button
              variant={sameClipMode === "AVATAR_SPLIT_IMAGE" ? "primary" : "secondary"}
              aria-pressed={sameClipMode === "AVATAR_SPLIT_IMAGE"}
              onClick={() => setSameClipMode("AVATAR_SPLIT_IMAGE")}
            >
              Split
            </Button>
          </div>
        }
      >
        <div className="review-grid">
          {shots.map((shot) => (
            <article className="review-card" key={shot.id}>
              <CompositionPreview type={shot.type} />
              <div className="review-meta">
                <strong>{shot.time}</strong>
                <Badge tone={shot.status === "FLAGGED" ? "warning" : "success"}>
                  {shot.status}
                </Badge>
              </div>
              <small className="review-segment-state">
                {shot.status === "FLAGGED"
                  ? "Repair is controlled by the project action above."
                  : "Read-only fixture contact sheet"}
              </small>
            </article>
          ))}
        </div>
      </Panel>
      <div className="review-footer">
        <Disclosure
          className="project-details"
          summary={
            <>
              <span>Technical details</span>
              <small>Output, layouts, and provenance</small>
            </>
          }
        >
          <div className="detail-facts">
            <span>
              <small>Output</small>
              <strong>Synthetic contact sheet</strong>
            </span>
            <span>
              <small>Layouts</small>
              <strong>Full avatar · Full image · Split</strong>
            </span>
            <span>
              <small>Transitions</small>
              <strong>Hard cuts</strong>
            </span>
            <span>
              <small>Candidate</small>
              <strong>{project.review.candidateId ?? "Unavailable"}</strong>
            </span>
            <span>
              <small>Checksum</small>
              <strong>{project.review.candidateSha256 ?? "Unavailable"}</strong>
            </span>
          </div>
        </Disclosure>
        {approved && project.review.downloadUrl ? (
          <div className="download-actions">
            <a
              className="button button-secondary"
              href={project.review.downloadUrl}
              download="videoforge-fixture-preview.svg"
            >
              <Download size={18} />
              Download preview
            </a>
            <a
              className="button button-secondary"
              href={`/api/v1/projects/${projectId}?fixture=${scenario}`}
              download="videoforge-fixture-project-record.json"
            >
              <FileJson size={18} />
              Fixture record
            </a>
          </div>
        ) : (
          <span className="review-download-status">Approve to download</span>
        )}
      </div>
    </>
  );
}
