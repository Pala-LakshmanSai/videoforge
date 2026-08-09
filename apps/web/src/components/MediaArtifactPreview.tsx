import type { ReactNode } from "react";

import type { MediaArtifact } from "../lib/types";

const LOCAL_PROJECT_PREVIEW = /^\/api\/v1\/projects\/[A-Za-z0-9._:-]+\/preview$/u;

type VideoArtifact = MediaArtifact & { kind: "VIDEO" };

export function isLocalVideoArtifact(
  artifact: MediaArtifact | null | undefined,
): artifact is VideoArtifact {
  return artifact?.kind === "VIDEO" && LOCAL_PROJECT_PREVIEW.test(artifact.url);
}

export function MediaArtifactPreview({
  artifact,
  fixtureFallback,
  className,
}: {
  artifact: MediaArtifact | null;
  fixtureFallback: ReactNode;
  className?: string;
}) {
  if (!isLocalVideoArtifact(artifact)) return <>{fixtureFallback}</>;

  return (
    <video
      aria-label={artifact.label}
      className={["media-artifact-video", className].filter(Boolean).join(" ")}
      controls
      playsInline
      preload="metadata"
      src={artifact.url}
    />
  );
}
