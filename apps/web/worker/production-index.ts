/**
 * V2-05 production quarantine boundary.
 *
 * Hosted adapters do not exist until V2-06, so the deployable worker fails every API request
 * closed. It deliberately imports no fixture, global-session, Pod, GPU-selection, fallback, repair,
 * provider, or inactive-runtime module. Static assets may still be served by Cloudflare Assets.
 */
export default {
  fetch(): Response {
    return Response.json(
      {
        error: {
          code: "HOSTED_RUNTIME_NOT_CONFIGURED",
          message: "The hosted tenant-private runtime is not configured.",
          retryable: false,
        },
      },
      {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "x-videoforge-runtime": "hosted-unconfigured",
        },
      },
    );
  },
} satisfies ExportedHandler;
