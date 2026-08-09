import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Images, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Button, Disclosure, Panel } from "../components/ui";
import { ActionToast } from "../features/shared/FixtureFeedback";
import { fixtureLink } from "../features/shared/fixture-link";
import { api } from "../lib/api";
import { parseImageStyleCreateMutationResponse } from "../lib/api-schemas";
import { updateDraft } from "../lib/draft";
import { validateImageFile, type VerifiedImage } from "../lib/media-validation";
import { currentScenario } from "../lib/scenario";

export function NewStyleScreen() {
  const scenario = currentScenario();
  const params = new URLSearchParams(window.location.search);
  const returnTo = params.get("returnTo") || "/styles";
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [files, setFiles] = useState<VerifiedImage[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [filesPending, setFilesPending] = useState(false);
  const [rights, setRights] = useState(false);
  const [disclosure, setDisclosure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const catalog = useQuery({ queryKey: ["styles", scenario], queryFn: () => api.styles(scenario) });
  const duplicateName = (catalog.data ?? []).some(
    (style) => style.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );

  useEffect(
    () => () => {
      for (const file of files) URL.revokeObjectURL(file.objectUrl);
    },
    [files],
  );

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
        candidates.map((file) => validateImageFile(file, 256)),
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
      setFiles(results.map((result) => (result as PromiseFulfilledResult<VerifiedImage>).value));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Reference validation failed.");
    } finally {
      setFilesPending(false);
    }
  }

  async function publish() {
    if (busy) return;
    setBusy(true);
    setPublishError(null);
    try {
      const exampleUrls = [
        "/fixtures/styles/rural-field.svg",
        "/fixtures/styles/rural-hands.svg",
        "/fixtures/styles/rural-kitchen.svg",
        "/fixtures/styles/rural-market.svg",
      ].slice(0, files.length);
      const result = await api.mutate(
        "/api/v1/image-styles",
        {
          name: name.trim(),
          summary:
            "Natural light, restrained contrast, material texture, and documentary camera language.",
          cover_url: "/fixtures/styles/warm-rural.svg",
          reference_urls: [],
          example_urls: exampleUrls,
          medium: "Natural-light rural documentary",
          lighting: "Warm available light",
          color: "Earth tones and muted botanical green",
          texture: "Tactile material detail, restrained sharpening",
          retention_summary:
            "Fixture mode retained no uploaded bytes; owned examples stand in after navigation",
          lifecycle: "ACTIVE",
          version_state: "PUBLISHED",
          uploaded_bytes_persisted: false,
          attestations: {
            reference_rights: true,
            processing_disclosure_acknowledged: true,
          },
        },
        scenario,
        { parse: parseImageStyleCreateMutationResponse },
      );
      updateDraft({ imageStyleVersionId: result.imageStyle.versionId }, scenario);
      window.location.assign(fixtureLink(returnTo));
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Image Style could not be saved.");
      setBusy(false);
    }
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
              <Button disabled={!rights || !disclosure} onClick={() => setStep(3)}>
                Analyze fixture references
              </Button>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="stack">
              <div className="grid grid-2">
                <div className="metric">
                  <span>Medium</span>
                  <strong>Documentary still</strong>
                  <small>Owned fixture example · not inferred</small>
                </div>
                <div className="metric">
                  <span>Lighting</span>
                  <strong>Natural soft side light</strong>
                  <small>Synthetic review value</small>
                </div>
                <div className="metric">
                  <span>Color</span>
                  <strong>Warm earth + muted cyan</strong>
                  <small>Synthetic review value</small>
                </div>
                <div className="metric">
                  <span>Texture</span>
                  <strong>Material detail</strong>
                  <small>Synthetic review value</small>
                </div>
              </div>
              <div className="validation validation-success">
                <Check size={16} />
                The deterministic fixture profile contains no people, logos, visible instructions,
                or exact-subject requirements.
              </div>
              <Button variant="ghost" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={() => setStep(4)}>Accept reviewed profile</Button>
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
                <strong>Uploaded bytes are not persisted.</strong> The published fixture card will
                show labelled owned examples. A real analysis or Mage test requires separate
                authorization later.
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
