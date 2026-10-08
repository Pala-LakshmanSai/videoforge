import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualPresetSelect } from "./VisualPresetSelect";
import { VoiceFilterSelect } from "../../hosted/VoiceFilterSelect";

afterEach(cleanup);

describe("VisualPresetSelect", () => {
  it("keeps the selected avatar while browsing an empty collection and handles nested Escape", async () => {
    const onChange = vi.fn();
    render(
      <VisualPresetSelect
        label="Avatar"
        selectedId="own"
        options={[{ id: "own", name: "My presenter", imageUrl: "" }]}
        displayedOptions={[]}
        onChange={onChange}
        collectionControl={
          <VoiceFilterSelect
            label="Avatar collection"
            value="other"
            options={[
              { value: "mine", label: "My avatars", count: 1 },
              { value: "other", label: "Other user", description: "other@example.com", count: 0 },
            ]}
            onChange={vi.fn()}
          />
        }
      />,
    );
    const trigger = screen.getByText("My presenter").closest("summary")!;
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    expect(screen.getByText("No avatars in this collection.")).toBeVisible();
    const collection = screen.getByRole("combobox", { name: "Avatar collection" });
    fireEvent.click(collection);
    fireEvent.keyDown(collection, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(collection, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(collection, { key: "Escape" });
    expect(trigger.closest("details")).not.toHaveAttribute("open");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("searches only the browsed collection and locks selection while a copy is pending", () => {
    const own = { id: "own", name: "My presenter", imageUrl: "" };
    const shared = {
      id: "shared",
      name: "Shared presenter",
      imageUrl: "",
      meta: "Other user · other@example.com",
    };
    const onChange = vi.fn();
    const rendered = render(
      <VisualPresetSelect
        label="Avatar"
        selectedId="own"
        options={[own, shared]}
        displayedOptions={[shared]}
        onChange={onChange}
        collectionControl={<span>Everyone</span>}
      />,
    );
    const trigger = screen.getByText("My presenter").closest("summary")!;
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "My presenter" } });
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "other@example.com" } });
    expect(screen.getByRole("radio")).toHaveTextContent("Shared presenter");
    rendered.rerender(
      <VisualPresetSelect
        label="Avatar"
        selectedId="own"
        options={[own, shared]}
        displayedOptions={[shared]}
        onChange={onChange}
        collectionControl={<span>Everyone</span>}
        disabled
      />,
    );
    expect(trigger.closest("details")).not.toHaveAttribute("open");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger.closest("details")).not.toHaveAttribute("open");
    expect(onChange).not.toHaveBeenCalled();
  });
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
