-- CP-02 audit fix: every durable admission must reference the exact retained redemption row.
-- This closes the historical CP-01 fixture seeding bypass after CP-02 introduced redemptions.

INSERT INTO invite_codes (
  id, verifier_sha256, intended_normalized_email, state, expires_at,
  consumed_at, revoked_at, version, created_at
)
SELECT admission.invite_redemption_id,
       'sha256:' || md5(admission.id::text) || md5(admission.id::text || ':legacy'),
       admission.normalized_email, 'CONSUMED', admission.admitted_at + interval '1 hour',
       admission.admitted_at, NULL, 2, admission.admitted_at - interval '1 second'
  FROM app_admissions admission
 WHERE NOT EXISTS (
   SELECT 1 FROM invite_redemptions redemption
    WHERE redemption.id = admission.invite_redemption_id
 );

INSERT INTO invite_redemptions (
  id, invite_code_id, user_id, normalized_email, auth_method, verifier_sha256, redeemed_at
)
SELECT admission.invite_redemption_id, admission.invite_redemption_id, admission.user_id,
       admission.normalized_email, admission.auth_methods[1],
       'sha256:' || md5(admission.id::text) || md5(admission.id::text || ':legacy'),
       admission.admitted_at
  FROM app_admissions admission
 WHERE NOT EXISTS (
   SELECT 1 FROM invite_redemptions redemption
    WHERE redemption.id = admission.invite_redemption_id
 );

ALTER TABLE app_admissions
  ADD CONSTRAINT app_admissions_invite_redemption_fk
  FOREIGN KEY (invite_redemption_id)
  REFERENCES invite_redemptions (id)
  ON DELETE RESTRICT;
