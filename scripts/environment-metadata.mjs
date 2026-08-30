const entries = [
  { name: "BETTER_AUTH_SECRET", credentialBearing: true },
  { name: "CLOUDFLARE_API_TOKEN", credentialBearing: true },
  { name: "DATABASE_URL", credentialBearing: true },
  { name: "DEEPSEEK_API_KEY", credentialBearing: true },
  { name: "GOOGLE_CLIENT_ID", credentialBearing: false },
  { name: "GOOGLE_CLIENT_SECRET", credentialBearing: true },
  { name: "NEON_DATABASE_URL", credentialBearing: true },
  { name: "R2_ACCESS_KEY_ID", credentialBearing: true },
  { name: "R2_ACCOUNT_ID", credentialBearing: false },
  { name: "R2_SECRET_ACCESS_KEY", credentialBearing: true },
  { name: "RUNPOD_API_KEY", credentialBearing: true },
  { name: "RUNWARE_API_KEY", credentialBearing: true },
];

export const integrationEnvironmentMetadata = Object.freeze(
  entries.map((entry) => Object.freeze({ ...entry, serverOnly: true, placeholderRequired: true })),
);

export const integrationEnvironmentNames = Object.freeze(
  integrationEnvironmentMetadata.map(({ name }) => name),
);

export const secretEnvironmentNames = Object.freeze(
  integrationEnvironmentMetadata
    .filter(({ credentialBearing }) => credentialBearing)
    .map(({ name }) => name),
);
