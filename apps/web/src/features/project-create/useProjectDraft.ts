import { useCallback, useEffect, useState } from "react";
import {
  emptyDraft,
  loadDraft,
  saveDraft,
  type ProjectDraft,
  type ProjectDraftProviderMode,
} from "../../lib/draft";
import type { ScenarioId } from "../../lib/types";

interface ScopedDraft {
  readonly key: string | null;
  readonly draft: ProjectDraft;
}

export function useProjectDraft(scope: ScenarioId, mode: ProjectDraftProviderMode | null) {
  const key = mode === null ? null : `${mode}:${scope}`;
  const [state, setState] = useState<ScopedDraft>(() => ({
    key,
    draft: mode === null ? emptyDraft : loadDraft(scope, mode),
  }));

  useEffect(() => {
    if (state.key === key) return;
    setState({ key, draft: mode === null ? emptyDraft : loadDraft(scope, mode) });
  }, [key, mode, scope, state.key]);

  const setDraft = useCallback(
    (next: ProjectDraft | ((current: ProjectDraft) => ProjectDraft)) => {
      if (mode === null || key === null) return;
      setState((current) => {
        const base = current.key === key ? current.draft : loadDraft(scope, mode);
        const resolved = typeof next === "function" ? next(base) : next;
        saveDraft(resolved, scope, mode);
        return { key, draft: resolved };
      });
    },
    [key, mode, scope],
  );

  const ready = key !== null && state.key === key;
  return [ready ? state.draft : emptyDraft, setDraft, ready] as const;
}
