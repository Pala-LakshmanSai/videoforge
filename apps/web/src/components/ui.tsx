import * as Dialog from "@radix-ui/react-dialog";
import * as Progress from "@radix-ui/react-progress";
import { useEffect, useId, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  DetailsHTMLAttributes,
  PropsWithChildren,
  ReactNode,
} from "react";
import type { ProjectStage, Tone } from "../lib/types";

export function Badge({ children, tone = "neutral" }: PropsWithChildren<{ tone?: Tone }>) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Button({
  children,
  variant = "primary",
  busy = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={`button button-${variant} ${className}`.trim()}
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
    <section className={`panel ${className}`.trim()}>
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
  value: ReactNode;
  detail?: string;
  tone?: Tone;
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function clampProgress(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const clamped = clampProgress(value);
  return (
    <Progress.Root className="progress-root" value={clamped} aria-label={label}>
      <Progress.Indicator
        className="progress-indicator"
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </Progress.Root>
  );
}

export function ProgressRing({
  value,
  label,
  detail,
}: {
  value: number;
  label: string;
  detail?: string;
}) {
  const clamped = clampProgress(value);
  return (
    <div
      className="progress-ring"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
      style={{ "--progress-value": `${clamped * 3.6}deg` } as CSSProperties}
    >
      <span className="progress-ring-inner">
        <strong>{clamped}%</strong>
        <span>{detail ?? label}</span>
      </span>
    </div>
  );
}

export function Disclosure({
  summary,
  children,
  className = "",
  ...props
}: PropsWithChildren<
  DetailsHTMLAttributes<HTMLDetailsElement> & {
    summary: ReactNode;
  }
>) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  return (
    <details
      {...props}
      ref={detailsRef}
      className={`disclosure ${className}`.trim()}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== "Escape" || !detailsRef.current?.open) return;
        event.preventDefault();
        detailsRef.current.open = false;
        detailsRef.current.querySelector<HTMLElement>("summary")?.focus();
      }}
    >
      <summary className="disclosure-summary">
        <span className="disclosure-summary-content">{summary}</span>
        <span className="disclosure-chevron" aria-hidden="true" />
      </summary>
      <div className="disclosure-content">{children}</div>
    </details>
  );
}

export interface AppSelectOption {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
  group?: string;
}

