import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectMediaReview } from "./ProjectMediaReview";

afterEach(cleanup);

describe("ProjectMediaReview", () => {
  it("opens enlarged image and avatar viewers from two clear actions", () => {
    render(
      <ProjectMediaReview
        launcher="images"
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

it("shows the saved prompt and explains unavailable regeneration without exposing IDs", () => {
  render(
    <ProjectMediaReview
      launcher="images"
      images={[
        {
          id: "internal-id",
          url: "/image.png",
          label: "Generated image 1",
          prompt: "A person holding a watermelon.",
        },
      ]}
      avatarVideos={[]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View generated images" }));
  expect(screen.getByRole("textbox", { name: "Image prompt" })).toHaveValue(
    "A person holding a watermelon.",
  );
  expect(screen.queryByText("internal-id")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Regenerate image" })).toBeDisabled();
  expect(
    screen.getByText("Single-image regeneration is not available in this release."),
  ).toBeVisible();
  expect(screen.getByText("Regeneration costs up to $2.")).toBeVisible();
});

it("locks duplicate requests and keeps the image when regeneration fails", async () => {
  let reject!: (reason: Error) => void;
  const onRegenerate = vi.fn(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const item = {
    id: "scene-1",
    url: "/original.png",
    label: "Generated image 1",
    prompt: "A watermelon.",
  };
  render(
    <ProjectMediaReview
      launcher="images"
      images={[item]}
      avatarVideos={[]}
      onRegenerate={onRegenerate}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View generated images" }));
  fireEvent.click(screen.getByRole("button", { name: "Regenerate image" }));
  expect(onRegenerate).toHaveBeenCalledWith(item, "A watermelon.");
  expect(screen.getByRole("button", { name: "Regenerating…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Regenerating…" }));
  expect(onRegenerate).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("provider failure")));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "provider failure Your current image has been kept.",
  );
  expect(screen.getByRole("img", { name: "Generated image 1" })).toHaveAttribute(
    "src",
    "/original.png",
  );
  expect(screen.getByRole("button", { name: "Regenerate image" })).toBeEnabled();
});

it("unlocks after a successful replacement and never offers image actions on avatar footage", async () => {
  const onRegenerate = vi.fn().mockResolvedValue(undefined);
  render(
    <ProjectMediaReview
      launcher="images"
      images={[
        {
          id: "scene-1",
          url: "/original.png",
          label: "Generated image 1",
          prompt: "A watermelon.",
        },
      ]}
      avatarVideos={[{ id: "avatar-1", url: "/avatar.mp4", label: "Avatar clip 1" }]}
      onRegenerate={onRegenerate}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View generated images" }));
  fireEvent.click(screen.getByRole("button", { name: "Regenerate image" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Regenerate image" })).toBeEnabled(),
  );
  expect(onRegenerate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("tab", { name: /Avatar videos/u }));
  expect(screen.queryByRole("button", { name: "Regenerate image" })).not.toBeInTheDocument();
});

it("blocks a new request when the previous regeneration cannot be reconciled", async () => {
  const onRegenerate = vi
    .fn()
    .mockRejectedValue(
      Object.assign(new Error("Refresh the project to check again."), { retryable: false }),
    );
  render(
    <ProjectMediaReview
      launcher="images"
      images={[
        {
          id: "scene-1",
          url: "/original.png",
          label: "Generated image 1",
          prompt: "A watermelon.",
        },
      ]}
      avatarVideos={[]}
      onRegenerate={onRegenerate}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View generated images" }));
  fireEvent.click(screen.getByRole("button", { name: "Regenerate image" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Refresh the project to check again.");
  expect(screen.getByRole("button", { name: "Regenerate image" })).toBeDisabled();
});

it("submits an edited prompt on Enter, keeps Shift+Enter as a newline, and ignores IME Enter", async () => {
  const onRegenerate = vi.fn().mockResolvedValue(undefined);
  const item = {
    id: "scene-1",
    url: "/original.png",
    label: "Generated image 1",
    prompt: "A watermelon.",
  };
  render(
    <ProjectMediaReview
      launcher="images"
      images={[item]}
      avatarVideos={[]}
      onRegenerate={onRegenerate}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View generated images" }));
  const prompt = screen.getByRole("textbox", { name: "Image prompt" });
  fireEvent.change(prompt, { target: { value: "A child choosing a watermelon." } });
  fireEvent.keyDown(prompt, { key: "Enter", isComposing: true });
  expect(onRegenerate).not.toHaveBeenCalled();
  fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });
  expect(onRegenerate).not.toHaveBeenCalled();
  fireEvent.keyDown(prompt, { key: "Enter" });
  await waitFor(() =>
    expect(onRegenerate).toHaveBeenCalledWith(item, "A child choosing a watermelon."),
  );
});

it("keeps an independent draft for each image", () => {
  const onRegenerate = vi.fn().mockResolvedValue(undefined);
  const images = [
    {
      id: "scene-1",
      url: "/one.png",
      label: "Generated image 1",
      prompt: "First prompt",
    },
    {
      id: "scene-2",
      url: "/two.png",
      label: "Generated image 2",
      prompt: "Second prompt",
    },
  ];
  render(
    <ProjectMediaReview
      launcher="images"
      images={images}
      avatarVideos={[]}
      onRegenerate={onRegenerate}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View generated images" }));
  const prompt = screen.getByRole("textbox", { name: "Image prompt" });
  fireEvent.change(prompt, { target: { value: "Edited first" } });
  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  expect(screen.getByRole("textbox", { name: "Image prompt" })).toHaveValue("Second prompt");
  fireEvent.change(screen.getByRole("textbox", { name: "Image prompt" }), {
    target: { value: "Edited second" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
  expect(screen.getByRole("textbox", { name: "Image prompt" })).toHaveValue("Edited first");
});

it("reloads the same accepted asset when its failed signed URL is refreshed", () => {
  const onRetry = vi.fn();
  const item = { id: "avatar-1", url: "/expired.mp4", label: "Avatar clip 1" };
  const { rerender } = render(
    <ProjectMediaReview launcher="avatar" images={[]} avatarVideos={[item]} onRetry={onRetry} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "View avatar videos/footage" }));
  fireEvent.error(screen.getByLabelText("Avatar clip 1"));
  expect(screen.getByRole("alert")).toHaveTextContent("This media could not be loaded.");
  fireEvent.click(screen.getByRole("button", { name: "Refresh media" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  rerender(
    <ProjectMediaReview
      launcher="avatar"
      images={[]}
      avatarVideos={[{ ...item, url: "/renewed.mp4" }]}
      onRetry={onRetry}
    />,
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Avatar clip 1")).toHaveAttribute("src", "/renewed.mp4");
});
