import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Aperture,
  BookOpen,
  CircleGauge,
  Clapperboard,
  Images,
  Library,
  Settings,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useEffect, useRef, type PropsWithChildren } from "react";
import { api } from "../lib/api";
import { dockMotionTarget } from "../lib/dock-motion";
import { currentScenario, setScenario } from "../lib/scenario";
import { scenarioIds, type ProjectSummary, type Tone } from "../lib/types";
import { AccessGate, AccessGatePending, AccessGateUnavailable } from "./AccessGate";
import { AppSelect, Badge, Disclosure, ProgressBar } from "./ui";

const nav = [
  { to: "/", label: "Queue", icon: CircleGauge },
  { to: "/projects/new", label: "New Project", icon: Sparkles },
  { to: "/avatars", label: "Avatar Hub", icon: UsersRound },
  { to: "/styles", label: "Image Styles", icon: Images },
  { to: "/library", label: "Library", icon: Library },
  { to: "/usage", label: "Usage", icon: BookOpen },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const terminalProjectStatuses = new Set<ProjectSummary["status"]>(["APPROVED"]);
const accessFixtureScenarios: ReadonlySet<string> = new Set([
  "invite_sign_in",
  "invite_access_denied",
]);

function projectTone(status: ProjectSummary["status"]): Tone {
  if (status === "APPROVED" || status === "READY_FOR_REVIEW") return "success";
  if (status === "NEEDS_ATTENTION" || status === "CANCEL_REQUESTED") return "warning";
  if (status === "DRAFT" || status === "QUEUED") return "neutral";
  return "info";
}

function projectProgress(project: ProjectSummary): number {
  if (project.status === "APPROVED") return 100;
  if (project.total === 0) return 0;
  return Math.round((project.completed / project.total) * 100);
}

function isNavItemActive(path: string, destination: (typeof nav)[number]["to"]): boolean {
  if (destination === "/") {
    return path === "/";
  }
  if (destination === "/projects/new") return path === destination;
  return path.startsWith(destination);
}

function ProjectCommandTrack({
  project,
  scenario,
}: {
  project?: ProjectSummary;
  scenario: ReturnType<typeof currentScenario>;
}) {
  if (!project) {
    return (
      <Link
        to="/projects/new"
        search={{ fixture: scenario } as never}
        className="project-command-track project-command-track-empty"
      >
        <span className="project-command-copy">
          <span className="project-command-status">Ready</span>
          <strong>No active project</strong>
        </span>
        <span className="project-command-action">New project</span>
      </Link>
    );
  }

  const progress = projectProgress(project);
  const status = project.status.replaceAll("_", " ");

  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      search={{ fixture: scenario } as never}
      className="project-command-track"
      aria-label={`Open ${project.title}, ${progress}% complete, ${status.toLowerCase()}`}
    >
      <span className="project-command-copy">
        <span
          className={`project-command-status project-command-status-${projectTone(project.status)}`}
        >
          {status}
        </span>
        <strong>{project.title}</strong>
      </span>
      <span className="project-command-metrics" aria-hidden="true">
        <strong>{progress}%</strong>
        <span>ETA {project.eta}</span>
      </span>
      <ProgressBar value={progress} label={`${project.title} progress`} />
    </Link>
  );
}

