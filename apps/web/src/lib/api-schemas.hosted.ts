function hostedOnly(): never {
  throw new Error("Fixture response schemas are unavailable in the hosted production client.");
}

export const parseProjectPreflightMutationResponse = (_value: unknown): never => hostedOnly();
export const parseProjectCreateMutationResponse = (_value: unknown): never => hostedOnly();
export const parseAvatarCreateMutationResponse = (_value: unknown): never => hostedOnly();
export const parseVoiceoverRegistrationMutationResponse = (_value: unknown): never => hostedOnly();
