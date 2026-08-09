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
import {
  dockMotionTarget,
  dockSpringSettled,
  stepDockSpring,
  type DockMotionTarget,
  type DockSpringState,
} from "../lib/dock-motion";
import { currentScenario, setScenario } from "../lib/scenario";
import { scenarioIds, type ProjectSummary, type Tone } from "../lib/types";
import { AccessGate, AccessGatePending, AccessGateUnavailable } from "./AccessGate";
import { AppSelect, Badge, Disclosure, ProgressBar } from "./ui";

const nav = [
  { to: "/", label: "Queue", mobileLabel: "Queue", icon: CircleGauge },
  { to: "/projects/new", label: "New Project", mobileLabel: "New", icon: Sparkles },
  { to: "/avatars", label: "Avatar Hub", mobileLabel: "Avatars", icon: UsersRound },
  { to: "/styles", label: "Image Styles", mobileLabel: "Styles", icon: Images },
  { to: "/library", label: "Library", mobileLabel: "Library", icon: Library },
  { to: "/usage", label: "Usage", mobileLabel: "Usage", icon: BookOpen },
  { to: "/settings", label: "Settings", mobileLabel: "Settings", icon: Settings },
] as const;

interface DockItemSpring {
  scale: DockSpringState;
}

const neutralDockTarget: DockMotionTarget = { influence: 0, scale: 1 };

function neutralDockSpring(): DockItemSpring {
  return {
    scale: { value: 1, velocity: 0 },
  };
}

const terminalProjectStatuses = new Set<ProjectSummary["status"]>(["APPROVED", "CANCELLED"]);
const accessFixtureScenarios: ReadonlySet<string> = new Set([
  "invite_sign_in",
  "invite_access_denied",
]);

function projectTone(status: ProjectSummary["status"]): Tone {
  if (status === "APPROVED" || status === "READY_FOR_REVIEW") return "success";
  if (status === "NEEDS_ATTENTION" || status === "CANCEL_REQUESTED" || status === "CANCELLED")
    return "warning";
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
  const localMode = health.data?.mode === "local";

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const finePointer = window.matchMedia(
      "(hover: hover) and (pointer: fine) and (min-width: 821px)",
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let items: HTMLElement[] = [];
    let centers: number[] = [];
    let animationFrame = 0;
    let lastFrameAt: number | null = null;
    let pointerX: number | null = null;
    let tracking = false;
    let springs: DockItemSpring[] = [];

    const applySpring = (item: HTMLElement, spring: DockItemSpring) => {
      item.style.setProperty("--dock-scale", spring.scale.value.toFixed(4));
    };

    const resetImmediately = () => {
      tracking = false;
      pointerX = null;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      lastFrameAt = null;
      springs = items.map(() => neutralDockSpring());
      items.forEach((item, index) => applySpring(item, springs[index] ?? neutralDockSpring()));
      dock.classList.remove("bottom-nav-dock-springing");
    };

    const cacheGeometry = () => {
      items = Array.from(dock.querySelectorAll<HTMLElement>(".bottom-nav-item"));
      centers = items.map((item) => {
        const rect = item.getBoundingClientRect();
        return rect.left + rect.width / 2;
      });
      if (springs.length !== items.length) springs = items.map(() => neutralDockSpring());
    };

    const targetFor = (index: number): DockMotionTarget => {
      const center = centers[index];
      return tracking && pointerX !== null && center !== undefined
        ? dockMotionTarget(pointerX - center, true)
        : neutralDockTarget;
    };

    const render = (frameAt: number) => {
      animationFrame = 0;
      if (!finePointer.matches || reducedMotion.matches) {
        resetImmediately();
        return;
      }
      const elapsedSeconds = lastFrameAt === null ? 1 / 60 : (frameAt - lastFrameAt) / 1_000;
      lastFrameAt = frameAt;
      let moving = false;

      items.forEach((item, index) => {
        const spring = springs[index] ?? neutralDockSpring();
        const target = targetFor(index);
        spring.scale = stepDockSpring(spring.scale, target.scale, elapsedSeconds);

        if (dockSpringSettled(spring.scale, target.scale))
          spring.scale = { value: target.scale, velocity: 0 };

        springs[index] = spring;
        applySpring(item, spring);
        moving ||= !dockSpringSettled(spring.scale, target.scale);
      });

      if (moving) {
        animationFrame = window.requestAnimationFrame(render);
      } else {
        lastFrameAt = null;
        dock.classList.remove("bottom-nav-dock-springing");
      }
    };

    const schedule = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(render);
    };

    const updatePointer = (event: PointerEvent) => {
      if (!tracking || !finePointer.matches || reducedMotion.matches) return;
      pointerX = event.clientX;
      dock.classList.add("bottom-nav-dock-springing");
      schedule();
    };

    const enter = (event: PointerEvent) => {
      if (!finePointer.matches || reducedMotion.matches) return;
      cacheGeometry();
      tracking = true;
      lastFrameAt = null;
      dock.classList.add("bottom-nav-dock-springing");
      updatePointer(event);
    };

    const leave = () => {
      tracking = false;
      pointerX = null;
      dock.classList.add("bottom-nav-dock-springing");
      schedule();
    };

    cacheGeometry();
    dock.addEventListener("pointerenter", enter);
    dock.addEventListener("pointermove", updatePointer);
    dock.addEventListener("pointerleave", leave);
    window.addEventListener("resize", cacheGeometry);
    finePointer.addEventListener("change", resetImmediately);
    reducedMotion.addEventListener("change", resetImmediately);

    return () => {
      resetImmediately();
      dock.removeEventListener("pointerenter", enter);
      dock.removeEventListener("pointermove", updatePointer);
      dock.removeEventListener("pointerleave", leave);
      window.removeEventListener("resize", cacheGeometry);
      finePointer.removeEventListener("change", resetImmediately);
      reducedMotion.removeEventListener("change", resetImmediately);
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
        aria-label={item.label}
      >
        <span className="bottom-nav-icon" aria-hidden="true">
          <Icon size={30} />
        </span>
        <span className="bottom-nav-label bottom-nav-label-full">{item.label}</span>
        <span className="bottom-nav-label bottom-nav-label-mobile" aria-hidden="true">
          {item.mobileLabel}
        </span>
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
                      <strong>{localMode ? "Local media mode" : "Fixture mode"}</strong>
                      <small>
                        {localMode
                          ? "Owned media · $0 external spend"
                          : "Synthetic data · $0 spend"}
                      </small>
                    </span>
                    <span className="fixture-control-compact-label">
                      {localMode ? "Local" : "Fixture"}
                    </span>
                  </>
                }
              >
                {localMode ? (
                  <div className="fixture-control-field">
                    <span>Walking slice</span>
                    <strong>Owned narration, avatar, and image</strong>
                  </div>
                ) : (
                  <div className="fixture-control-field">
                    <span>Scenario</span>
                    <AppSelect
                      label="Scenario"
                      value={scenario}
                      onValueChange={(value) => setScenario(value as typeof scenario)}
                      options={scenarioIds.map((id) => ({ value: id, label: id }))}
                    />
                  </div>
                )}
                <div className="fixture-control-meta">
                  <span>{health.data?.commit ?? "local"}</span>
                  <span>{localMode ? "Local tools only" : "No provider calls"}</span>
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
              <Activity size={30} />
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