export function AppShell({ children }: PropsWithChildren) {
  const dockRef = useRef<HTMLElement>(null);
  const scenario = currentScenario();
  const fixtureControlsEnabled = import.meta.env.DEV;
  const path = useRouterState({ select: (state) => state.location.pathname });
  const health = useQuery({
    queryKey: ["health", scenario],
    queryFn: () => api.health(scenario),
    refetchInterval: 10_000,
  });
  const bootstrap = useQuery({
    queryKey: ["bootstrap", scenario],
    queryFn: () => api.bootstrap(scenario),
    refetchInterval: 10_000,
  });
  const fixturePickerProps = {
    enabled: fixtureControlsEnabled,
    scenario,
    onScenarioChange: setScenario,
  };
  const isAccessFixture = accessFixtureScenarios.has(scenario);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let items: HTMLElement[] = [];
    let centers: number[] = [];
    let animationFrame = 0;
    let pointerX: number | null = null;

    const reset = () => {
      pointerX = null;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      for (const item of items) {
        item.style.setProperty("--dock-scale", "1");
        item.style.setProperty("--dock-lift", "0px");
        item.style.setProperty("--dock-shift", "0px");
      }
      dock.classList.remove("bottom-nav-dock-tracking");
    };

    const cacheGeometry = () => {
      items = Array.from(dock.querySelectorAll<HTMLElement>(".bottom-nav-item"));
      centers = items.map((item) => {
        const rect = item.getBoundingClientRect();
        return rect.left + rect.width / 2;
      });
    };

    const render = () => {
      animationFrame = 0;
      if (pointerX === null || !finePointer.matches || reducedMotion.matches) {
        reset();
        return;
      }
      items.forEach((item, index) => {
        const center = centers[index];
        if (center === undefined || pointerX === null) return;
        const target = dockMotionTarget(pointerX - center, true);
        item.style.setProperty("--dock-scale", target.scale.toFixed(4));
        item.style.setProperty("--dock-lift", `${target.liftPx.toFixed(2)}px`);
        item.style.setProperty("--dock-shift", `${target.shiftPx.toFixed(2)}px`);
      });
    };

    const updatePointer = (event: PointerEvent) => {
      pointerX = event.clientX;
      if (!animationFrame) animationFrame = window.requestAnimationFrame(render);
    };

    const enter = (event: PointerEvent) => {
      if (!finePointer.matches || reducedMotion.matches) return;
      cacheGeometry();
      dock.classList.add("bottom-nav-dock-tracking");
      updatePointer(event);
    };

    cacheGeometry();
    dock.addEventListener("pointerenter", enter);
    dock.addEventListener("pointermove", updatePointer);
    dock.addEventListener("pointerleave", reset);
    window.addEventListener("resize", cacheGeometry);
    finePointer.addEventListener("change", reset);
    reducedMotion.addEventListener("change", reset);

    return () => {
      reset();
      dock.removeEventListener("pointerenter", enter);
      dock.removeEventListener("pointermove", updatePointer);
      dock.removeEventListener("pointerleave", reset);
      window.removeEventListener("resize", cacheGeometry);
      finePointer.removeEventListener("change", reset);
      reducedMotion.removeEventListener("change", reset);
    };
  }, [bootstrap.data?.projects.length, scenario]);

  if (isAccessFixture && bootstrap.isPending) {
    return <AccessGatePending {...fixturePickerProps} />;
  }

  if (isAccessFixture && bootstrap.isError) {
    return (
      <AccessGateUnavailable
        {...fixturePickerProps}
        onRetry={() => {
          void bootstrap.refetch();
        }}
      />
    );
  }

  if (bootstrap.data?.access.state && bootstrap.data.access.state !== "AUTHORIZED") {
    return (
      <AccessGate
        {...fixturePickerProps}
        access={bootstrap.data.access}
        onContinue={() => setScenario("happy_generating")}
        onTryAnotherAccount={() => setScenario("invite_sign_in")}
      />
    );
  }

  const projects = bootstrap.data?.projects ?? [];
  const activeProject =
    projects.find((project) => !terminalProjectStatuses.has(project.status)) ?? projects[0];
  const healthDegraded = health.isError;
  const renderNavItem = (item: (typeof nav)[number]) => {
    const Icon = item.icon;
    const active = isNavItemActive(path, item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        search={{ fixture: scenario } as never}
        className={`bottom-nav-item ${active ? "bottom-nav-item-active" : ""}`}
        aria-current={active ? "page" : undefined}
      >
        <span className="bottom-nav-icon" aria-hidden="true">
          <Icon size={25} />
        </span>
        <span className="bottom-nav-label">{item.label}</span>
        {active ? <i className="bottom-nav-active-dot" aria-hidden="true" /> : null}
      </Link>
    );
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <span className="shell-ambient shell-ambient-crimson" aria-hidden="true" />
      <span className="shell-ambient shell-ambient-cobalt" aria-hidden="true" />

      <header className="top-command-bar">
        <div className="top-command-bar-inner">
          <Link
            to="/"
            search={{ fixture: scenario } as never}
            className="top-brand"
            aria-label="VideoForge queue"
          >
            <span className="top-brand-mark" aria-hidden="true">
              <Clapperboard size={24} />
            </span>
            <strong>VideoForge</strong>
          </Link>

          {bootstrap.isError ? (
            <div className="project-command-track project-command-track-error" role="status">
              <span className="project-command-copy">
                <span className="project-command-status project-command-status-danger">
                  Unavailable
                </span>
                <strong>Project status could not load</strong>
              </span>
            </div>
          ) : bootstrap.isPending ? (
            <div className="project-command-track project-command-track-loading" aria-busy="true">
              <span className="spinner" aria-hidden="true" />
              <strong>Loading project</strong>
            </div>
          ) : (
            <ProjectCommandTrack project={activeProject} scenario={scenario} />
          )}

          <div
            className={`top-command-tools ${fixtureControlsEnabled ? "" : "top-command-tools-production"} ${healthDegraded ? "top-command-tools-degraded" : ""}`.trim()}
          >
            <div
              className={`top-health ${healthDegraded ? "top-health-degraded" : ""}`.trim()}
              role="status"
              aria-live="polite"
            >
              <Activity size={16} aria-hidden="true" />
              <Badge
                tone={
                  health.data?.status === "ok" ? "success" : health.isError ? "danger" : "warning"
                }
              >
                API{" "}
                {health.data?.status === "ok" ? "healthy" : health.isError ? "offline" : "checking"}
              </Badge>
            </div>

            {fixtureControlsEnabled ? (
              <Disclosure
                className="fixture-control"
                summary={
                  <>
                    <Aperture size={16} aria-hidden="true" />
                    <span className="fixture-control-summary">
                      <strong>Fixture mode</strong>
                      <small>Synthetic data · $0 spend</small>
                    </span>
                    <span className="fixture-control-compact-label">Fixture</span>
                  </>
                }
              >
                <div className="fixture-control-field">
                  <span>Scenario</span>
                  <AppSelect
                    label="Scenario"
                    value={scenario}
                    onValueChange={(value) => setScenario(value as typeof scenario)}
                    options={scenarioIds.map((id) => ({ value: id, label: id }))}
                  />
                </div>
                <div className="fixture-control-meta">
                  <span>{health.data?.commit ?? "local"}</span>
                  <span>No provider calls</span>
                </div>
              </Disclosure>
            ) : null}
          </div>
        </div>
      </header>

      <div className="workspace">
        <main className="page" id="main-content">
          {children}
        </main>
      </div>

      <nav ref={dockRef} className="bottom-nav-dock" aria-label="Primary navigation">
        {nav.slice(0, 2).map(renderNavItem)}
        {activeProject ? (
          <Link
            to="/projects/$projectId"
            params={{ projectId: activeProject.id }}
            search={{ fixture: scenario } as never}
            className={`bottom-nav-item ${path.startsWith("/projects/") && path !== "/projects/new" ? "bottom-nav-item-active" : ""}`}
            aria-current={
              path.startsWith("/projects/") && path !== "/projects/new" ? "page" : undefined
            }
          >
            <span className="bottom-nav-icon" aria-hidden="true">
              <Activity size={25} />
            </span>
            <span className="bottom-nav-label">Progress</span>
            {path.startsWith("/projects/") && path !== "/projects/new" ? (
              <i className="bottom-nav-active-dot" aria-hidden="true" />
            ) : null}
          </Link>
        ) : null}
        {nav.slice(2).map(renderNavItem)}
      </nav>
    </div>
  );
}
