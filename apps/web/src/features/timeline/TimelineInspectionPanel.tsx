import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

import { Badge, Button, Disclosure, Metric, Panel } from "../../components/ui";
import { deriveTimelineInspectionView, formatTimelineTime } from "../../lib/timeline-inspection";
import type { TimelineInspection } from "../../lib/types";

function layoutLabel(layout: TimelineInspection["phrases"][number]["layout"]): string {
  switch (layout) {
    case "AVATAR_FULL":
      return "Avatar full";
    case "AVATAR_SPLIT_IMAGE":
      return "Avatar + image";
    case "IMAGE_FULL":
      return "Image full";
  }
}

export function TimelineInspectionPanel({
  inspection,
  loading,
  failed,
  onRetry,
}: {
  readonly inspection: TimelineInspection | undefined;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
}) {
  if (loading && !inspection) {
    return (
      <Panel
        className="timeline-inspection timeline-inspection-loading"
        eyebrow="Timing inspection"
        heading="Reading persisted coverage"
      >
        <div className="timeline-inspection-pending" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <span>Verifying transcript and timeline identity…</span>
        </div>
      </Panel>
    );
  }

  if (failed || !inspection) {
    return (
      <Panel
        className="timeline-inspection timeline-inspection-blocked"
        eyebrow="Timing inspection"
        heading="Coverage not ready"
        action={<Badge tone="danger">Not ready</Badge>}
      >
        <div className="timeline-readiness-blocker" role="alert">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>Authoritative timing could not be inspected.</strong>
            <span>No ready state is inferred from project progress.</span>
          </div>
          <Button variant="secondary" onClick={onRetry}>
            <RefreshCw size={15} />
            Retry
          </Button>
        </div>
      </Panel>
    );
  }

  const view = deriveTimelineInspectionView(inspection);
  const timing = inspection.timing;
  const plan = inspection.plan;
  const avatar = inspection.selectedAvatar;

  return (
    <Panel
      className={`timeline-inspection ${view.ready ? "timeline-inspection-ready" : "timeline-inspection-blocked"}`}
      eyebrow="Timing inspection"
      heading="Phrase and layout coverage"
      action={<Badge tone={view.ready ? "success" : "danger"}>{view.statusLabel}</Badge>}
    >
      <div className="timeline-readiness" role="status" aria-live="polite">
        {view.ready ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
        <div>
          <strong>
            {view.ready ? "Current revision is fully covered" : "Recompute is required"}
          </strong>
          <span>{view.statusDetail}</span>
        </div>
        <Badge tone="neutral">
          {inspection.sourceMode === "LOCAL_PERSISTED" ? "Local persisted" : "Fixture snapshot"}
        </Badge>
      </div>

      {timing && plan && avatar ? (
        <>
          <div className="timeline-coverage-metrics">
            <Metric
              label="Phrase timing"
              value={`${timing.phraseCount}/${timing.phraseCount}`}
              detail={`${timing.timedWordCount} timed words`}
              tone="success"
            />
            <Metric
              label="Source coverage"
              value={formatTimelineTime(timing.sourceDurationMs)}
              detail={`${plan.sourceStartMs}–${plan.sourceEndMs} ms exact`}
              tone="success"
            />
            <Metric
              label="Layout plan"
              value={`${plan.segmentCount} segments`}
              detail={`${plan.totalFrames} frames · ${plan.fps} fps`}
              tone="info"
            />
            <Metric
              label="Selected avatar"
              value={`${avatar.coveragePercent.toFixed(2)}%`}
              detail={`${avatar.materializedCount}/${avatar.count} spans materialized`}
              tone="info"
            />
          </div>

          <div className="selected-avatar-spans" aria-label="Selected avatar spans">
            <div className="timeline-section-heading">
              <div>
                <p className="eyebrow">Selected source audio</p>
                <h3>Avatar spans</h3>
              </div>
              <span>{formatTimelineTime(avatar.durationMs)} total</span>
            </div>
            <div className="avatar-span-list">
              {avatar.spans.length > 0 ? (
                avatar.spans.map((span) => (
                  <article className="avatar-span" key={span.id}>
                    <span className="avatar-span-time">
                      {formatTimelineTime(span.startMs)}–{formatTimelineTime(span.endMs)}
                    </span>
                    <div>
                      <strong>{layoutLabel(span.layout)}</strong>
                      <p>{span.phrase}</p>
                      <small>Audio {span.audioSha256.slice(7, 19)}…</small>
                    </div>
                  </article>
                ))
              ) : (
                <p className="timeline-empty-note">No avatar spans were selected.</p>
              )}
            </div>
          </div>

          <Disclosure
            className="timeline-phrase-disclosure"
            summary={
              <>
                <span>Transcript phrases</span>
                <small>{inspection.phrases.length} exact layout assignments</small>
              </>
            }
          >
            <ol className="timeline-phrase-list">
              {inspection.phrases.map((phrase) => (
                <li key={phrase.id}>
                  <span>
                    {formatTimelineTime(phrase.startMs)}–{formatTimelineTime(phrase.endMs)}
                  </span>
                  <p>{phrase.text}</p>
                  <Badge tone={phrase.layout === "IMAGE_FULL" ? "neutral" : "info"}>
                    {layoutLabel(phrase.layout)}
                  </Badge>
                </li>
              ))}
            </ol>
            <div className="timeline-document-identity">
              <span>
                <small>Transcript</small>
                <code>{inspection.documents.transcriptSha256}</code>
              </span>
              <span>
                <small>Timeline</small>
                <code>{inspection.documents.timelineSha256}</code>
              </span>
            </div>
          </Disclosure>
        </>
      ) : (
        <div className="timeline-readiness-blocker" role="alert">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>Timing and layout coverage are unavailable.</strong>
            <span>{inspection.blockers.join(" ")}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
