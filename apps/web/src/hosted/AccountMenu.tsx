import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, LogOut, UserRound, UsersRound } from "lucide-react";
import { useHostedIdentity } from "./HostedIdentity";
import { Disclosure } from "../components/ui";
export function AccountMenu() {
  const identity = useHostedIdentity();
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        const details = container.current?.querySelector("details");
        if (details) details.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("focusin", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("focusin", close);
    };
  }, []);
  if (!identity) return null;
  return (
    <div ref={container} className="account-menu">
      <Disclosure
        summary={
          <>
            <UserRound size={18} aria-hidden="true" />
            <span>Account</span>
          </>
        }
      >
        <p className="account-email">{identity.email}</p>
        {identity.canManageTeam && (
          <Link
            to="/access"
            className="account-team-link"
            onClick={() => {
              const details = container.current?.querySelector("details");
              if (details) details.open = false;
            }}
          >
            <UsersRound size={18} aria-hidden="true" />
            <span>
              <strong>Team access</strong>
              <small>Invite and manage assistants</small>
            </span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        )}
        <button type="button" className="account-signout" onClick={() => void identity.signOut()}>
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </button>
      </Disclosure>
    </div>
  );
}
