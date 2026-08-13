import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { SharedAppPersistence } from "../shared-app-persistence";

export function createNodeSharedAppPersistence(filePath: string): SharedAppPersistence {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.next`;
  return {
    read() {
      try {
        return readFileSync(filePath, "utf8");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw error;
      }
    },
    write(snapshot) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(temporaryPath, snapshot, { encoding: "utf8", mode: 0o600 });
      renameSync(temporaryPath, filePath);
    },
  };
}
