function hostedOnly(): never {
  throw new Error("Fixture response schemas are unavailable in the hosted production client.");
}

export const parseProjectPreflightMutationResponse = (value: unknown): never => {
  void value;
  return hostedOnly();
};
export const parseProjectCreateMutationResponse = (value: unknown): never => {
  void value;
  return hostedOnly();
};
export const parseAvatarCreateMutationResponse = (value: unknown): never => {
  void value;
  return hostedOnly();
};
export const parseVoiceoverRegistrationMutationResponse = (value: unknown): never => {
  void value;
  return hostedOnly();
};
