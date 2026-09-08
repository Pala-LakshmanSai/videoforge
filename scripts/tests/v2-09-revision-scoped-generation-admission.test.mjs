import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("../..", import.meta.url).pathname);
const migrationPath =
  "packages/control-plane/migrations/0094_hosted_v209_revision_scoped_generation_admission.sql";
const read = (path) => readFileSync(resolve(root, path), "utf8");
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("0094 selects the newest locked revision before exact terminal replay detection", () => {
  const migration = read(migrationPath);
  const start = migration.indexOf("IF request_count=1 THEN");
  const end = migration.indexOf(
    "-- Prompt completion is the browser's only generation readiness handoff.",
  );
  assert.ok(start >= 0 && end > start);
  const admissionBlock = migration.slice(start, end);

  assert.match(
    admissionBlock,
    /SELECT revision\.id INTO revision_id[\s\S]*?revision\.status='LOCKED'[\s\S]*?ORDER BY revision\.revision_number DESC,revision\.id DESC/u,
  );
  assert.match(
    admissionBlock,
    /SELECT count\(\*\) INTO terminal_count[\s\S]*?row\.project_revision_id=revision_id[\s\S]*?row\.state IN \('SUCCEEDED','FAILED','CANCELLED'\)/u,
  );
  assert.match(
    admissionBlock,
    /'hosted-v209:'\|\|supplied_project_id::text\|\|':revision:'\|\|revision_id::text\|\|':generation'/u,
  );
  assert.doesNotMatch(admissionBlock, /ELSIF terminal_count>0/u);
});

test("0094 keeps the admission routine private and seals its manifest hash", () => {
  const migration = read(migrationPath);
  const manifest = JSON.parse(read("packages/control-plane/migrations/manifest.json"));
  const entry = manifest.migrations.find(({ version }) => version === 94);
  assert.deepEqual(
    [entry?.version, entry?.name, entry?.filename],
    [94, "hosted_v209_revision_scoped_generation_admission", migrationPath.split("/").at(-1)],
  );
  assert.equal(entry?.sha256, digest(readFileSync(resolve(root, migrationPath))));
  assert.equal(
    (
      migration.match(
        /CREATE OR REPLACE FUNCTION public\.videoforge_admit_hosted_v209_generation\(/gu,
      ) || []
    ).length,
    1,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.videoforge_admit_hosted_v209_generation\(uuid,uuid,uuid,uuid\) FROM PUBLIC/u,
  );
});
