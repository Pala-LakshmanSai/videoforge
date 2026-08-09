import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { emptyDraft, loadDraft } from "../../lib/draft";
import { useProjectDraft } from "./useProjectDraft";

describe("useProjectDraft", () => {
  beforeEach(() => localStorage.clear());

  it("waits for provider mode and switches to an isolated local draft", async () => {
    const initialProps: { mode: "fixture" | "local" | null } = { mode: null };
    const { result, rerender } = renderHook(
      ({ mode }: { mode: "fixture" | "local" | null }) =>
        useProjectDraft("project_create_ready", mode),
      { initialProps },
    );
    expect(result.current[2]).toBe(false);

    rerender({ mode: "fixture" });
    await waitFor(() => expect(result.current[2]).toBe(true));
    act(() => result.current[1]({ ...emptyDraft, title: "Fixture-only draft" }));
    expect(loadDraft("project_create_ready", "fixture").title).toBe("Fixture-only draft");

    rerender({ mode: "local" });
    await waitFor(() => expect(result.current[2]).toBe(true));
    expect(result.current[0]).toEqual(emptyDraft);
    act(() => result.current[1]({ ...emptyDraft, title: "Local-only draft", spendCapUsd: 0.1 }));

    expect(loadDraft("project_create_ready", "local").title).toBe("Local-only draft");
    expect(loadDraft("project_create_ready", "fixture").title).toBe("Fixture-only draft");
  });
});
