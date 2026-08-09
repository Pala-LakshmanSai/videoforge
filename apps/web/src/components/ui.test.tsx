import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, DetailsSheet, Disclosure } from "./ui";

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
