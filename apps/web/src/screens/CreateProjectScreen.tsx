import * as Switch from "@radix-ui/react-switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { createProjectRequestSchema, validateOutputRuleKeywords } from "@videoforge/contracts";
import { AlertTriangle, ArrowRight, Check, FileAudio, ImagePlus, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Button, Disclosure, Panel } from "../components/ui";
import { ComputeLaneSelect } from "../features/project-create/ComputeLaneSelect";
import { VisualPresetSelect } from "../features/project-create/VisualPresetSelect";
import { useProjectDraft } from "../features/project-create/useProjectDraft";
import { ActionToast, NoticeBanner, noticeForScope } from "../features/shared/FixtureFeedback";
import { avatarCompatibilityLabel } from "../features/shared/status";
import { api, ApiError } from "../lib/api";
import {
  parseProjectCreateMutationResponse,
  parseProjectPreflightMutationResponse,
  parseVoiceoverRegistrationMutationResponse,
} from "../lib/api-schemas";
import { createProjectBlockers } from "../lib/create-eligibility";
import { hasStoredDraft } from "../lib/draft";
import { validateVoiceoverFile } from "../lib/media-validation";
import { currentScenario, withScenario } from "../lib/scenario";

export function CreateProjectScreen() {
  const scenario = currentScenario();
  const [draft, setDraft] = useProjectDraft(scenario);
  const [draftHydrated, setDraftHydrated] = useState(() => hasStoredDraft(scenario));
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioPending, setAudioPending] = useState(false);
  const [submittedError, setSubmittedError] = useState<string | null>(null);
  const revalidatedVoiceover = useRef<string | null>(null);
  const audioValidation = useRef<AbortController | null>(null);
  const bootstrap = useQuery({
    queryKey: ["bootstrap", scenario],
    queryFn: () => api.bootstrap(scenario),
  });
  const compute = useQuery({
    queryKey: ["execution-profiles", scenario],
    queryFn: () => api.executionProfiles(scenario),
  });
  const avatars = bootstrap.data?.avatars ?? [];
  const styles = bootstrap.data?.styles ?? [];
  const readyAvatars = avatars.filter((avatar) => avatar.status === "READY");
  const publishedStyles = styles.filter((style) => style.status === "PUBLISHED");
  const selectedAvatar = readyAvatars.find(
    (avatar) => avatar.versionId === draft.avatarProfileVersionId,
  );
  const selectedStyle = publishedStyles.find(
    (style) => style.versionId === draft.imageStyleVersionId,
  );
  const imageLane = compute.data?.lanes.find((lane) => lane.lane === "image_media");
  const avatarLane = compute.data?.lanes.find((lane) => lane.lane === "avatar_primary");
  const selectedImageProfileId =
    draft.executionProfileOverrides?.image_media_profile_id ??
    imageLane?.selector_options[0]?.profile_id ??
    "";
  const selectedAvatarProfileId =
    draft.executionProfileOverrides?.avatar_primary_profile_id ??
    avatarLane?.selector_options[0]?.profile_id ??
    "";
  const primaryProfilesReady = Boolean(
    imageLane?.selector_options.some(
      (option) => option.selectable && option.profile_id === selectedImageProfileId,
    ) &&
      avatarLane?.selector_options.some(
        (option) => option.selectable && option.profile_id === selectedAvatarProfileId,
      ),
  );

  useEffect(() => {
    if (!bootstrap.data || draftHydrated) return;
    const fixtureDraft = bootstrap.data.draft;
    setDraft((current) => ({
      ...current,
      title: fixtureDraft.title,
      voiceoverAssetId:
        fixtureDraft.voiceover.uploadState === "VERIFIED" ? fixtureDraft.voiceover.assetId : null,
      voiceoverName:
        fixtureDraft.voiceover.uploadState === "VERIFIED" ? fixtureDraft.voiceover.filename : null,
      voiceoverDurationSeconds:
        fixtureDraft.voiceover.uploadState === "VERIFIED"
          ? fixtureDraft.voiceover.durationSeconds
          : null,
      voiceoverSampleRate: null,
      voiceoverChannels: null,
      voiceoverChecksum: null,
      avatarProfileVersionId: fixtureDraft.avatarProfileVersionId ?? "",
      imageStyleVersionId: fixtureDraft.imageStyleVersionId,
      extraPromptKeywords: fixtureDraft.extraPromptKeywords ?? "",
      applyExtraPromptKeywords: fixtureDraft.applyExtraPromptKeywords,
      generationMode: fixtureDraft.generationMode,
      spendCapUsd: fixtureDraft.spendCapUsd,
    }));
    setDraftHydrated(true);
  }, [bootstrap.data, draftHydrated, setDraft]);

  useEffect(() => {
    const imageProfileId = imageLane?.selector_options[0]?.profile_id;
    const avatarProfileId = avatarLane?.selector_options[0]?.profile_id;
    if (draft.executionProfileOverrides !== null || !imageProfileId || !avatarProfileId) return;
    setDraft((current) => ({
      ...current,
      executionProfileOverrides: {
        image_media_profile_id: imageProfileId,
        avatar_primary_profile_id: avatarProfileId,
      },
    }));
  }, [avatarLane, draft.executionProfileOverrides, imageLane, setDraft]);

  useEffect(() => {
    const assetId = draft.voiceoverAssetId;
    if (
      !draftHydrated ||
      !assetId?.startsWith("fixture_voiceover_sha256_") ||
      revalidatedVoiceover.current === assetId
    ) {
      return;
    }
    revalidatedVoiceover.current = assetId;
    let active = true;
    void api
      .voiceover(assetId, scenario)
      .then((voiceover) => {
        if (!active) return;
        setAudioError(null);
        setDraft((current) => ({
          ...current,
          voiceoverName: voiceover.filename,
          voiceoverDurationSeconds: voiceover.durationSeconds,
          voiceoverSampleRate: voiceover.sampleRate,
          voiceoverChannels: voiceover.channels,
          voiceoverChecksum: voiceover.checksum,
        }));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDraft((current) => ({
          ...current,
          voiceoverAssetId: null,
          voiceoverName: null,
          voiceoverDurationSeconds: null,
          voiceoverSampleRate: null,
          voiceoverChannels: null,
          voiceoverChecksum: null,
        }));
        setAudioError(
          error instanceof ApiError && error.code === "VOICEOVER_ASSET_NOT_FOUND"
            ? "Voiceover verification expired when the local fixture server restarted. Choose the file again."
            : error instanceof Error
              ? error.message
              : "Voiceover verification could not be confirmed. Choose the file again.",
        );
      });
    return () => {
      active = false;
    };
  }, [draft.voiceoverAssetId, draftHydrated, scenario]);

  useEffect(
    () => () => {
      audioValidation.current?.abort();
    },
    [],
  );

  const keywordValidation = validateOutputRuleKeywords(draft.extraPromptKeywords);
  const conflict = draft.applyExtraPromptKeywords && !keywordValidation.valid;
  const keywordEmpty = draft.applyExtraPromptKeywords && !draft.extraPromptKeywords.trim();
  const payload = {
    title: draft.title.trim(),
    voiceover_asset_id: draft.voiceoverAssetId ?? "",
    avatar_profile_version_id: draft.avatarProfileVersionId,
    image_style_version_id: draft.imageStyleVersionId,
    optional_script: null,
    extra_prompt_keywords: draft.extraPromptKeywords || null,
    apply_extra_prompt_keywords: draft.applyExtraPromptKeywords,
    generation_mode: draft.generationMode,
    execution_profile_overrides: draft.executionProfileOverrides,
    spend_cap_usd: draft.spendCapUsd,
    user_seed: draft.userSeed,
  };
  const estimatedCostUsd = 0.88;
  const submitBlockers = createProjectBlockers({
    audioError,
    audioPending,
    avatarReady: Boolean(selectedAvatar),
    bootstrapState: bootstrap.isError ? "error" : bootstrap.isPending ? "pending" : "ready",
    computeState: compute.isError ? "error" : compute.isPending ? "pending" : "ready",
    contractValid: createProjectRequestSchema.safeParse(payload).success,
    draftHydrated,
    estimatedCostUsd,
    keywordConflictLabels: keywordValidation.conflicts.map((item) => item.label),
    keywordEnabled: draft.applyExtraPromptKeywords,
    keywordText: draft.extraPromptKeywords,
    primaryProfilesReady,
    spendCapUsd: draft.spendCapUsd,
    stylePublished: Boolean(selectedStyle),
    title: draft.title,
    voiceoverAssetId: draft.voiceoverAssetId,
  });
  const canSubmit = submitBlockers.length === 0;
  const primaryBlocker = submitBlockers[0];
  const create = useMutation({
    mutationFn: async () => {
      setSubmittedError(null);
      const mutationId = crypto.randomUUID();
      await api.mutate("/api/v1/projects/preflight", payload, scenario, {
        idempotencyKey: `${mutationId}:preflight`,
        parse: parseProjectPreflightMutationResponse,
      });
      return api.mutate("/api/v1/projects", payload, scenario, {
        idempotencyKey: `${mutationId}:create`,
        parse: parseProjectCreateMutationResponse,
      });
    },
    onSuccess: (result) =>
      window.location.assign(
        withScenario(
          `/projects/${result.id || "project_fixture_001"}`,
          result.nextFixture ?? scenario,
        ),
      ),
    onError: (error) =>
      setSubmittedError(error instanceof Error ? error.message : "Project could not be created."),
  });

  async function chooseAudio(file?: File) {
    if (!file) return;
    audioValidation.current?.abort();
    const validation = new AbortController();
    audioValidation.current = validation;
    revalidatedVoiceover.current = null;
    setDraft((value) => ({
      ...value,
      voiceoverAssetId: null,
      voiceoverName: null,
      voiceoverDurationSeconds: null,
      voiceoverSampleRate: null,
      voiceoverChannels: null,
      voiceoverChecksum: null,
    }));
    setAudioError(null);
    setAudioPending(true);
    try {
      const verified = await validateVoiceoverFile(file, { signal: validation.signal });
      if (validation.signal.aborted) return;
      await api.mutate(
        "/api/v1/voiceovers/register",
        {
          asset_id: verified.assetId,
          checksum: verified.checksum,
          filename: verified.filename,
          duration_seconds: verified.durationSeconds,
          sample_rate: verified.sampleRate,
          channels: verified.channels,
        },
        scenario,
        { parse: parseVoiceoverRegistrationMutationResponse },
      );
      if (validation.signal.aborted) return;
      setDraft((value) => ({
        ...value,
        voiceoverAssetId: verified.assetId,
        voiceoverName: verified.filename,
        voiceoverDurationSeconds: verified.durationSeconds,
        voiceoverSampleRate: verified.sampleRate,
        voiceoverChannels: verified.channels,
        voiceoverChecksum: verified.checksum,
      }));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setAudioError(error instanceof Error ? error.message : "Voiceover validation failed.");
      }
    } finally {
      if (audioValidation.current === validation) {
        audioValidation.current = null;
        setAudioPending(false);
      }
    }
  }

  return (
    <>
      <PageHeader title="New project" />
      <ActionToast message={submittedError} onDismiss={() => setSubmittedError(null)} />
      {bootstrap.isError ? (
        <div className="notice notice-danger" role="alert">
          <strong>Project setup unavailable.</strong> Reload after the local API is healthy.
        </div>
      ) : (
        <NoticeBanner notice={noticeForScope(bootstrap.data?.notice, "CREATE")} />
      )}
      <div className="layout-main">
        <Panel className="create-config-panel">
          <div className="form-grid">
            <section className="create-section field-wide" aria-labelledby="create-narration">
              <header className="create-section-header">
                <span className="create-section-index">01</span>
                <h3 id="create-narration">Narration</h3>
              </header>
              <div className="create-section-grid">
                <div className="field field-wide">
                  <label htmlFor="project-title">Video title</label>
                  <input
                    id="project-title"
                    className="input"
                    maxLength={240}
                    placeholder="Why food prices behave the way they do"
                    value={draft.title}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, title: event.target.value }))
                    }
                  />
                  {draft.title.trim().length > 200 ? (
                    <small>{draft.title.trim().length}/240</small>
                  ) : null}
                </div>
                <div className="field field-wide">
                  <span className="field-label">Final voiceover</span>
                  <label className="dropzone">
                    <input
                      aria-label="Upload final voiceover"
                      id="voiceover-input"
                      type="file"
                      accept="audio/wav,audio/mpeg,audio/mp4,audio/aac,audio/flac"
                      disabled={audioPending || create.isPending}
                      onChange={(event) => void chooseAudio(event.target.files?.[0])}
                    />
                    {audioPending ? (
                      <span className="spinner" aria-hidden="true" />
                    ) : (
                      <FileAudio size={28} />
                    )}
                    <span>
                      <strong>
                        {audioPending
                          ? "Checking audio…"
                          : (draft.voiceoverName ?? "Drop or choose final narration")}
                      </strong>
                      {draft.voiceoverAssetId
                        ? "Verified and ready"
                        : "WAV, MP3, M4A, AAC, or FLAC"}
                    </span>
                  </label>
                  {audioError ? (
                    <div className="validation validation-danger">
                      <AlertTriangle size={16} />
                      {audioError}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
            <section className="create-section field-wide" aria-labelledby="create-look">
              <header className="create-section-header">
                <span className="create-section-index">02</span>
                <h3 id="create-look">Look</h3>
              </header>
              <div className="create-section-grid">
                <div className="field preset-field">
                  <VisualPresetSelect
                    id="avatar-profile-select"
                    label="Avatar Profile"
                    options={readyAvatars.map((avatar) => ({
                      id: avatar.versionId,
                      imageUrl: avatar.thumbnailUrl,
                      meta:
                        avatar.compatibility === "PASSED"
                          ? undefined
                          : avatarCompatibilityLabel(avatar.compatibility),
                      name: avatar.name,
                    }))}
                    selectedId={draft.avatarProfileVersionId}
                    onChange={(avatarProfileVersionId) =>
                      setDraft((value) => ({ ...value, avatarProfileVersionId }))
                    }
                  />
                  <div className="preset-select-actions">
                    <Link
                      className="button button-secondary"
                      to="/avatars/new"
                      search={{ fixture: scenario, returnTo: "/projects/new" } as never}
                    >
                      <UserPlus size={15} />
                      New avatar
                    </Link>
                  </div>
                  {readyAvatars.length === 0 ? (
                    <div className="validation validation-warning">
                      <AlertTriangle size={16} />
                      Create your first ready avatar before generation.
                    </div>
                  ) : null}
                </div>
                <div className="field preset-field">
                  <VisualPresetSelect
                    id="image-style-select"
                    label="Image Style"
                    options={publishedStyles.map((style) => ({
                      id: style.versionId,
                      imageUrl: style.coverUrl,
                      meta: style.isDefault ? "Default" : undefined,
                      name: style.name,
                    }))}
                    selectedId={draft.imageStyleVersionId}
                    onChange={(imageStyleVersionId) =>
                      setDraft((value) => ({ ...value, imageStyleVersionId }))
                    }
                  />
                  <div className="preset-select-actions">
                    <Link
                      className="button button-secondary"
                      to="/styles/new"
                      search={{ fixture: scenario, returnTo: "/projects/new" } as never}
                    >
                      <ImagePlus size={15} />
                      New style
                    </Link>
                  </div>
                </div>
                <Disclosure
                  className="field field-wide create-options"
                  summary={<span>Image keywords</span>}
                >
                  <div className="stack">
                    <div className="toggle-row">
                      <strong>Apply extra keywords to AI images</strong>
                      <Switch.Root
                        className="switch-root"
                        checked={draft.applyExtraPromptKeywords}
                        onCheckedChange={(checked) =>
                          setDraft((value) => ({ ...value, applyExtraPromptKeywords: checked }))
                        }
                        aria-label="Apply extra image prompt keywords"
                      >
                        <Switch.Thumb className="switch-thumb" />
                      </Switch.Root>
                    </div>
                    <div className="field">
                      <label htmlFor="image-keywords">Image keywords</label>
                      <textarea
                        id="image-keywords"
                        className="textarea"
                        maxLength={500}
                        value={draft.extraPromptKeywords}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            extraPromptKeywords: event.target.value,
                          }))
                        }
                      />
                    </div>
                    {keywordEmpty ? (
                      <div className="validation validation-danger">
                        <X size={16} />
                        Add keywords or turn the toggle off.
                      </div>
                    ) : conflict ? (
                      <div className="validation validation-danger">
                        <X size={16} />
                        Remove requests for{" "}
                        {keywordValidation.conflicts.map((item) => item.label).join(", ")}.
                      </div>
                    ) : null}
                  </div>
                </Disclosure>
              </div>
            </section>
            <section className="create-section field-wide" aria-labelledby="create-run">
              <header className="create-section-header">
                <span className="create-section-index">03</span>
                <h3 id="create-run">Run</h3>
              </header>
              <div className="create-section-grid">
                {imageLane && avatarLane ? (
                  <div className="compute-lane-grid field-wide" id="compute-profiles">
                    <ComputeLaneSelect
                      lane={imageLane}
                      selectedProfileId={selectedImageProfileId}
                      onChange={(image_media_profile_id) =>
                        setDraft((value) => ({
                          ...value,
                          executionProfileOverrides: {
                            ...(value.executionProfileOverrides ?? {}),
                            image_media_profile_id,
                          },
                        }))
                      }
                    />
                    <ComputeLaneSelect
                      lane={avatarLane}
                      selectedProfileId={selectedAvatarProfileId}
                      onChange={(avatar_primary_profile_id) =>
                        setDraft((value) => ({
                          ...value,
                          executionProfileOverrides: {
                            ...(value.executionProfileOverrides ?? {}),
                            avatar_primary_profile_id,
                          },
                        }))
                      }
                    />
                  </div>
                ) : compute.isError ? (
                  <div className="validation validation-danger field-wide" role="alert">
                    Compute profiles are unavailable. Reload after the local API is healthy.
                  </div>
                ) : (
                  <div className="validation field-wide" role="status">
                    Loading compute profiles…
                  </div>
                )}
                <div className="field field-wide">
                  <span className="field-label">Execution mode</span>
                  <div className="option-grid">
                    {(["LOWEST_COST", "BALANCED", "FASTER"] as const).map((mode) => (
                      <button
                        type="button"
                        key={mode}
                        className={`option-card ${draft.generationMode === mode ? "selected" : ""}`}
                        onClick={() => setDraft((value) => ({ ...value, generationMode: mode }))}
                      >
                        <strong>{mode.replace("_", " ")}</strong>
                        <span>
                          {mode === "LOWEST_COST"
                            ? "Minimize eligible cost"
                            : mode === "BALANCED"
                              ? "Balance cost and speed"
                              : "Prioritize eligible speed"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </Panel>
        <div className="stack">
          <Panel className="create-run-panel" eyebrow="Run" heading="Ready to generate">
            <div
              className={`run-readiness ${canSubmit ? "ready" : "blocked"}`}
              role="status"
              id="run-blocker-summary"
            >
              {canSubmit ? <Check size={18} /> : <AlertTriangle size={18} />}
              <span>
                <strong>
                  {canSubmit ? "Ready" : (primaryBlocker?.message ?? "Review inputs.")}
                </strong>
                {!canSubmit && submitBlockers.length > 1 ? (
                  <small>{submitBlockers.length - 1} more to review</small>
                ) : null}
              </span>
            </div>
            {!canSubmit && submitBlockers.length > 1 ? (
              <Disclosure
                className="run-blocker-details"
                summary={<span>Review all {submitBlockers.length} issues</span>}
              >
                <ul className="run-blocker-list">
                  {submitBlockers.map((blocker) => (
                    <li key={blocker.code}>
                      {blocker.target ? (
                        <a href={`#${blocker.target}`}>{blocker.message}</a>
                      ) : (
                        blocker.message
                      )}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            ) : null}
            <div className="field">
              <label htmlFor="spend-cap">Hard spend cap</label>
              <input
                id="spend-cap"
                className="input"
                type="number"
                min="0.1"
                max="2"
                step="0.05"
                value={draft.spendCapUsd}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    spendCapUsd: Math.min(2, Math.max(0.1, Number(event.target.value))),
                  }))
                }
              />
              <small>Estimated ${estimatedCostUsd.toFixed(2)} · fixture spend $0</small>
            </div>
            <Button
              busy={create.isPending}
              disabled={!canSubmit}
              aria-describedby={canSubmit ? undefined : "run-blocker-summary"}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating project…" : "Generate video"}
              <ArrowRight size={16} />
            </Button>
            <Disclosure
              className="run-settings"
              summary={
                <>
                  <span>Review settings</span>
                  <small>Versions, mode, seed</small>
                </>
              }
            >
              <div className="detail-facts">
                <span>
                  <small>Avatar</small>
                  <strong>
                    {selectedAvatar
                      ? `${selectedAvatar.name} · v${selectedAvatar.version}`
                      : "Required"}
                  </strong>
                </span>
                <span>
                  <small>Style</small>
                  <strong>
                    {selectedStyle
                      ? `${selectedStyle.name} · v${selectedStyle.version}`
                      : "Required"}
                  </strong>
                </span>
                <span>
                  <small>Mode</small>
                  <strong>{draft.generationMode.replaceAll("_", " ")}</strong>
                </span>
                <span>
                  <small>Seed</small>
                  <strong>{draft.userSeed}</strong>
                </span>
                <span>
                  <small>Provider calls</small>
                  <strong>0 in fixture mode</strong>
                </span>
              </div>
            </Disclosure>
          </Panel>
        </div>
      </div>
    </>
  );
}
