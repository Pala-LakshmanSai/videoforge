import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-copy">
        <p className="eyebrow page-header-eyebrow">{eyebrow}</p>
        <h1 className="page-header-title">{title}</h1>
        {description ? <p className="page-header-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions page-header-actions">{actions}</div> : null}
    </header>
  );
}
