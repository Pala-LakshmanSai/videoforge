import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Aperture,
  BookOpen,
  ChevronLeft,
  CircleGauge,
  Clapperboard,
  Images,
  Library,
  Menu,
  Settings,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useState, type PropsWithChildren } from "react";
import { api } from "../lib/api";
import { currentScenario, setScenario } from "../lib/scenario";
import { scenarioIds } from "../lib/types";
import { Badge } from "./ui";

const nav = [
  { to: "/", label: "Queue", icon: CircleGauge },
  { to: "/projects/new", label: "New Project", icon: Sparkles },
  { to: "/avatars", label: "Avatar Hub", icon: UsersRound },
  { to: "/styles", label: "Image Styles", icon: Images },
  { to: "/library", label: "Library", icon: Library },
  { to: "/usage", label: "Usage", icon: BookOpen },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children }: PropsWithChildren) {
  const [collapsed, setCollapsed] = useState(false);
  const scenario = currentScenario();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-row">
          <Link
            to="/"
            search={{ fixture: scenario } as never}
            className="brand"
            aria-label="VideoForge queue"
          >
            <span className="brand-mark">
              <Clapperboard size={20} />
            </span>
            <span className="brand-copy">
              <strong>VideoForge</strong>
              <small>Production studio</small>
            </span>
          </Link>
          <button
            className="icon-button collapse-button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <Menu size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <nav className="nav-list">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                search={{ fixture: scenario } as never}
                className={`nav-link ${active ? "active" : ""}`}
                title={item.label}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={19} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-card">
          <div className="avatar-orb">
            <UserRound size={18} />
          </div>
          <div>
            <strong>Lakshman</strong>
            <small>Workspace admin</small>
          </div>
          <Badge tone="success">INVITED</Badge>
        </div>
      </aside>

      <div className="workspace">
        <div className="dev-ribbon" role="status">
          <div>
            <Aperture size={14} />
            <strong>Fixture mode</strong>
            <span>Synthetic data · $0 spend</span>
          </div>
          <div className="ribbon-controls">
            <label htmlFor="fixture-select">Scenario</label>
            <select
              id="fixture-select"
              value={scenario}
              onChange={(event) => setScenario(event.target.value as typeof scenario)}
            >
              {scenarioIds.map((id) => (
                <option value={id} key={id}>
                  {id}
                </option>
              ))}
            </select>
            <Badge
              tone={
                health.data?.status === "ok" ? "success" : health.isError ? "danger" : "warning"
              }
            >
              API {health.data?.status ?? (health.isError ? "offline" : "checking")}
            </Badge>
            <span className="commit">{health.data?.commit ?? "local"}</span>
          </div>
        </div>
        <main className="page" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
