-- Source-overlay identity binding only; new live GPU acceptance remains unverified.
-- Existing qualifications and activation rows remain append-only. Mage unchanged.
DO $migration$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.videoforge_import_hosted_v209_qualified_activation(jsonb)'::regprocedure);
 IF (length(definition)-length(replace(definition,'sha256:586c235e3854ece80ca17b7728d3bdddea47e4e4f3b9fb445584bd7cd2fc17b5','')))/length('sha256:586c235e3854ece80ca17b7728d3bdddea47e4e4f3b9fb445584bd7cd2fc17b5')<>1 THEN RAISE EXCEPTION 'SOULX_UPLOAD_QUALIFICATION_PREDECESSOR_DRIFT';END IF;
 definition:=replace(definition,'sha256:586c235e3854ece80ca17b7728d3bdddea47e4e4f3b9fb445584bd7cd2fc17b5','sha256:fa28033013428860f0464dcd41c76b77f669942725cd3b5a57bb6a015d17c678');
 IF (length(definition)-length(replace(definition,'sha256:f67287feeef2a8ff16efd48d142125f6c3ee1863bde5b92aa74f80b7e741cd35','')))/length('sha256:f67287feeef2a8ff16efd48d142125f6c3ee1863bde5b92aa74f80b7e741cd35')<>1 THEN RAISE EXCEPTION 'SOULX_UPLOAD_QUALIFICATION_PREDECESSOR_DRIFT';END IF;
 definition:=replace(definition,'sha256:f67287feeef2a8ff16efd48d142125f6c3ee1863bde5b92aa74f80b7e741cd35','sha256:f29e15358dd41bdeff60c00c1bf9ebbcf53a11e168d7dec7c3d54c74bae2f761');
 IF (length(definition)-length(replace(definition,'6b80ce1d51e5b6c4f3bd20b7a013e6083577b7a6','')))/length('6b80ce1d51e5b6c4f3bd20b7a013e6083577b7a6')<>1 THEN RAISE EXCEPTION 'SOULX_UPLOAD_QUALIFICATION_PREDECESSOR_DRIFT';END IF;
 definition:=replace(definition,'6b80ce1d51e5b6c4f3bd20b7a013e6083577b7a6','5741d02135d06ed56841809ad56ec362575fc8f9');
 IF (length(definition)-length(replace(definition,'sha256:316957f7c8e03a2be121fc90aeb0ec4b1cf441e59ffc3582bf0da4052be1627d','')))/length('sha256:316957f7c8e03a2be121fc90aeb0ec4b1cf441e59ffc3582bf0da4052be1627d')<>1 THEN RAISE EXCEPTION 'SOULX_UPLOAD_QUALIFICATION_PREDECESSOR_DRIFT';END IF;
 definition:=replace(definition,'sha256:316957f7c8e03a2be121fc90aeb0ec4b1cf441e59ffc3582bf0da4052be1627d','sha256:9785216a96035c752f964b30e89e8250f355ec8a6e63f301ea7dc601b16b4cfe');
 IF (length(definition)-length(replace(definition,'sha256:39bbecdc664d697270985df89822e98868cfefcb729b9c35e0155233ee54df7a','')))/length('sha256:39bbecdc664d697270985df89822e98868cfefcb729b9c35e0155233ee54df7a')<>1 THEN RAISE EXCEPTION 'SOULX_UPLOAD_QUALIFICATION_PREDECESSOR_DRIFT';END IF;
 definition:=replace(definition,'sha256:39bbecdc664d697270985df89822e98868cfefcb729b9c35e0155233ee54df7a','sha256:66541737ab331588fee8c0c8e24526de9fa27a8c4c57c6d628d51760d15c6855');
 EXECUTE definition;
END;
$migration$;
