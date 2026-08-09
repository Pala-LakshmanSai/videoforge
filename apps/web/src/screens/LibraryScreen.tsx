import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Download, Library, Play } from "lucide-react";
import { CompositionPreview } from "../components/CompositionPreview";
import { PageHeader } from "../components/PageHeader";
import { Badge, Button, Disclosure, EmptyState, Panel } from "../components/ui";
import { api } from "../lib/api";
import { currentScenario } from "../lib/scenario";

export function LibraryScreen() {
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
          {approvedProjects.map((project) => (
            <Panel
              key={project.id}
              className="library-output"
              eyebrow="Approved today"
              heading={project.title}
            >
              <CompositionPreview type="AVATAR_SPLIT_IMAGE" />
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
                    download="videoforge-fixture-preview.svg"
                  >
                    <Download size={15} />
                    Download preview
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
                    <strong>30 days remaining</strong>
                  </span>
                  <span>
                    <small>Manifest</small>
                    <strong>Deferred to local render</strong>
                  </span>
                  <span>
                    <small>Output</small>
                    <strong>Synthetic contact sheet</strong>
                  </span>
                  <span>
                    <small>Cost</small>
                    <strong>${project.actualCost.toFixed(2)}</strong>
                  </span>
                </div>
              </Disclosure>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
