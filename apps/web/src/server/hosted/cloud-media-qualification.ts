import type { HostedRuntimeEnvironment } from "./configuration";

export function cloudMediaQualificationOnly(environment: HostedRuntimeEnvironment): boolean {
  const value=environment.VIDEOFORGE_CLOUD_MEDIA_QUALIFICATION_ONLY;
  if(value===undefined || value==="false") return false;
  if(value!=="true" || environment.VIDEOFORGE_ENVIRONMENT!=="staging" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(environment.VIDEOFORGE_CLOUD_MEDIA_BUDGET_AUTHORITY_ID ?? ""))
    throw new Error("CLOUD_MEDIA_QUALIFICATION_SCOPE_INVALID");
  return true;
}

