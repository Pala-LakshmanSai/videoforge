import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MediaArtifactPreview } from "./MediaArtifactPreview";

afterEach(cleanup);

describe("MediaArtifactPreview", () => {
  it("renders a controlled metadata-only video for a local project preview", () => {
    const { container } = render(
      <MediaArtifactPreview
        artifact={{
          kind: "VIDEO",
          url: "/api/v1/projects/project_local_owned_001/preview",
          label: "Local 1080p30 MP4",
          sha256: `sha256:${"a".repeat(64)}`,
          bytes: 42,
          filename: "videoforge-local-owned-slice.mp4",
        }}
        fixtureFallback={<span>Fixture composition</span>}
      />,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("src", "/api/v1/projects/project_local_owned_001/preview");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).toHaveAccessibleName("Local 1080p30 MP4");
    expect(screen.queryByText("Fixture composition")).not.toBeInTheDocument();
  });

  it("leaves fixture video rendering entirely to the existing fallback", () => {
    const { container } = render(
      <MediaArtifactPreview
        artifact={{
          kind: "VIDEO",
          url: "/fixtures/media/watermelon-preview.mp4",
          label: "Synthetic fixture candidate",
        }}
        fixtureFallback={<span>Fixture composition</span>}
      />,
    );

    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByText("Fixture composition")).toBeVisible();
  });
});
