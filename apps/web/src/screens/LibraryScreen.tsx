import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Download, Library, Play, Trash2 } from "lucide-react";
import { CompositionPreview } from "../components/CompositionPreview";
import { isLocalVideoArtifact, MediaArtifactPreview } from "../components/MediaArtifactPreview";
import { PageHeader } from "../components/PageHeader";
import { Badge, Button, Disclosure, EmptyState, Panel } from "../components/ui";
import { api } from "../lib/api";
import { currentScenario } from "../lib/scenario";

interface HostedLibraryItem {
  readonly attempt_id: string;
  readonly project_id: string;
  readonly title: string;
  readonly created_at: string;
  readonly content_length: number;
  readonly checksum_sha256: string;
  readonly download_url: string;
  readonly download_expires_at: string;
}

interface HostedLibraryResponse {
  readonly schema_version: "videoforge-hosted-library/v1";
  readonly outputs: readonly HostedLibraryItem[];
}

async function hostedLibrary(): Promise<HostedLibraryResponse> {
  const response = await fetch("/api/v2/library", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Hosted Library could not be loaded.");
  return response.json() as Promise<HostedLibraryResponse>;
}

function HostedLibraryScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["hosted-library"],
    queryFn: hostedLibrary,
    refetchInterval: 240_000,
  });
  const remove = useMutation({
    mutationFn: async (attemptId: string) => {
      const response = await fetch(`/api/v2/cpu-attempts/${attemptId}/output`, {
        method: "DELETE",
        headers: { accept: "application/json" },
      });
      if (!response.ok && response.status !== 204) throw new Error("Video could not be deleted.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hosted-library"] }),
  });

  if (query.isPending) {
    return (
      <Panel eyebrow="Private R2 outputs" heading="Loading Library">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Creating short-lived download links…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Library unavailable"
        body="No fixture or public-storage fallback was used."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }

  return (
    <>
      <PageHeader title="Library" />
      {query.data.outputs.length === 0 ? (
        <EmptyState
          icon={<Library />}
          title="No finished videos"
          body="A successful personal-worker render appears here and stays until you explicitly delete it."
        />
      ) : (
        <div className="library-grid">
          {query.data.outputs.map((output) => (
            <Panel
              key={output.attempt_id}
              className="library-output"
              eyebrow="Private R2 output"
              heading={output.title}
            >
              <video controls preload="metadata" src={output.download_url}>
                Your browser does not support video playback.
              </video>
              <div className="entity-card-footer">
                <Badge tone="success">READY</Badge>
                <div className="cluster">
                  <a
                    className="button button-secondary"
                    href={output.download_url}
                    download={`${output.title}.mp4`}
                  >
                    <Download size={15} />
                    Download MP4
                  </a>
                  <Button
                    variant="danger"
                    busy={remove.isPending && remove.variables === output.attempt_id}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Delete this video permanently from private storage? Download it first if you need a copy.",
                        )
                      ) {
                        remove.mutate(output.attempt_id);
                      }
                    }}
                  >
                    <Trash2 size={15} />
                    Delete
                  </Button>
                </div>
              </div>
              <Disclosure summary="Storage and integrity">
                <div className="detail-facts">
                  <span>
                    <small>Retention</small>
                    <strong>Until you click Delete</strong>
                  </span>
                  <span>
                    <small>Size</small>
                    <strong>{Math.ceil(output.content_length / 1024 / 1024)} MB</strong>
                  </span>
                  <span className="detail-fact-wide">
                    <small>SHA-256</small>
                    <strong>{output.checksum_sha256}</strong>
                  </span>
                </div>
              </Disclosure>
            </Panel>
          ))}
        </div>
      )}
      {remove.isError ? (
        <div className="validation validation-danger" role="alert">
          {remove.error.message}
        </div>
      ) : null}
    </>
  );
}

export function LibraryScreen() {
  return import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE === "fixture" ? (
    <FixtureLibraryScreen />
  ) : (
    <HostedLibraryScreen />
  );
}

function FixtureLibraryScreen() {
  const scenario = currentScenario();
  const query = useQuery({
    queryKey: ["projects", scenario],
    queryFn: () => api.projects(scenario),
  });
  const approvedProjects = (query.data ?? []).filter((project) => project.status === "APPROVED");
  if (query.isPending) {
    return (
      <Panel eyebrow="Approved outputs" heading="Loading Library">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Loading approved revisions…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Library unavailable"
        body="Approved output data could not be loaded."
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            Retry load
          </Button>
        }
      />
    );
  }
  return (
    <>
      <PageHeader title="Library" />
      {approvedProjects.length === 0 ? (
        <EmptyState
          icon={<Library />}
          title="No approved outputs"
          body="Projects appear here only after an explicit final approval."
        />
      ) : (
        <div className="library-grid">
          {approvedProjects.map((project) => {
            const artifact = project.latestArtifact;
            const localVideo = isLocalVideoArtifact(artifact);
            return (
              <Panel
                key={project.id}
                className="library-output"
                eyebrow="Approved today"
                heading={project.title}
              >
                <MediaArtifactPreview
                  artifact={artifact}
                  fixtureFallback={<CompositionPreview type="AVATAR_SPLIT_IMAGE" />}
                />
                <div className="entity-card-footer">
                  <Badge tone="success">APPROVED</Badge>
                  <div className="cluster">
                    <Link
                      className="button button-secondary"
                      to="/projects/$projectId/review"
                      params={{ projectId: project.id }}
                      search={{ fixture: scenario } as never}
                    >
                      <Play size={15} />
                      Review
                    </Link>
                    <a
                      className="button button-secondary"
                      href={
                        project.review.downloadUrl ??
                        `/api/v1/projects/${project.id}/download?fixture=${scenario}`
                      }
                      download={
                        localVideo ? (artifact.filename ?? true) : "videoforge-fixture-preview.svg"
                      }
                    >
                      <Download size={15} />
                      {localVideo ? "Download MP4" : "Download preview"}
                    </a>
                  </div>
                </div>
                <Disclosure
                  className="library-details"
                  summary={
                    <>
                      <span>Details</span>
                      <small>Retention and provenance</small>
                    </>
                  }
                >
                  <div className="detail-facts">
                    <span>
                      <small>Retention</small>
                      <strong>
                        {localVideo ? "Bounded local artifact store" : "30 days remaining"}
                      </strong>
                    </span>
                    <span>
                      <small>Manifest</small>
                      <strong>
                        {localVideo ? "Validated local render" : "Deferred to local render"}
                      </strong>
                    </span>
                    <span>
                      <small>Output</small>
                      <strong>
                        {localVideo
                          ? (artifact.filename ?? artifact.label)
                          : "Synthetic contact sheet"}
                      </strong>
                    </span>
                    <span>
                      <small>Cost</small>
                      <strong>${project.actualCost.toFixed(2)}</strong>
                    </span>
                    {localVideo ? (
                      <span className="detail-fact-wide">
                        <small>Checksum</small>
                        <strong>{artifact.sha256 ?? "Unavailable"}</strong>
                      </span>
                    ) : null}
                  </div>
                </Disclosure>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
