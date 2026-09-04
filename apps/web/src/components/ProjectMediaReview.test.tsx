import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectMediaReview } from "./ProjectMediaReview";

afterEach(cleanup);

describe("ProjectMediaReview", () => {
  it("opens enlarged image and avatar viewers from two clear actions", () => {
    render(
      <ProjectMediaReview
        images={[{ id: "scene-1", url: "https://media.test/scene.png", label: "Scene 1" }]}
        avatarVideos={[
          { id: "avatar-1", url: "https://media.test/avatar.mp4", label: "Avatar clip 1" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View generated images" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Generated images");
    expect(screen.getByRole("img", { name: "Scene 1" })).toHaveAttribute(
      "src",
      "https://media.test/scene.png",
    );

    fireEvent.click(screen.getByRole("tab", { name: /Avatar videos\/footage/u }));
    expect(screen.getByLabelText("Avatar clip 1")).toHaveAttribute(
      "src",
      "https://media.test/avatar.mp4",
    );
  });
});
