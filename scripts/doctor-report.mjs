export const doctorReportSchemaVersion = "videoforge.doctor/v1";

export function createDoctorReport(checks, environmentNames) {
  return {
    schemaVersion: doctorReportSchemaVersion,
    ok: checks.every(({ ok }) => ok),
    providerMode: "fixture",
    providerCallsAuthorized: false,
    authorizedSpendUsd: 0,
    environment: {
      expectedNames: [...environmentNames],
      valuesIncluded: false,
    },
    checks: checks.map(({ id, category, name, ok, detail }) => ({
      id,
      category,
      name,
      ok,
      detail,
    })),
  };
}
