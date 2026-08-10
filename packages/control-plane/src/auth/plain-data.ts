type PlainSnapshot = Readonly<Record<string, unknown>>;

/**
 * Copies own enumerable data properties without evaluating getters. Proxies and exotic objects
 * fail closed; callers decide whether that becomes a public denial or a fixture/config error.
 */
export function snapshotPlainRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[] = allowedKeys,
): PlainSnapshot | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  try {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return null;

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) return null;

    const allowed = new Set(allowedKeys);
    if ((keys as string[]).some((key) => !allowed.has(key))) return null;
    if (requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))) {
      return null;
    }

    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        return null;
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

export function snapshotExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
): PlainSnapshot | null {
  return snapshotPlainRecord(value, expectedKeys, expectedKeys);
}
