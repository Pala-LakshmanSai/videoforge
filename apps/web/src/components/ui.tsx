import * as Progress from "@radix-ui/react-progress";
import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import type { ProjectStage, Tone } from "../lib/types";

export function Badge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: Tone }>) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Button({
  children,
  variant = "primary",
  busy = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={`button button-${variant}`}
      aria-busy={busy || undefined}
      disabled={busy || props.disabled}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Panel({
  children,
  className = "",
  heading,
  eyebrow,
  action,
}: PropsWithChildren<{
  className?: string;
  heading?: string;
  eyebrow?: string;
  action?: ReactNode;
}>) {
  return (
    <section className={`panel ${className}`}>
      {heading || eyebrow || action ? (
        <header className="panel-header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {heading ? <h2>{heading}</h2> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: Tone;
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <Progress.Root className="progress-root" value={value} aria-label={label}>
      <Progress.Indicator
        className="progress-indicator"
        style={{ transform: `translateX(-${100 - value}%)` }}
      />
    </Progress.Root>
  );
}

const toneByStage: Record<ProjectStage["status"], Tone> = {
  QUEUED: "neutral",
  RUNNING: "info",
  RETRYING: "warning",
  BLOCKED: "warning",
  FAILED: "danger",
  CANCELLED: "neutral",
  COMPLETE: "success",
};

export function StageTimeline({ stages }: { stages: ProjectStage[] }) {
  return (
    <div className="stage-list">
      {stages.map((stage) => (
        <div className="stage-row" key={stage.id}>
          <span className={`stage-dot stage-${toneByStage[stage.status]}`} aria-hidden="true" />
          <div className="stage-copy">
            <div>
              <strong>{stage.label}</strong>
              <Badge tone={toneByStage[stage.status]}>{stage.status.replaceAll("_", " ")}</Badge>
            </div>
            <p>{stage.detail}</p>
          </div>
          <span className="stage-count">
            {stage.completed}/{stage.total}
          </span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}
