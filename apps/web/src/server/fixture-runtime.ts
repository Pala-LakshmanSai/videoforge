import {
  toBootstrapResponse,
  type FixtureBootstrapResponse,
  type FixtureScenario,
} from "@videoforge/test-fixtures";
import type { Context } from "hono";

import { projectDetailsForScenario } from "./domain/project-service";
import { avatarCatalog, imageStyleCatalog } from "./domain/preset-service";
import type { FixtureSessionState } from "./domain/models";
import { FixtureSessionStore } from "./fixture-session";
import { idempotentMutation } from "./mutation";
import { SharedAppFixtureStore } from "./shared-app-fixture";

export class FixtureRuntime {
  readonly sessions: FixtureSessionStore;
  readonly sharedApp = new SharedAppFixtureStore();

  constructor(
    readonly environment: string,
    readonly commit: string,
  ) {
    this.sessions = new FixtureSessionStore(environment);
  }

  resolveSession(c: Context) {
    return this.sessions.resolve(c);
  }

  mutation(
    c: Context,
    requireVersion: boolean,
    handle: (rawBody: string, state: FixtureSessionState) => Response | Promise<Response>,
  ): Promise<Response> {
    const session = this.resolveSession(c);
    if (!session.ok) return Promise.resolve(session.response);
    return idempotentMutation(c, session.state.idempotencyLedger, requireVersion, (rawBody) =>
      handle(rawBody, session.state),
    );
  }

  bootstrapResponse(
    scenario: FixtureScenario,
    state: FixtureSessionState,
  ): FixtureBootstrapResponse {
    const response = toBootstrapResponse(scenario);
    if (scenario.snapshot.access.state !== "AUTHORIZED") return response;
    response.projects = projectDetailsForScenario(state.runtimeProjects, scenario).map(
      (detail) => detail.project,
    );
    response.avatars = avatarCatalog(scenario, state.createdAvatars);
    response.styles = imageStyleCatalog(scenario, state.createdStyles);
    if (scenario.id === "happy_generating" && state.createdProjectRequest) {
      const registeredVoiceover = state.registeredVoiceovers.get(
        state.createdProjectRequest.voiceover_asset_id,
      );
      response.draft = {
        ...response.draft,
        title: state.createdProjectRequest.title,
        voiceover: {
          assetId: state.createdProjectRequest.voiceover_asset_id,
          filename: registeredVoiceover?.filename ?? response.draft.voiceover.filename,
          durationSeconds:
            registeredVoiceover?.durationSeconds ?? response.draft.voiceover.durationSeconds,
          uploadState: "VERIFIED",
        },
        avatarProfileVersionId: state.createdProjectRequest.avatar_profile_version_id,
        imageStyleVersionId: state.createdProjectRequest.image_style_version_id,
        optionalScript: state.createdProjectRequest.optional_script ?? null,
        extraPromptKeywords: state.createdProjectRequest.extra_prompt_keywords ?? null,
        applyExtraPromptKeywords: state.createdProjectRequest.apply_extra_prompt_keywords,
        effectiveExtraPromptKeywords: state.createdProjectRequest.apply_extra_prompt_keywords
          ? (state.createdProjectRequest.extra_prompt_keywords ?? null)
          : null,
        generationMode: state.createdProjectRequest.generation_mode,
        spendCapUsd: state.createdProjectRequest.spend_cap_usd,
      };
    }
    return response;
  }
}
