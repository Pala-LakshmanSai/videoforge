import { canonicalizeJson, type JsonPathSegment, type JsonValue } from "./canonical-json.js";

export type StrictJsonParseErrorCode = "DUPLICATE_PROPERTY" | "INVALID_JSON";

export class StrictJsonParseError extends SyntaxError {
  readonly code: StrictJsonParseErrorCode;
  readonly position: number;
  readonly path: readonly JsonPathSegment[];

  constructor(
    code: StrictJsonParseErrorCode,
    position: number,
    path: readonly JsonPathSegment[],
    message: string,
  ) {
    super(`${message} at byte ${position}.`);
    this.name = "StrictJsonParseError";
    this.code = code;
    this.position = position;
    this.path = Object.freeze([...path]);
  }
}

class DuplicateNameScanner {
  private position = 0;

  constructor(private readonly text: string) {}

  scan(): void {
    this.whitespace();
    this.value([]);
    this.whitespace();
    if (this.position !== this.text.length) this.invalid("Unexpected trailing JSON text", []);
  }

  private value(path: readonly JsonPathSegment[]): void {
    this.whitespace();
    const token = this.text[this.position];
    if (token === "{") {
      this.object(path);
      return;
    }
    if (token === "[") {
      this.array(path);
      return;
    }
    if (token === '"') {
      this.string(path);
      return;
    }
    if (token === "t") {
      this.literal("true", path);
      return;
    }
    if (token === "f") {
      this.literal("false", path);
      return;
    }
    if (token === "n") {
      this.literal("null", path);
      return;
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(
      this.text.slice(this.position),
    );
    if (!number) this.invalid("Expected a JSON value", path);
    this.position += number[0].length;
  }

  private object(path: readonly JsonPathSegment[]): void {
    this.position += 1;
    this.whitespace();
    if (this.text[this.position] === "}") {
      this.position += 1;
      return;
    }
    const names = new Set<string>();
    while (true) {
      if (this.text[this.position] !== '"') this.invalid("Expected an object property", path);
      const namePosition = this.position;
      const name = this.string(path);
      if (names.has(name)) {
        throw new StrictJsonParseError(
          "DUPLICATE_PROPERTY",
          namePosition,
          [...path, name],
          `Duplicate JSON property ${JSON.stringify(name)}`,
        );
      }
      names.add(name);
      this.whitespace();
      if (this.text[this.position] !== ":") this.invalid("Expected ':' after property", path);
      this.position += 1;
      this.value([...path, name]);
      this.whitespace();
      const delimiter = this.text[this.position];
      if (delimiter === "}") {
        this.position += 1;
        return;
      }
      if (delimiter !== ",") this.invalid("Expected ',' or '}' in object", path);
      this.position += 1;
      this.whitespace();
    }
  }

  private array(path: readonly JsonPathSegment[]): void {
    this.position += 1;
    this.whitespace();
    if (this.text[this.position] === "]") {
      this.position += 1;
      return;
    }
    let index = 0;
    while (true) {
      this.value([...path, index]);
      index += 1;
      this.whitespace();
      const delimiter = this.text[this.position];
      if (delimiter === "]") {
        this.position += 1;
        return;
      }
      if (delimiter !== ",") this.invalid("Expected ',' or ']' in array", path);
      this.position += 1;
      this.whitespace();
    }
  }

  private string(path: readonly JsonPathSegment[]): string {
    const start = this.position;
    this.position += 1;
    while (this.position < this.text.length) {
      const character = this.text[this.position];
      if (character === '"') {
        this.position += 1;
        try {
          return JSON.parse(this.text.slice(start, this.position)) as string;
        } catch {
          this.invalid("Invalid JSON string", path);
        }
      }
      if (character === "\\") this.position += 1;
      this.position += 1;
    }
    return this.invalid("Unterminated JSON string", path);
  }

  private literal(expected: "true" | "false" | "null", path: readonly JsonPathSegment[]): void {
    if (!this.text.startsWith(expected, this.position)) {
      this.invalid(`Expected '${expected}'`, path);
    }
    this.position += expected.length;
  }

  private whitespace(): void {
    while (/\s/u.test(this.text[this.position] ?? "")) this.position += 1;
  }

  private invalid(message: string, path: readonly JsonPathSegment[]): never {
    throw new StrictJsonParseError("INVALID_JSON", this.position, path, message);
  }
}

/** Parse JSON text without the duplicate-property information loss of `JSON.parse`. */
export function parseJsonStrict(text: string): JsonValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new StrictJsonParseError(
      "INVALID_JSON",
      0,
      [],
      error instanceof Error ? error.message : "Invalid JSON text",
    );
  }
  new DuplicateNameScanner(text).scan();
  canonicalizeJson(parsed);
  return parsed as JsonValue;
}
