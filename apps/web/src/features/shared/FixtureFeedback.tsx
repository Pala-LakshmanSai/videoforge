import { AlertTriangle, X } from "lucide-react";
import type { ReactNode } from "react";
import type { FixtureNotice } from "../../lib/types";

export function noticeForScope(
  notice: FixtureNotice | null | undefined,
  scope: FixtureNotice["scope"],
): FixtureNotice | null {
  return notice?.scope === scope ? notice : null;
}

export function blockerNoticeForScope(
  notice: FixtureNotice | null | undefined,
  scope: FixtureNotice["scope"],
): FixtureNotice | null {
  const scoped = noticeForScope(notice, scope);
  return scoped?.tone === "WARNING" || scoped?.tone === "ERROR" ? scoped : null;
}

export function NoticeBanner({
  notice,
  action,
}: {
  notice: FixtureNotice | null | undefined;
  action?: ReactNode;
}) {
  if (!notice) return null;
  const tone =
    notice.tone === "ERROR"
      ? "danger"
      : notice.tone === "WARNING"
        ? "warning"
        : notice.tone === "SUCCESS"
          ? "success"
          : "info";
  return (
    <div className={`notice notice-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <span>
        <strong>{notice.title}.</strong> {notice.detail}
      </span>
      {action ? <span className="notice-action">{action}</span> : null}
    </div>
  );
}

export function ActionToast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  if (!message) return null;
  return (
    <div className="app-toast" role="alert" aria-live="assertive">
      <span className="app-toast-icon" aria-hidden="true">
        <AlertTriangle size={18} />
      </span>
      <span>{message}</span>
      <button
        className="app-toast-dismiss"
        type="button"
        aria-label="Dismiss error"
        onClick={onDismiss}
      >
        <X size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
