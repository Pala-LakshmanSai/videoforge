import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("hosted project kind visibility", () => {
  it("marks receipt-proven acceptance fixtures without title-based hiding", () => {
    const migration = source(
      "../../packages/control-plane/migrations/0059_project_kind_visibility.sql",
    );

    expect(migration).toContain("project_kind IN ('USER', 'ACCEPTANCE_FIXTURE')");
    expect(migration).toContain("receipt.result_payload->>'fixture_non_production' = 'true'");
    expect(migration).toContain("receipt.result_payload->>'project_id'");
    expect(migration).not.toMatch(/name\s+(?:NOT\s+)?(?:LIKE|ILIKE)/u);
    expect(migration).not.toContain("DELETE FROM public.projects");
  });

  it("keeps ordinary product surfaces user-only and provisions future fixtures explicitly", () => {
    const product = source("src/server/hosted/product.ts");
    const app = source("src/server/hosted/app.ts");
    const provisioner = source("../../deploy/v2-06/provision-owned-render-fixture.mjs");

    expect(product).toContain("project.project_kind = 'USER'");
    expect(product).toContain("normalized_name, project_kind");
    expect(app).toContain("project.project_kind='USER'");
    expect(app).toContain("project.project_kind = 'USER'");
    expect(provisioner).toContain("'ACTIVE','ACCEPTANCE_FIXTURE'");
    expect(provisioner).toContain('row.project_kind !== "ACCEPTANCE_FIXTURE"');
  });
});
