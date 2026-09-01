-- Keep non-production acceptance projects out of ordinary tenant product surfaces without
-- deleting their immutable revisions, attempts, artifacts, receipts, or cost/security lineage.

ALTER TABLE public.projects
  ADD COLUMN project_kind text NOT NULL DEFAULT 'USER'
  CHECK (project_kind IN ('USER', 'ACCEPTANCE_FIXTURE'));

WITH receipt_fixture_projects AS (
  SELECT DISTINCT receipt.workspace_id,
         (receipt.result_payload->>'project_id')::uuid AS project_id
    FROM public.repository_mutation_receipts AS receipt
   WHERE receipt.result_payload->>'fixture_non_production' = 'true'
     AND receipt.result_payload->>'project_id' ~
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
), historical_fixture_ids(project_id) AS (
  VALUES
    ('bf138c1a-9598-40a4-85bd-b37723e9dd90'::uuid),
    ('ff6edb5d-fbc6-4b40-818d-f16b2497d4df'::uuid),
    ('8acf67fd-049d-4f10-8ffc-f62f2871ac99'::uuid),
    ('fb724518-7cb5-4c95-871b-66dfb56d559d'::uuid),
    ('7314199d-143b-4e13-8450-205db92ab813'::uuid),
    ('5ccdfc11-5c41-46f3-8be3-f90fb9aa46ad'::uuid),
    ('3da07160-168b-4bc0-a2e1-9b58aa70ada1'::uuid),
    ('41b5d4e2-b1a6-4c8e-ba27-1c0fde360f6b'::uuid),
    ('2af2bc50-1757-4aed-8c7f-a46d527b7551'::uuid),
    ('54d8110e-7c87-4414-9652-572fdc73655a'::uuid),
    ('5080d8d2-4921-485e-aa06-07b637f8e5fb'::uuid)
), fixture_projects AS (
  SELECT project.workspace_id, project.id AS project_id
    FROM public.projects AS project
    JOIN historical_fixture_ids AS fixture ON fixture.project_id = project.id
  UNION
  SELECT workspace_id, project_id FROM receipt_fixture_projects
)
UPDATE public.projects AS project
   SET project_kind = 'ACCEPTANCE_FIXTURE'
  FROM fixture_projects AS fixture
 WHERE project.workspace_id = fixture.workspace_id
   AND project.id = fixture.project_id
   AND project.project_kind = 'USER';

CREATE INDEX projects_active_user_kind_idx
  ON public.projects (account_id, workspace_id, created_at DESC, id DESC)
  WHERE status = 'ACTIVE' AND project_kind = 'USER';

COMMENT ON COLUMN public.projects.project_kind IS
  'USER projects appear in ordinary tenant product surfaces. ACCEPTANCE_FIXTURE projects remain durable for audit but are hidden from the user product.';
