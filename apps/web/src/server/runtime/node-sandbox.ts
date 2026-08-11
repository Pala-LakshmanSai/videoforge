import path from "node:path";

import { RuntimeBindingError } from "./configuration";

export function resolveNodeSandboxDataRoot(
  environment: Readonly<Record<string, string | undefined>>,
  workspaceRoot: string = process.cwd(),
): string {
  const configured = environment.VIDEOFORGE_SANDBOX_DATA_ROOT;
  if (!configured || configured.trim() !== configured || !path.isAbsolute(configured)) {
    throw new RuntimeBindingError(
      "Sandbox mode requires an absolute VIDEOFORGE_SANDBOX_DATA_ROOT.",
    );
  }

  const allowedRoot = path.resolve(workspaceRoot, ".videoforge");
  const resolved = path.resolve(configured);
  const relative = path.relative(allowedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new RuntimeBindingError(
      "Sandbox data root must be a child of the workspace .videoforge directory.",
    );
  }
  return resolved;
}
