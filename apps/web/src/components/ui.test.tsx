import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppSelect, Button, DetailsSheet, Disclosure } from "./ui";

describe("Button", () => {
  it("locks duplicate clicks whenever an action is busy", () => {
    render(
      <Button busy disabled={false}>
        Approve final
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Approve final" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("Disclosure", () => {
  it("keeps compact auxiliary detail collapsed until explicitly opened", () => {
    render(
      <Disclosure summary="Preset details">
        <span>Profile hash</span>
      </Disclosure>,
    );

    const summary = screen.getByText("Preset details");
    const details = summary.closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("Profile hash")).not.toBeVisible();

    fireEvent.click(summary);
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("Profile hash")).toBeVisible();
  });
});

describe("AppSelect", () => {
  it("uses an integrated application menu instead of a native browser select", () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <AppSelect
        label="Avatar generation compute profile"
        value="fixture"
        onValueChange={onValueChange}
        options={[
          { value: "fixture", label: "Fixture · $0" },
          { value: "rtx_4090", label: "RTX 4090", disabled: true, group: "GPU qualification" },
        ]}
      />,
    );

    expect(container.querySelector("select")).not.toBeInTheDocument();
    const trigger = screen.getByLabelText("Avatar generation compute profile");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox", { name: /compute profile options/i })).toBeVisible();
    expect(screen.getByRole("option", { name: "RTX 4090" })).toBeDisabled();

    fireEvent.click(screen.getByRole("option", { name: "Fixture · $0" }));
    expect(onValueChange).toHaveBeenCalledWith("fixture");
    expect(trigger.closest("details")).not.toHaveAttribute("open");
  });

  it("supports arrow, boundary, typeahead, and Escape keyboard navigation", async () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <AppSelect
        label="Image generation compute profile"
        value="fixture"
        onValueChange={onValueChange}
        options={[
          { value: "fixture", label: "Fixture · $0" },
          { value: "blocked", label: "RTX 4090", disabled: true },
          { value: "balanced", label: "Balanced local" },
          { value: "fast", label: "Faster local" },
        ]}
      />,
    );

    const view = within(container);
    const trigger = view.getByLabelText("Image generation compute profile");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await waitFor(() => expect(view.getByRole("option", { name: "Fixture · $0" })).toHaveFocus());

    fireEvent.keyDown(document.activeElement ?? trigger, { key: "ArrowDown" });
    await waitFor(() => expect(view.getByRole("option", { name: "Balanced local" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement ?? trigger, { key: "End" });
    await waitFor(() => expect(view.getByRole("option", { name: "Faster local" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement ?? trigger, { key: "b" });
    await waitFor(() => expect(view.getByRole("option", { name: "Balanced local" })).toHaveFocus());

    fireEvent.keyDown(document.activeElement ?? trigger, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger.closest("details")).not.toHaveAttribute("open");
  });
});

describe("DetailsSheet", () => {
  it("mounts detail on demand, closes with Escape, and restores trigger focus", async () => {
    render(
      <DetailsSheet
        title="Warm Rural Documentary"
        description="Published v1 · References 4"
        trigger={<button type="button">References (4)</button>}
      >
        <span>ref_01</span>
      </DetailsSheet>,
    );

    const trigger = screen.getByRole("button", { name: "References (4)" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("ref_01")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Warm Rural Documentary" })).toBeVisible();
    expect(screen.getByText("ref_01")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
