import { readFileSync } from "node:fs";

const policy = JSON.parse(
  readFileSync(new URL("./secrets.allowlist.json", import.meta.url), "utf8"),
);
const unique = (values, label) => {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string"))
    throw new Error(`V2-06 secret policy: ${label} must be a string array`);
  if (new Set(values).size !== values.length)
    throw new Error(`V2-06 secret policy: ${label} contains duplicates`);
  return Object.freeze([...values]);
};

if (
  policy.schema_version !== "videoforge-v2-06-secret-allowlist/v1" ||
  policy.worker !== "videoforge-v2-06-staging"
)
  throw new Error("V2-06 secret policy: schema or Worker identity drifted");

const required = unique(policy.required, "required");
const optionalTogether = unique(policy.optional_together, "optional_together");
const forbidden = unique(policy.forbidden, "forbidden");
const nonSecretVars = unique(policy.non_secret_vars, "non_secret_vars");
const requiredSet = new Set(required);
if (optionalTogether.length % 2 !== 0)
  throw new Error("V2-06 secret policy: optional_together must contain complete pairs");
if (
  optionalTogether.some((name) => requiredSet.has(name)) ||
  forbidden.some((name) => requiredSet.has(name))
)
  throw new Error("V2-06 secret policy: required and optional/forbidden categories overlap");
const scopedNames = new Set([...required, ...optionalTogether, ...forbidden]);
const scopeNames = Object.keys(policy.scopes ?? {});
if (scopeNames.length !== scopedNames.size || scopeNames.some((name) => !scopedNames.has(name)))
  throw new Error("V2-06 secret policy: scopes do not cover the declared names exactly");

const SECRET_POLICY = Object.freeze({
  ...policy,
  required,
  optional_together: optionalTogether,
  forbidden,
  non_secret_vars: nonSecretVars,
});
const REQUIRED_SECRET_NAMES = required;
const FORBIDDEN_SECRET_NAMES = forbidden;

export { FORBIDDEN_SECRET_NAMES, REQUIRED_SECRET_NAMES, SECRET_POLICY };
