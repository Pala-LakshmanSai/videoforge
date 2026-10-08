import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VoiceFilterSelect } from "./VoiceFilterSelect";

afterEach(cleanup);

it("fits a collection popup above mobile navigation and keeps it scrollable", () => {
  render(
    <>
      <nav aria-label="Primary navigation" />
      <VoiceFilterSelect
        label="Collection"
        value="mine"
        options={[{ value: "mine", label: "My avatars" }]}
        onChange={vi.fn()}
      />
    </>,
  );
  const bounds = (top: number, bottom: number) => ({
    top,
    bottom,
    left: 0,
    right: 300,
    width: 300,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
  vi.spyOn(screen.getByRole("navigation"), "getBoundingClientRect").mockReturnValue(
    bounds(680, 844),
  );
  const trigger = screen.getByRole("combobox");
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(bounds(550, 600));
  fireEvent.click(trigger);
  const list = screen.getByRole("listbox");
  expect(list.parentElement).toHaveClass("is-above");
  expect(list).toHaveStyle({ maxHeight: "300px" });
  fireEvent.click(trigger);
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(bounds(100, 150));
  fireEvent.click(trigger);
  expect(screen.getByRole("listbox").parentElement).not.toHaveClass("is-above");
});
