import { useState } from "react";
import { loadDraft, saveDraft, type ProjectDraft } from "../../lib/draft";
import type { ScenarioId } from "../../lib/types";

export function useProjectDraft(scope: ScenarioId) {
  const [draft, setDraftState] = useState<ProjectDraft>(() => loadDraft(scope));
  const setDraft = (next: ProjectDraft | ((current: ProjectDraft) => ProjectDraft)) => {
    setDraftState((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      saveDraft(resolved, scope);
      return resolved;
    });
  };
  return [draft, setDraft] as const;
}
