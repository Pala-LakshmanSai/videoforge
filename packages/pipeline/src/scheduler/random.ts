/**
 * Version-local deterministic variation derived only from explicit scheduler inputs.
 *
 * FNV-1a plus a fixed 32-bit avalanche is intentionally small and portable. It is not a
 * cryptographic primitive; canonical document hashing remains owned by `@videoforge/contracts`.
 */
export class SeededVariation {
  readonly #material: string;

  constructor(projectRevisionId: string, schedulerVersion: string, seed: number) {
    this.#material = `${projectRevisionId}\u0000${schedulerVersion}\u0000${seed >>> 0}`;
  }

  fraction(key: string): number {
    let hash = 0x811c9dc5;
    const input = `${this.#material}\u0000${key}`;

    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }

    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x846ca68b);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 0x1_0000_0000;
  }

  between(key: string, minimum: number, maximum: number): number {
    return minimum + this.fraction(key) * (maximum - minimum);
  }

  index(key: string, length: number): number {
    if (!Number.isInteger(length) || length <= 0) {
      throw new RangeError("A deterministic choice requires at least one option.");
    }
    return Math.floor(this.fraction(key) * length);
  }
}
