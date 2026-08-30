import { useQuery } from "@tanstack/react-query";
import {
  type FixtureStyleCreationAdapter,
  HostedPresetCreationScreen,
  HostedPresetCreationUnavailableScreen,
} from "../hosted/HostedProductScreens";
import { isHostedBetaMode, isHostedProviderMode } from "../hosted/provider-mode";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/ui";
import { api } from "../lib/api";
import { normalizeImageStyleReference } from "../lib/media-validation";
import { currentScenario, withScenario } from "../lib/scenario";

export function NewStyleScreen() {
  if (isHostedBetaMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE)) {
    return <HostedPresetCreationScreen kind="styles" />;
  }
  if (isHostedProviderMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE)) {
    return <HostedPresetCreationUnavailableScreen kind="styles" />;
  }
  return <FixtureStyleCreationRoute />;
}

function FixtureStyleCreationRoute() {
  const scenario = currentScenario();
  const fixtureStyleAdapter: FixtureStyleCreationAdapter = {
    returnTo: withScenario("/styles", scenario),
    async listStyles() {
      const styles = await api.styles(scenario);
      return styles.map((style) => ({
        style_id: style.id,
        version_id: style.versionId,
        name: style.name,
        version_number: style.version,
        state: style.status,
        profile_hash: style.profileHash,
        reference_count: style.referenceCount,
      }));
    },
    normalize: normalizeImageStyleReference,
    async createAndRegister(name, sources) {
      const draft = await api.createImageStyleDraft(
        { schema_version: "image-style-draft-create/v1", name },
        scenario,
      );
      return api.registerImageStyleReferences(
        draft.style_id,
        draft.version_id,
        {
          schema_version: "image-style-reference-batch/v1",
          rights: {
            reference_rights_attested: true,
            processing_disclosure_acknowledged: true,
            retention_choice: "NORMALIZED_SESSION_ONLY",
          },
          references: sources.map((source, index) => ({
            client_reference_id: source.clientReferenceId,
            filename: source.filename,
            order_index: index,
            original: {
              media_type: source.original.mediaType,
              checksum: source.original.checksum,
              width: source.original.width,
              height: source.original.height,
              bytes_base64: source.original.bytesBase64,
            },
            normalized: {
              media_type: "image/webp",
              checksum: source.normalized.checksum,
              width: source.normalized.width,
              height: source.normalized.height,
              bytes_base64: source.normalized.bytesBase64,
              color_space: "srgb",
              metadata_stripped: true,
              orientation_applied: true,
            },
          })),
        },
        draft.version_tag,
        scenario,
      );
    },
    analyze(value) {
      return api.analyzeImageStyleDraft(
        value.style_id,
        value.version_id,
        value.version_tag,
        scenario,
      );
    },
    publish(value) {
      return api.publishImageStyleDraft(
        value.style_id,
        value.version_id,
        value.version_tag,
        scenario,
      );
    },
  };
  const health = useQuery({
    queryKey: ["health", scenario],
    queryFn: () => api.health(scenario),
  });
  if (health.data?.mode === "local") {
    return (
      <>
        <PageHeader eyebrow="Bounded local mode" title="Style creation is unavailable locally" />
        <Panel eyebrow="Exact preset required" heading="Use the published documentary style">
          <p>The local slice uses the exact published documentary style.</p>
        </Panel>
      </>
    );
  }
  if (health.isPending) {
    return <Panel eyebrow="Private style" heading="Loading style workflow" />;
  }
  if (health.isError) {
    return <Panel eyebrow="Private style" heading="Style workflow unavailable" />;
  }
  return <HostedPresetCreationScreen kind="styles" fixtureStyleAdapter={fixtureStyleAdapter} />;
}
