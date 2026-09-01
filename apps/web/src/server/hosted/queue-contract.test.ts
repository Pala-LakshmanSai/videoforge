import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("hosted queue contract", () => {
  it("returns one active project per row and leaves completed videos to Library", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/app.ts"), "utf8");
    const start = source.indexOf("async function handleHostedQueue(");
    const end = source.indexOf("async function handleHostedLibrary(", start);
    const queue = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(queue).toContain('schema_version: "videoforge-hosted-queue/v2"');
    expect(queue).toContain("FROM projects AS project");
    expect(queue).toContain("project.status='ACTIVE'");
    expect(queue).toContain("completed_render.kind='RENDER'");
    expect(queue).toContain("completed_render.state='SUCCEEDED'");
    expect(queue).toContain("projects: result.projects.map");
    expect(queue).not.toContain("attempts: result.attempts.map");
  });
});