export function AppSelect({
  label,
  value,
  options,
  onValueChange,
  className = "",
}: {
  label: string;
  value: string;
  options: AppSelectOption[];
  onValueChange: (value: string) => void;
  className?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  const menuId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];
  let previousGroup: string | undefined;

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    },
    [],
  );

  const enabledIndexes = () => options.flatMap((option, index) => (option.disabled ? [] : [index]));

  const focusIndex = (index: number) => {
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  };

  const focusBoundary = (boundary: "first" | "last") => {
    const indexes = enabledIndexes();
    const index = boundary === "first" ? indexes[0] : indexes.at(-1);
    if (index !== undefined) focusIndex(index);
  };

  const focusRelative = (direction: -1 | 1) => {
    const indexes = enabledIndexes();
    if (!indexes.length) return;
    const activeIndex = optionRefs.current.findIndex(
      (element) => element === document.activeElement,
    );
    const current = Math.max(0, indexes.indexOf(activeIndex));
    const next = indexes[(current + direction + indexes.length) % indexes.length];
    if (next !== undefined) focusIndex(next);
  };

  const focusByTypeahead = (key: string) => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    typeaheadRef.current += key.toLocaleLowerCase();
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = "";
      typeaheadTimerRef.current = null;
    }, 600);
    const indexes = enabledIndexes();
    if (!indexes.length) return;
    const activeIndex = optionRefs.current.findIndex(
      (element) => element === document.activeElement,
    );
    const start = Math.max(0, indexes.indexOf(activeIndex));
    const ordered = [...indexes.slice(start + 1), ...indexes.slice(0, start + 1)];
    const match = ordered.find((index) =>
      options[index]?.label.toLocaleLowerCase().startsWith(typeaheadRef.current),
    );
    if (match !== undefined) focusIndex(match);
  };

  const closeAndFocusTrigger = () => {
    if (detailsRef.current) detailsRef.current.open = false;
    setOpen(false);
    window.requestAnimationFrame(() =>
      detailsRef.current?.querySelector<HTMLElement>("summary")?.focus(),
    );
  };

  return (
    <details
      ref={detailsRef}
      className={`app-select ${className}`.trim()}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && detailsRef.current?.open) {
          event.preventDefault();
          closeAndFocusTrigger();
          return;
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!detailsRef.current?.open) {
            detailsRef.current?.setAttribute("open", "");
            setOpen(true);
            const selectedIndex = options.findIndex(
              (option) => option.value === selected?.value && !option.disabled,
            );
            if (event.key === "End") focusBoundary("last");
            else if (event.key === "Home") focusBoundary("first");
            else if (selectedIndex >= 0) focusIndex(selectedIndex);
            else focusBoundary(event.key === "ArrowUp" ? "last" : "first");
            return;
          }
          if (event.key === "Home") focusBoundary("first");
          else if (event.key === "End") focusBoundary("last");
          else focusRelative(event.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (
          detailsRef.current?.open &&
          event.key.length === 1 &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          focusByTypeahead(event.key);
        }
      }}
    >
      <summary
        className="app-select-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        id={triggerId}
      >
        <span>
          <strong>{selected?.label ?? "Choose"}</strong>
          {selected?.detail ? <small>{selected.detail}</small> : null}
        </span>
        <span className="app-select-chevron" aria-hidden="true" />
      </summary>
      <div className="app-select-menu" role="listbox" aria-label={`${label} options`} id={menuId}>
        {options.map((option, optionIndex) => {
          const showGroup = option.group !== previousGroup;
          previousGroup = option.group;
          return (
            <div className="app-select-option-wrap" key={option.value}>
              {showGroup && option.group ? (
                <span className="app-select-group">{option.group}</span>
              ) : null}
              <button
                type="button"
                className="app-select-option"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                data-option-label={option.label}
                ref={(element) => {
                  optionRefs.current[optionIndex] = element;
                }}
                tabIndex={option.value === selected?.value && !option.disabled ? 0 : -1}
                onClick={() => {
                  if (option.disabled) return;
                  onValueChange(option.value);
                  closeAndFocusTrigger();
                }}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.detail ? <small>{option.detail}</small> : null}
                </span>
                {option.value === value ? (
                  <span className="app-select-check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function DetailsSheet({
  trigger,
  title,
  description,
  children,
}: PropsWithChildren<{
  trigger: ReactNode;
  title: string;
  description?: string;
}>) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="details-sheet">
          <header className="details-sheet-header">
            <div>
              <p className="eyebrow">Details</p>
              <Dialog.Title>{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="details-sheet-description">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close className="sheet-close" aria-label="Close details">
              <span aria-hidden="true">×</span>
            </Dialog.Close>
          </header>
          <div className="details-sheet-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const toneByStage: Record<ProjectStage["status"], Tone> = {
  PENDING: "neutral",
  QUEUED: "neutral",
  STARTING: "info",
  RUNNING: "info",
  RETRYING: "warning",
  BLOCKED: "warning",
  FAILED: "danger",
  CANCEL_REQUESTED: "warning",
  COMPLETE: "success",
};

function activeStageIndex(stages: ProjectStage[]): number {
  const actionable = stages.findIndex((stage) =>
    ["STARTING", "RUNNING", "RETRYING", "BLOCKED", "FAILED", "CANCEL_REQUESTED"].includes(
      stage.status,
    ),
  );
  if (actionable >= 0) return actionable;
  return stages.findIndex((stage) => stage.status === "QUEUED" || stage.status === "PENDING");
}

export function StageTimeline({ stages }: { stages: ProjectStage[] }) {
  const activeIndex = activeStageIndex(stages);
  return (
    <ol className="stage-list" aria-label="Project stages">
      {stages.map((stage, index) => {
        const tone = toneByStage[stage.status];
        const active = index === activeIndex;
        return (
          <li
            className={`stage-row stage-row-${tone} ${active ? "stage-row-active" : ""} ${stage.status === "COMPLETE" ? "stage-row-complete" : ""}`.trim()}
            key={stage.id}
            aria-current={active ? "step" : undefined}
          >
            <span className="stage-index" aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="stage-rail" aria-hidden="true">
              <span className={`stage-dot stage-${tone}`} />
            </span>
            <div className="stage-copy">
              <div>
                <strong>{stage.label}</strong>
                <Badge tone={tone}>{stage.status.replaceAll("_", " ")}</Badge>
              </div>
              <p>{stage.detail}</p>
            </div>
            <span className="stage-count">
              {stage.completed}/{stage.total}
            </span>
          </li>
        );
      })}
    </ol>
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
