import { useQuery } from "@tanstack/react-query";
import type { ImageStyleHubVersionResponse } from "@videoforge/contracts/image-style-hub";
import { ArrowRight, Check, Images, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Button, Disclosure, Panel } from "../components/ui";
import { ActionToast } from "../features/shared/FixtureFeedback";
import { fixtureLink } from "../features/shared/fixture-link";
import { api } from "../lib/api";
import { updateDraft } from "../lib/draft";
import {
  normalizeImageStyleReference,
  type NormalizedStyleReference,
} from "../lib/media-validation";
import { currentScenario } from "../lib/scenario";

export function NewStyleScreen() {
  const scenario = currentScenario();
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo") || "/styles";
  const resumeStyleId = params.get("styleId");
  const resumeVersionId = params.get("versionId");
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [files, setFiles] = useState<NormalizedStyleReference[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [filesPending, setFilesPending] = useState(false);
  const [rights, setRights] = useState(false);
  const [disclosure, setDisclosure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [hubVersion, setHubVersion] = useState<ImageStyleHubVersionResponse | null>(null);
  const [medium, setMedium] = useState("");
  const [lighting, setLighting] = useState("");
  const [color, setColor] = useState("");
  const [texture, setTexture] = useState("");
  const operationKeys = useRef({
    analyze: crypto.randomUUID(),
    create: crypto.randomUUID(),
    edit: crypto.randomUUID(),
    publish: crypto.randomUUID(),
    references: crypto.randomUUID(),
  });
  const resumeApplied = useRef(false);
  const health = useQuery({
    queryKey: ["health", scenario],
    queryFn: () => api.health(scenario),
  });
  const catalog = useQuery({ queryKey: ["styles", scenario], queryFn: () => api.styles(scenario) });
  const resumedDraft = useQuery({
    queryKey: ["style-draft", resumeStyleId, resumeVersionId, scenario],
    queryFn: () => api.imageStyleDraft(resumeStyleId!, resumeVersionId!, scenario),
    enabled: Boolean(resumeStyleId && resumeVersionId),
  });
  const duplicateName = (catalog.data ?? []).some(
    (style) => style.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );

  useEffect(
    () => () => {
      for (const file of files) URL.revokeObjectURL(file.objectUrl);
    },
    [files],
  );

  useEffect(() => {
    const resumed = resumedDraft.data;
    if (!resumed || resumeApplied.current) return;
    resumeApplied.current = true;
    setHubVersion(resumed);
    setName(resumed.name);
    if (resumed.profile) {
      setMedium(resumed.profile.visual_profile.medium_family);
      setLighting(resumed.profile.visual_profile.lighting);
      setColor(resumed.profile.visual_profile.color.descriptors.join(", "));
      setTexture(resumed.profile.visual_profile.texture_and_grain);
    }
    if (resumed.state === "NEEDS_REVIEW") setStep(3);
    else if (resumed.state === "PUBLISHED") setStep(4);
    else if (resumed.state === "REFERENCES_READY") setStep(2);
  }, [resumedDraft.data]);

  async function chooseStyleReferences(selected: FileList | null) {
    for (const file of files) URL.revokeObjectURL(file.objectUrl);
    setFiles([]);
    setFileError(null);
    const candidates = Array.from(selected ?? []);
    if (candidates.length === 0) return;
    if (candidates.length > 8) {
      setFileError("Choose no more than 8 reference images.");
      return;
    }
    setFilesPending(true);
    try {
      const results = await Promise.allSettled(
        candidates.map((file) => normalizeImageStyleReference(file)),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failure) {
        for (const result of results) {
          if (result.status === "fulfilled") URL.revokeObjectURL(result.value.objectUrl);
        }
        throw failure.reason;
      }
      setFiles(
        results.map((result) => (result as PromiseFulfilledResult<NormalizedStyleReference>).value),
      );
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Reference validation failed.");
    } finally {
      setFilesPending(false);
    }
  }

  async function analyze() {
    if (busy) return;
    setBusy(true);
    setPublishError(null);
    try {
      let current = hubVersion;
      if (!current) {
        current = await api.createImageStyleDraft(
          { schema_version: "image-style-draft-create/v1", name: name.trim() },
          scenario,
          operationKeys.current.create,
        );
        setHubVersion(current);
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("styleId", current.style_id);
        nextUrl.searchParams.set("versionId", current.version_id);
        window.history.replaceState(null, "", nextUrl);
      }
      if (current.state === "DRAFT") {
        current = await api.registerImageStyleReferences(
          current.style_id,
          current.version_id,
          {
            schema_version: "image-style-reference-batch/v1",
            rights: {
              reference_rights_attested: true,
              processing_disclosure_acknowledged: true,
              retention_choice: "NORMALIZED_SESSION_ONLY",
            },
            references: files.map((file, index) => ({
              client_reference_id: file.clientReferenceId,
              filename: file.filename,
              order_index: index,
              original: {
                media_type: file.original.mediaType,
                checksum: file.original.checksum,
                width: file.original.width,
                height: file.original.height,
                bytes_base64: file.original.bytesBase64,
              },
              normalized: {
                media_type: "image/webp",
                checksum: file.normalized.checksum,
                width: file.normalized.width,
                height: file.normalized.height,
                bytes_base64: file.normalized.bytesBase64,
                color_space: "srgb",
                metadata_stripped: true,
                orientation_applied: true,
              },
            })),
          },
          current.version_tag,
          scenario,
          operationKeys.current.references,
        );
        setHubVersion(current);
      }
      const analyzed =
        current.state === "REFERENCES_READY"
          ? await api.analyzeImageStyleDraft(
              current.style_id,
              current.version_id,
              current.version_tag,
              scenario,
              operationKeys.current.analyze,
            )
          : current;
      if (!analyzed.profile) throw new Error("Fixture analysis returned no review profile.");
      setHubVersion(analyzed);
      setMedium(analyzed.profile.visual_profile.medium_family);
      setLighting(analyzed.profile.visual_profile.lighting);
      setColor(analyzed.profile.visual_profile.color.descriptors.join(", "));
      setTexture(analyzed.profile.visual_profile.texture_and_grain);
      setStep(3);
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "References could not be analyzed.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptReview() {
    if (!hubVersion?.profile || busy) return;
    setBusy(true);
    setPublishError(null);
    try {
      const current = hubVersion.profile;
      const candidate = {
        ...current,
        visual_profile: {
          ...current.visual_profile,
          medium_family: medium.trim(),
          lighting: lighting.trim(),
          color: {
            ...current.visual_profile.color,
            descriptors: color
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          },
          texture_and_grain: texture.trim(),
        },
      };
      const changed = JSON.stringify(candidate) !== JSON.stringify(current);
      const accepted = changed
        ? await api.editFixtureImageStyleDraft(
            hubVersion.style_id,
            hubVersion.version_id,
            { schema_version: "image-style-edit-request/v1", candidate_profile: candidate },
            hubVersion.version_tag,
            scenario,
            operationKeys.current.edit,
          )
        : hubVersion;
      setHubVersion(accepted);
      setStep(4);
    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : "Reviewed profile could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (busy) return;
    if (!hubVersion) return;
    setBusy(true);
    setPublishError(null);
    try {
      const result = await api.publishImageStyleDraft(
        hubVersion.style_id,
        hubVersion.version_id,
        hubVersion.version_tag,
        scenario,
        operationKeys.current.publish,
      );
      updateDraft({ imageStyleVersionId: result.version_id }, scenario);
      window.location.assign(fixtureLink(returnTo));
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Image Style could not be saved.");
      setBusy(false);
    }
  }

  if (health.isPending) {
    return (
      <>
        <PageHeader title="New style" />
        <Panel eyebrow="Provider mode" heading="Checking workflow availability">
          <div className="empty-state" aria-busy="true">
            <span className="spinner" aria-hidden="true" />
            <p>Confirming whether style creation is available…</p>
          </div>
        </Panel>
      </>
    );
  }

  if (health.isError) {
    return (
      <>
        <PageHeader title="New style" />
        <Panel eyebrow="Provider mode" heading="Style workflow unavailable">
          <div className="notice notice-danger" role="alert">
            Provider mode could not be confirmed, so no upload, analysis, or mutation is enabled.
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
          title="New style"
          actions={
            <Button onClick={() => window.location.assign(fixtureLink(returnTo))}>Return</Button>
          }
        />
        <Panel eyebrow="Exact preset required" heading="Style creation is unavailable locally">
          <p className="helper">
            The local walking slice uses the exact published documentary style exposed by the
            server. No references are uploaded or analyzed and your project draft remains unchanged.
          </p>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={`New style · step ${step} of 4`}
        title="New style"
        actions={
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => window.location.assign(fixtureLink(returnTo))}
          >
            Cancel
          </Button>
        }
      />
      <ActionToast message={publishError} onDismiss={() => setPublishError(null)} />
      <div className="layout-main">
        <Panel
          eyebrow="Version workflow"
          heading={
            step === 1
              ? "Upload references"
              : step === 2
                ? "Consent and analyze"
                : step === 3
                  ? "Review extracted traits"
                  : "Publish immutable version"
          }
        >
          {step === 1 ? (
            <div className="stack">
              <div className="field">
                <label htmlFor="style-name">Style name</label>
                <input
                  id="style-name"
                  className="input"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Warm field documentary"
                />
              </div>
              <label className="dropzone">
                <input
                  aria-label="Upload style references"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={filesPending}
                  onChange={(event) => void chooseStyleReferences(event.target.files)}
                />
                {filesPending ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Images size={28} />
                )}
                <span>
                  <strong>
                    {files.length
                      ? `${files.length} private reference${files.length === 1 ? "" : "s"} selected`
                      : "Choose 3–8 visual references"}
                  </strong>
                </span>
              </label>
              {fileError ? <div className="validation validation-danger">{fileError}</div> : null}
              {duplicateName ? (
                <div className="validation validation-danger">Use a unique Image Style name.</div>
              ) : null}
              {files.length ? (
                <div className="reference-mosaic fixture-upload-preview">
                  {files.map((file) => (
                    <figure key={file.objectUrl}>
                      <img src={file.objectUrl} alt={`${file.filename} local preview`} />
                      <figcaption>
                        {file.width}×{file.height}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
              <Button
                disabled={!name.trim() || files.length < 3 || duplicateName}
                onClick={() => setStep(2)}
              >
                Continue
                <ArrowRight size={16} />
              </Button>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="stack">
              <label className="toggle-row">
                <span>
                  <strong>Reference rights attestation</strong>
                  <p className="helper">
                    I have a documented right to use these images for style analysis.
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
                  <strong>Runware processing disclosure</strong>
                  <p className="helper">
                    Normalized copies go to Runware; standard processing is not zero-data-retention
                    or confidential.
                  </p>
                </span>
                <input
                  type="checkbox"
                  checked={disclosure}
                  onChange={(event) => setDisclosure(event.target.checked)}
                />
              </label>
              <div className="notice notice-warning">
                <strong>Fixture simulation.</strong> No references leave this page, no traits are
                inferred from them, and no Runware request is made. The next screen demonstrates the
                review shape with owned synthetic data at $0.
              </div>
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button busy={busy} disabled={!rights || !disclosure} onClick={() => void analyze()}>
                Analyze fixture references
              </Button>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="stack">
              <div className="grid grid-2">
                {[
                  ["Reviewed medium", medium, setMedium],
                  ["Reviewed lighting", lighting, setLighting],
                  ["Reviewed color", color, setColor],
                  ["Reviewed texture", texture, setTexture],
                ].map(([label, value, setter]) => (
                  <label className="field" key={label as string}>
                    <span>{label as string}</span>
                    <textarea
                      aria-label={label as string}
                      className="input"
                      value={value as string}
                      maxLength={600}
                      onChange={(event) => (setter as (next: string) => void)(event.target.value)}
                    />
                  </label>
                ))}
              </div>
              <div className="validation validation-success">
                <Check size={16} />
                The deterministic fixture profile contains no people, logos, visible instructions,
                or exact-subject requirements.
              </div>
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                busy={busy}
                disabled={!medium.trim() || !lighting.trim() || !color.trim() || !texture.trim()}
                onClick={() => void acceptReview()}
              >
                Accept reviewed profile
              </Button>
            </div>
          ) : null}
          {step === 4 ? (
            <div className="stack">
              <div
                className="style-cover"
                style={{ "--cover-a": "#1f3b45", "--cover-b": "#b6805e" } as React.CSSProperties}
              />
              <div className="validation validation-success">
                <ShieldCheck size={16} />
                Publishing creates immutable style profile v1 and atomically activates it.
              </div>
              <div className="notice">
                <strong>Original bytes were discarded.</strong> Bounded metadata-stripped WebP
                references remain only in this isolated fixture session. A real analysis or Mage
                test requires separate authorization later.
              </div>
              <Button variant="ghost" disabled={busy} onClick={() => setStep(3)}>
                Back
              </Button>
              <Button busy={busy} onClick={() => void publish()}>
                Publish style v1
              </Button>
            </div>
          ) : null}
        </Panel>
        <Disclosure
          className="onboarding-details"
          summary={
            <>
              <span>How styles work</span>
              <small>Analysis, reuse, and cost</small>
            </>
          }
        >
          <div className="detail-facts">
            <span>
              <small>Analysis</small>
              <strong>Once per draft version</strong>
            </span>
            <span>
              <small>Projects</small>
              <strong>Pin published version + hash</strong>
            </span>
            <span>
              <small>Cost</small>
              <strong>Separate from project spend</strong>
            </span>
            <span>
              <small>Fixture run</small>
              <strong>$0 · no provider call</strong>
            </span>
          </div>
        </Disclosure>
      </div>
    </>
  );
}
