import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualPresetSelect } from "./VisualPresetSelect";

afterEach(cleanup);

describe("VisualPresetSelect", () => {
  it("allows selecting the only available preset when none is selected", () => {
    const onChange = vi.fn();
    render(
      <VisualPresetSelect
        label="Avatar"
        selectedId=""
        onChange={onChange}
        options={[{ id: "one", name: "Presenter", imageUrl: "" }]}
      />,
    );
    fireEvent.click(screen.getByText("Select avatar"));
    fireEvent.click(screen.getByRole("radio"));
    expect(onChange).toHaveBeenCalledWith("one");
  });

  it("closes on outside interaction and starts search keyboard navigation at the first result", async () => {
    render(
      <>
        <VisualPresetSelect
          label="Avatar"
          selectedId=""
          onChange={vi.fn()}
          options={Array.from({ length: 5 }, (_, i) => ({
            id: String(i),
            name: `Presenter ${i}`,
            imageUrl: "",
          }))}
        />
        <button>Outside</button>
      </>,
    );
    const trigger = screen.getByText("Select avatar").closest("summary")!;
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(trigger.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(trigger);
    const search = screen.getByRole("searchbox");
    search.focus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getAllByRole("radio")[0]).toHaveFocus());
    fireEvent.focusIn(screen.getByRole("button", { name: "Outside" }));
    expect(trigger.closest("details")).not.toHaveAttribute("open");
  });
});
