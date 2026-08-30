import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, UserPlus, UsersRound } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { Badge, Button, DetailsSheet, EmptyState, Panel } from "../components/ui";
import { PresetImage } from "../features/presets/PresetImage";
import { blockerNoticeForScope, NoticeBanner } from "../features/shared/FixtureFeedback";
import { avatarCompatibilityLabel, humanize, statusTone } from "../features/shared/status";
import { api } from "../lib/api";
import { currentScenario } from "../lib/scenario";
import { HostedAvatarHubScreen } from "../hosted/HostedProductScreens";
import { isHostedProviderMode } from "../hosted/provider-mode";

export function AvatarHubScreen() {
  if (isHostedProviderMode(import.meta.env.VITE_VIDEOFORGE_PROVIDER_MODE)) {
    return <HostedAvatarHubScreen />;
  }
  const scenario = currentScenario();
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["avatars", scenario], queryFn: () => api.avatars(scenario) });
  const health = useQuery({
    queryKey: ["health", scenario],
    queryFn: () => api.health(scenario),
  });
  const bootstrap = useQuery({
    queryKey: ["bootstrap", scenario],
    queryFn: () => api.bootstrap(scenario),
  });
  const avatars = query.data ?? [];
  const visibleAvatars = avatars.filter((avatar) =>
    avatar.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const localMode = health.data?.mode === "local";
  const fixtureMode = health.data?.mode === "fixture";
  const creationAvailable = fixtureMode;
  if (query.isPending) {
    return (
      <Panel eyebrow="Presets" heading="Loading Avatar Hub">
        <div className="empty-state" aria-busy="true">
          <span className="spinner" aria-hidden="true" />
          <p>Loading reusable presenters…</p>
        </div>
      </Panel>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Avatar Hub unavailable"
        body="The profile catalog could not be loaded. No empty catalog is being inferred."
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
        title="Avatar Hub"
        actions={
          creationAvailable ? (
            <Link
              className="button button-primary"
              to="/avatars/new"
              search={{ fixture: scenario } as never}
            >
              <UserPlus size={16} />
              New avatar
            </Link>
          ) : (
            <Badge tone={localMode ? "info" : health.isError ? "danger" : "neutral"}>
              {localMode
                ? "LOCAL PRESET LOCKED"
                : health.isError
                  ? "MODE UNAVAILABLE"
                  : "CHECKING MODE"}
            </Badge>
          )
        }
      />
      {localMode ? (
        <div className="notice" role="status">
          <strong>Bounded local mode.</strong> Avatar creation is unavailable; use the exact owned
          preset shown below.
        </div>
      ) : null}
      <NoticeBanner
        notice={blockerNoticeForScope(bootstrap.data?.notice, "AVATAR")}
        action={
          creationAvailable && blockerNoticeForScope(bootstrap.data?.notice, "AVATAR")?.action ? (
            <Link
              className="button button-secondary"
              to="/avatars/new"
              search={{ fixture: scenario } as never}
            >
              Open avatar workflow
            </Link>
          ) : undefined
        }
      />
      {bootstrap.data?.activeOperations.avatar ? (
        <div className="notice" role="status">
          <strong>In progress.</strong> {bootstrap.data.activeOperations.avatar}
        </div>
      ) : null}
      <div className="hub-toolbar">
        <label className="search-field">
          <span className="sr-only">Search avatars</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search avatars"
          />
        </label>
      </div>
      <Panel className="hub-panel">
        {avatars.length === 0 ? (
          <EmptyState
            icon={<UsersRound />}
            title="No ready avatars yet"
            body="Create your first named presenter before starting an ordinary project. There is no per-project upload bypass."
            action={
              creationAvailable ? (
                <Link
                  className="button button-primary"
                  to="/avatars/new"
                  search={{ fixture: scenario } as never}
                >
                  Create your first avatar
                </Link>
              ) : undefined
            }
          />
        ) : visibleAvatars.length === 0 ? (
          <EmptyState
            icon={<UsersRound />}
            title="No matching avatars"
            body="Clear or change the search to see the workspace catalog."
          />
        ) : (
          <div className="card-grid avatar-card-grid">
            {visibleAvatars.map((avatar) => {
              const attentionStatus =
                avatar.status !== "READY"
                  ? { label: humanize(avatar.status), tone: statusTone(avatar.status) }
                  : avatar.compatibility === "UNTESTED"
                    ? { label: "Fixture ready", tone: "success" as const }
                    : avatar.compatibility !== "PASSED"
                      ? {
                          label: avatarCompatibilityLabel(avatar.compatibility),
                          tone: statusTone(avatar.compatibility),
                        }
                      : null;
              return (
                <article className="entity-card avatar-card" key={avatar.versionId}>
                  <div className="avatar-card-media">
                    <PresetImage src={avatar.thumbnailUrl} alt={`${avatar.name} presenter`} />
                    {attentionStatus ? (
                      <Badge tone={attentionStatus.tone}>{attentionStatus.label}</Badge>
                    ) : null}
                  </div>
                  <div className="entity-card-body">
                    <div className="entity-title-row">
                      <h3>{avatar.name}</h3>
                    </div>
                    {avatar.warning ? <p>{avatar.warning}</p> : null}
                  </div>
                  <DetailsSheet
                    title={avatar.name}
                    description={`Version ${avatar.version} · ${avatar.compatibility === "UNTESTED" ? "fixture-ready" : avatar.compatibility.toLowerCase()}`}
                    trigger={
                      <button className="entity-details-trigger" type="button">
                        <strong>Details</strong>
                        <ArrowRight size={18} aria-hidden="true" />
                      </button>
                    }
                  >
                    <div className="avatar-crop-grid">
                      <figure>
                        <PresetImage
                          src={avatar.thumbnailUrl}
                          alt={`${avatar.name} full avatar crop`}
                        />
                        <figcaption>Full frame</figcaption>
                      </figure>
                      <figure className="split-crop">
                        <PresetImage
                          src={avatar.thumbnailUrl}
                          alt={`${avatar.name} split avatar crop`}
                        />
                        <figcaption>Split crop</figcaption>
                      </figure>
                    </div>
                    {fixtureMode ? (
                      <div className="detail-section avatar-compatibility-detail" role="status">
                        <div className="detail-section-heading">
                          <strong>Live provider compatibility</strong>
                          <Badge tone="warning">Unavailable</Badge>
                        </div>
                        <p>
                          {avatar.compatibility === "UNTESTED"
                            ? "This profile is fixture-ready, but live compatibility is untested because no provider authority is active. It is safe to select for the $0 walkthrough; no provider call or spend occurred."
                            : `The ${avatar.compatibility.toLowerCase()} state is fixture evidence only. Live provider compatibility is unavailable without authority, and no provider call or spend occurred.`}
                        </p>
                      </div>
                    ) : null}
                    <div className="detail-facts">
                      <span>
                        <small>Source</small>
                        <strong>{avatar.dimensions}</strong>
                      </span>
                      <span>
                        <small>Compatibility</small>
                        <strong>{avatar.compatibility}</strong>
                      </span>
                      <span>
                        <small>Rights</small>
                        <strong>{avatar.rightsStatus ?? "ATTESTED"}</strong>
                      </span>
                      <span>
                        <small>Preparation</small>
                        <strong>{avatar.preparationProfile ?? "avatar-source-prep-v1"}</strong>
                      </span>
                      <span>
                        <small>Validation</small>
                        <strong>{avatar.validationProfile ?? "avatar-source-validation-v1"}</strong>
                      </span>
                      <span>
                        <small>Version ID</small>
                        <strong>{avatar.versionId}</strong>
                      </span>
                      <span className="detail-fact-wide">
                        <small>Profile hash</small>
                        <strong>{avatar.profileHash}</strong>
                      </span>
                    </div>
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
