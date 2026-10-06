import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
  type SetStateAction,
} from "react";

type Draft = { values: Record<string, unknown>; listeners: Set<() => void> };
export const emptyHostedCreateDraft = (): Draft => ({ values: {}, listeners: new Set() });

// Admission owns this memory: route changes retain it; sign-out/account changes discard it.
const HostedCreateDraftContext = createContext<{ current: Draft } | null>(null);

export function HostedCreateDraftProvider({ children }: PropsWithChildren) {
  const draft = useRef(emptyHostedCreateDraft());
  return (
    <HostedCreateDraftContext.Provider value={draft}>{children}</HostedCreateDraftContext.Provider>
  );
}

export const useHostedCreateDraft = () => useContext(HostedCreateDraftContext);

export function useHostedCreateDraftState<T>(key: string, initial: T) {
  const draft = useHostedCreateDraft();
  // A completed Create replaces the store. Old callbacks keep their old request's store.
  const cache = useMemo(() => draft?.current, [draft]);
  const [fallback, setFallback] = useState(initial);
  const subscribe = useCallback(
    (listener: () => void) => {
      cache?.listeners.add(listener);
      return () => {
        cache?.listeners.delete(listener);
      };
    },
    [cache],
  );
  const value = useSyncExternalStore(subscribe, () =>
    cache && key in cache.values ? (cache.values[key] as T) : fallback,
  );
  const setValue = useCallback(
    (next: SetStateAction<T>) => {
      if (!cache) {
        setFallback(next);
        return;
      }
      const current = key in cache.values ? (cache.values[key] as T) : fallback;
      cache.values[key] = typeof next === "function" ? (next as (value: T) => T)(current) : next;
      cache.listeners.forEach((listener) => listener());
    },
    [cache, fallback, key],
  );
  return [value, setValue] as const;
}

export function useHostedCreateDraftRef<T>(key: string, initial: T) {
  const draft = useHostedCreateDraft();
  const cache = useMemo(() => draft?.current, [draft]);
  const ref = useRef<T>(initial);
  if (cache) {
    if (key in cache.values) return cache.values[key] as typeof ref;
    cache.values[key] = ref;
  }
  return ref;
}
