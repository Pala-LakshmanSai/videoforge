import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { HostedPresetCreationUnavailableScreen } from "../hosted/HostedProductScreens";
import { isHostedProviderMode } from "../hosted/provider-mode";
import { PageHeader } from "../components/PageHeader";
import { Button, Disclosure, Panel } from "../components/ui";
import { ActionToast } from "../features/shared/FixtureFeedback";
import { api } from "../lib/api";
import { parseAvatarCreateMutationResponse } from "../lib/api-schemas";
import { updateDraft } from "../lib/draft";
import { validateImageFile, type VerifiedImage } from "../lib/media-validation";
import { currentScenario, withScenario } from "../lib/scenario";

export function NewAvatarScreen() {
  if (isHostedProviderMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE)) {
    return <HostedPresetCreationUnavailableScreen kind="avatars" />;
  }
  const scenario = currentScenario();
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo") || "/avatars";
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [source, setSource] = useState<VerifiedImage | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [sourcePending, setSourcePending] = useState(false);
  const [rights, setRights] = useState(false);
  const [likeness, setLikeness] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const health = useQuery({
    queryKey: ["health", scenario],
    queryFn: () => api.health(scenario),
  });
  const catalog = useQuery({
    queryKey: ["avatars", scenario],
    queryFn: () => api.avatars(scenario),
  });
  const duplicateName = (catalog.data ?? []).some(
    (avatar) => avatar.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );

  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source.objectUrl);
    },
    [source],
  );

  async function chooseAvatarSource(file?: File) {
    if (!file) return;
    if (source) URL.revokeObjectURL(source.objectUrl);
    setSource(null);
    setSourceError(null);
    setSourcePending(true);
    try {
      setSource(await validateImageFile(file, 512));
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "Avatar source validation failed.");
    } finally {
      setSourcePending(false);
    }
  }

  async function finish() {
    if (!source || busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      const result = await api.mutate(
        "/api/v1/avatar-profiles",
        {
          name: name.trim(),
          thumbnail_url: ["", "fixtures", "avatar", "amish-farm-host.svg"].join("/"),
          source_dimensions: { width: source.width, height: source.height },
          preparation_profile: "fixture-browser-decode-v1",
          validation_profile: "fixture-manual-framing-v1",
          compatibility: "UNTESTED",
          lifecycle: "ACTIVE",
          version_state: "READY",
          uploaded_bytes_persisted: false,
          attestations: { image_use_rights: true, likeness_animation_consent: true },
        },
        scenario,
        { parse: parseAvatarCreateMutationResponse },
      );
      updateDraft({ avatarProfileVersionId: result.avatarProfile.versionId }, scenario);
      window.location.assign(withScenario(returnTo, scenario));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Avatar Profile could not be saved.");
      setBusy(false);
    }
  }

  if (health.isPending) {
    return (
      <>
        <PageHeader title="New avatar" />
        <Panel eyebrow="Provider mode" heading="Checking workflow availability">
          <div className="empty-state" aria-busy="true">
            <span className="spinner" aria-hidden="true" />
            <p>Confirming whether avatar creation is available…</p>
          </div>
        </Panel>
      </>
    );
  }

  if (health.isError) {
    return (
      <>
        <PageHeader title="New avatar" />
        <Panel eyebrow="Provider mode" heading="Avatar workflow unavailable">
          <div className="notice notice-danger" role="alert">
            Provider mode could not be confirmed, so no upload or mutation is enabled.
          </div>
          <Button variant="secondary" onClick={() => void health.refetch()}>
            Retry mode check
          </Button>
        </Panel>
      </>
    );
  }

  if (health.data.mode === "local") {
    return (
      <>
        <PageHeader
          eyebrow="Bounded local mode"
          title="New avatar"
          actions={
            <Button onClick={() => window.location.assign(withScenario(returnTo, scenario))}>
              Return
            </Button>
          }
        />
        <Panel eyebrow="Exact preset required" heading="Avatar creation is unavailable locally">
          <p className="helper">
            The local walking slice uses the exact ready owned avatar exposed by the server. No
            upload is accepted and your project draft remains unchanged.
          </p>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={`New avatar · step ${step} of 3`}
        title="New avatar"
        actions={
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => window.location.assign(withScenario(returnTo, scenario))}
          >
            Cancel
          </Button>
        }
      />
      <ActionToast message={saveError} onDismiss={() => setSaveError(null)} />
      <div className="layout-main">
        <Panel
          eyebrow="Source workflow"
          heading={
            step === 1
              ? "Name and upload"
              : step === 2
                ? "Technical and framing review"
                : "Rights and approval"
          }
        >
          {step === 1 ? (
            <div className="stack">
              <div className="field">
                <label htmlFor="avatar-name">Profile name</label>
                <input
                  id="avatar-name"
                  className="input"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Maya — studio presenter"
                />
              </div>
              <label className="dropzone">
                <input
                  aria-label="Upload avatar source"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={sourcePending}
                  onChange={(event) => void chooseAvatarSource(event.target.files?.[0])}
                />
                {sourcePending ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Upload size={27} />
                )}
                <span>
                  <strong>{source?.filename ?? "Choose one private centered source"}</strong>
                  {source
                    ? `${source.width}×${source.height} · decoded locally`
                    : "JPEG, PNG, or WebP · at least 512×512 · 20 MB max"}
                </span>
              </label>
              {sourceError ? (
                <div className="validation validation-danger">{sourceError}</div>
              ) : null}
              {duplicateName ? (
                <div className="validation validation-danger">
                  Use a unique Avatar Profile name.
                </div>
              ) : null}
              <Button
                disabled={!name.trim() || !source || duplicateName}
                onClick={() => setStep(2)}
              >
                Review source
                <ArrowRight size={16} />
              </Button>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="stack">
              {source ? (
                <img
                  className="avatar-source-preview"
                  src={source.objectUrl}
                  alt="Selected avatar source preview"
                />
              ) : null}
              <div className="validation validation-success">
                <Check size={16} />
                File signature, browser decode, and {source?.width}×{source?.height} dimensions
                passed.
              </div>
              <div className="notice notice-warning">
                <strong>Manual check required.</strong> Confirm one centered, front-facing
                presenter. Fixture mode does not run person detection, crop analysis, EXIF
                stripping, or a model.
              </div>
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)}>
                Confirm framing
                <ArrowRight size={16} />
              </Button>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="stack">
              <label className="toggle-row">
                <span>
                  <strong>Image-use rights</strong>
                  <p className="helper">
                    I own, license, or have another documented basis to use this source.
                  </p>
                </span>
                <input
                  type="checkbox"
                  checked={rights}
                  onChange={(event) => setRights(event.target.checked)}
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>Likeness animation consent</strong>
                  <p className="helper">
                    I have the right and consent to animate the depicted likeness.
                  </p>
                </span>
                <input
                  type="checkbox"
                  checked={likeness}
                  onChange={(event) => setLikeness(event.target.checked)}
                />
              </label>
              <div className="notice">
                <strong>Optional compatibility testing is not running.</strong> Saving this ready
                fixture profile costs $0 and makes no model call. Uploaded bytes stay only in this
                browser page; the Hub uses a labelled owned stand-in thumbnail.
              </div>
              <Button variant="ghost" disabled={busy} onClick={() => setStep(2)}>
                Back
              </Button>
              <Button busy={busy} disabled={!rights || !likeness} onClick={() => void finish()}>
                Approve and add to Avatar Hub
              </Button>
            </div>
          ) : null}
        </Panel>
        <Disclosure
          className="onboarding-details"
          summary={
            <>
              <span>What gets stored</span>
              <small>Private source and provenance</small>
            </>
          }
        >
          <div className="detail-facts">
            <span>
              <small>Source</small>
              <strong>Not persisted by fixture shell</strong>
            </span>
            <span>
              <small>Runtime</small>
              <strong>Owned stand-in thumbnail</strong>
            </span>
            <span>
              <small>Consent</small>
              <strong>Rights + likeness attestations</strong>
            </span>
            <span>
              <small>Compatibility</small>
              <strong>Explicit state and evidence</strong>
            </span>
          </div>
        </Disclosure>
      </div>
    </>
  );
}
