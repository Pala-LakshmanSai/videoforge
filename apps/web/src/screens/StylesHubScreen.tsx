import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, ImagePlus, Images } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Badge, Button, DetailsSheet, EmptyState, Panel } from "../components/ui";
import { PresetGallery } from "../features/image-styles/PresetGallery";
import { PresetImage } from "../features/presets/PresetImage";
import { blockerNoticeForScope, NoticeBanner } from "../features/shared/FixtureFeedback";
import { humanize, statusTone } from "../features/shared/status";
import { api } from "../lib/api";
import { currentScenario } from "../lib/scenario";

export function StylesHubScreen() {
  const scenario = currentScenario();
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["styles", scenario], queryFn: () => api.styles(scenario) });
  const bootstrap = useQuery({
    queryKey: ["bootstrap", scenario],
    queryFn: () => api.bootstrap(scenario),
  });
  const styles = query.data ?? [];
  const visibleStyles = styles.filter((style) =>
    style.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  if (query.isPending) {
    return (
      <Panel eyebrow="Presets" heading="Loading Image Styles">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Loading reusable visual profiles…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Image Styles unavailable"
        body="The style catalog could not be loaded. No empty catalog is being inferred."
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
      <PageHeader
        title="Image Styles"
        actions={
          <Link
            className="button button-primary"
            to="/styles/new"
            search={{ fixture: scenario } as never}
          >
            <ImagePlus size={16} />
            New style
          </Link>
        }
      />
      <NoticeBanner
        notice={blockerNoticeForScope(bootstrap.data?.notice, "STYLE")}
        action={
          blockerNoticeForScope(bootstrap.data?.notice, "STYLE")?.action ? (
            <Link
              className="button button-secondary"
              to="/styles/new"
              search={{ fixture: scenario } as never}
            >
              Open style workflow
            </Link>
          ) : undefined
        }
      />
      {bootstrap.data?.activeOperations.style ? (
        <div className="notice" role="status">
          <strong>In progress.</strong> {bootstrap.data.activeOperations.style}
        </div>
      ) : null}
      <div className="hub-toolbar">
        <label className="search-field">
          <span className="sr-only">Search image styles</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search styles"
          />
        </label>
      </div>
      <Panel className="hub-panel">
        {visibleStyles.length === 0 ? (
          <EmptyState
            icon={<Images />}
            title="No matching styles"
            body="Clear or change the search to see the workspace library."
          />
        ) : (
          <div className="card-grid style-card-grid">
            {visibleStyles.map((style) => {
              const references = style.referenceUrls ?? [];
              const examples = style.exampleUrls ?? [];
              const gallery = references.length ? references : examples;
              const galleryLabel = references.length ? "References" : "Owned examples";
              return (
                <article className="entity-card style-card" key={style.versionId}>
                  <div className="style-card-media">
                    <PresetImage src={style.coverUrl} alt={`${style.name} cover`} />
                    <div className="style-card-badges">
                      {style.isDefault ? <Badge tone="info">DEFAULT</Badge> : null}
                      {style.status !== "PUBLISHED" ? (
                        <Badge tone={statusTone(style.status)}>{humanize(style.status)}</Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="entity-card-body">
                    <div className="entity-title-row">
                      <h3>{style.name}</h3>
                    </div>
                    {style.warning ? <p>{style.warning}</p> : null}
                  </div>
                  <DetailsSheet
                    title={style.name}
                    description={`${style.status === "PUBLISHED" ? `Published v${style.version}` : humanize(style.status)} · ${galleryLabel} ${gallery.length}`}
                    trigger={
                      <button className="entity-details-trigger" type="button">
                        <span>
                          <strong>
                            {galleryLabel} ({gallery.length})
                          </strong>
                        </span>
                        <ArrowRight size={18} aria-hidden="true" />
                      </button>
                    }
                  >
                    <section className="detail-section">
                      <div className="detail-section-heading">
                        <h4>{galleryLabel}</h4>
                        <span>{gallery.length} images</span>
                      </div>
                      <PresetGallery
                        style={style}
                        urls={gallery}
                        kind={references.length ? "reference" : "owned example"}
                      />
                    </section>
                    <section className="detail-section">
                      <div className="detail-section-heading">
                        <h4>Visual profile</h4>
                      </div>
                      <div className="detail-facts">
                        <span>
                          <small>Medium</small>
                          <strong>{style.medium}</strong>
                        </span>
                        <span>
                          <small>Lighting</small>
                          <strong>{style.lighting}</strong>
                        </span>
                        <span>
                          <small>Color</small>
                          <strong>{style.color}</strong>
                        </span>
                        <span>
                          <small>Texture</small>
                          <strong>{style.texture}</strong>
                        </span>
                      </div>
                    </section>
                    <section className="detail-section">
                      <div className="detail-section-heading">
                        <h4>Rights and retention</h4>
                      </div>
                      <p>
                        {style.rightsStatus} · {style.retentionSummary}
                      </p>
                    </section>
                    <section className="detail-section">
                      <div className="detail-section-heading">
                        <h4>Technical provenance</h4>
                      </div>
                      <div className="detail-facts">
                        <span>
                          <small>Version ID</small>
                          <strong>{style.versionId}</strong>
                        </span>
                        <span>
                          <small>Profile hash</small>
                          <strong>{style.profileHash}</strong>
                        </span>
                      </div>
                    </section>
                  </DetailsSheet>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}
