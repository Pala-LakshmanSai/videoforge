export interface SharedAppPersistence {
  read(): string | null;
  write(snapshot: string): void;
}

export class MemorySharedAppPersistence implements SharedAppPersistence {
  #snapshot: string | null;

  constructor(snapshot: string | null = null) {
    this.#snapshot = snapshot;
  }

  read(): string | null {
    return this.#snapshot;
  }

  write(snapshot: string): void {
    this.#snapshot = snapshot;
  }
}
