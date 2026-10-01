import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Copy, MailPlus, ShieldCheck, UsersRound } from "lucide-react";
import { useHostedIdentity } from "./HostedIdentity";

interface Member {
  id: string;
  email: string;
  owner: boolean;
  disabled: boolean;
}
interface Invite {
  id: string;
  email: string;
  state: string;
  expires_at: string;
}
interface Team {
  members: Member[];
  invites: Invite[];
}
const messages: Record<string, string> = {
  TEAM_ACCESS_FORBIDDEN: "Team access is available only to the two studio owners.",
  TEAM_ALREADY_ADMITTED:
    "This account already has access. Restore its access in Members if needed.",
  TEAM_OWNER_PROTECTED: "Studio owners cannot be revoked.",
  TEAM_INVITE_NOT_ACTIVE: "This invitation changed. Refresh the list and try again.",
  TEAM_INVITE_INVALID: "Enter a valid Google email address.",
  HOSTED_RATE_LIMITED: "Too many requests. Wait a minute and try again.",
  AUTHENTICATION_REQUIRED: "Your session expired. Sign in again.",
};
async function teamRequest(operation?: string, target?: string) {
  const response = await fetch("/api/v2/team-access", {
    method: operation ? "POST" : "GET",
    headers: operation ? { "content-type": "application/json" } : { accept: "application/json" },
    ...(operation ? { body: JSON.stringify({ operation, target }) } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      messages[String(data.error?.code)] ?? "Team access could not update. Refresh and try again.",
    );
  return data;
}
export function TeamAccessScreen() {
  const identity = useHostedIdentity();
  const [email, setEmail] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [invite, setInvite] = useState<{ email: string; code: string; expires_at: string } | null>(
    null,
  );
  const [confirmation, setConfirmation] = useState<{
    operation: string;
    target: string;
    email: string;
  } | null>(null);
  const team = useQuery<Team>({
    queryKey: ["team-access", identity?.email],
    queryFn: () => teamRequest(),
    enabled: identity?.canManageTeam === true,
    refetchInterval: 30000,
  });
  async function mutate(operation: string, target: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    if (operation === "INVITE") setInvite(null);
    try {
      const result = await teamRequest(operation, target);
      if (operation === "INVITE") {
        setInvite({
          email: target.trim().toLowerCase(),
          code: result.code,
          expires_at: result.expires_at,
        });
        setEmail("");
        setMessage("Invitation created. Share the code privately with this Google account.");
      } else {
        if (operation === "REVOKE_INVITE") setInvite(null);
        setConfirmation(null);
        setMessage(
          operation === "RESTORE"
            ? "Access restored. The assistant can sign in again."
            : "Access revoked.",
        );
      }
      await team.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connection interrupted. Try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!identity?.canManageTeam)
    return (
      <section className="team-access">
        <h1>Team access</h1>
        <p role="alert">Team access is available only to the two studio owners.</p>
        <Link to="/">Back to studio</Link>
      </section>
    );
  const members =
    team.data?.members.filter((member) =>
      member.email.toLowerCase().includes(search.trim().toLowerCase()),
    ) ?? [];
  return (
    <section className="team-access">
      <Link to="/" className="team-back">
        <ArrowLeft size={16} aria-hidden="true" />
        Back to studio
      </Link>
      <header className="team-heading">
        <div>
          <span className="team-eyebrow">
            <ShieldCheck size={16} aria-hidden="true" />
            Studio administration
          </span>
          <h1>Team access</h1>
          <p>Invite assistants to their own private studio, and manage their access.</p>
        </div>
        <span className="team-count">
          <UsersRound size={18} aria-hidden="true" />
          {team.data?.members.length ?? "—"} members
        </span>
      </header>
      <div className="team-layout">
        <section className="team-card team-invite-card" aria-labelledby="invite-heading">
          <span className="team-card-icon">
            <MailPlus size={24} aria-hidden="true" />
          </span>
          <h2 id="invite-heading">Invite an assistant</h2>
          <p>Use their Google email. Each invitation is single use and expires after 72 hours.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void mutate("INVITE", email);
            }}
          >
            <label htmlFor="team-email">Google email</label>
            <input
              id="team-email"
              type="email"
              required
              maxLength={320}
              autoComplete="off"
              placeholder="assistant@gmail.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button type="submit" disabled={busy}>
              {busy ? "Updating…" : "Create invitation"}
            </button>
          </form>
          {invite && (
            <div className="team-code">
              <strong>Invitation for {invite.email}</strong>
              <p>Expires {new Date(invite.expires_at).toLocaleString()}</p>
              <label htmlFor="invitation-code">Private invitation code</label>
              <input id="invitation-code" readOnly value={invite.code} />
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(invite.code);
                    setMessage("Invitation code copied.");
                  } catch {
                    setMessage("Copy unavailable. Select and copy the code above.");
                  }
                }}
              >
                <Copy size={16} aria-hidden="true" />
                Copy code
              </button>
              <p>
                Open VideoForge, sign in with this Google account, then enter the code. The code is
                shown only here.
              </p>
              <button type="button" className="team-secondary" onClick={() => setInvite(null)}>
                Dismiss code
              </button>
            </div>
          )}
          <p className="team-privacy">
            <ShieldCheck size={16} aria-hidden="true" />
            Projects, presets and media stay private to each account.
          </p>
        </section>
        <section className="team-card" aria-labelledby="members-heading">
          <div className="team-section-heading">
            <h2 id="members-heading">Members</h2>
            <button
              type="button"
              className="team-secondary"
              disabled={busy || team.isFetching}
              onClick={() => void team.refetch()}
            >
              Refresh
            </button>
          </div>
          <input
            type="search"
            aria-label="Search members"
            placeholder="Search by email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {team.isPending && <p role="status">Loading members…</p>}
          {team.isError && <p role="alert">{team.error.message}</p>}
          <ul className="team-members">
            {members.map((member) => (
              <li key={member.id}>
                <span className="team-avatar" aria-hidden="true">
                  {member.email.charAt(0).toUpperCase()}
                </span>
                <div className="team-member-copy">
                  <strong>{member.email}</strong>
                  <small>
                    {member.owner
                      ? "Studio owner"
                      : member.disabled
                        ? "Access revoked"
                        : "Assistant"}
                  </small>
                </div>
                <span className={`team-status ${member.disabled ? "team-status-revoked" : ""}`}>
                  {member.disabled ? "Revoked" : "Active"}
                </span>
                {!member.owner && (
                  <button
                    type="button"
                    className="team-secondary"
                    disabled={busy}
                    onClick={() =>
                      setConfirmation({
                        operation: member.disabled ? "RESTORE" : "REVOKE",
                        target: member.id,
                        email: member.email,
                      })
                    }
                  >
                    {member.disabled ? "Restore access" : "Revoke access"}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {team.isSuccess && members.length === 0 && <p>No members match your search.</p>}
          <div className="team-pending">
            <h2>Invitations</h2>
            <p>A new invitation replaces the previous unused code for that email.</p>
            <ul className="team-members">
              {team.data?.invites.map((item) => (
                <li key={item.id}>
                  <div className="team-member-copy">
                    <strong>{item.email}</strong>
                    <small>
                      {item.state === "ACTIVE"
                        ? `Expires ${new Date(item.expires_at).toLocaleString()}`
                        : item.state.toLowerCase()}
                    </small>
                  </div>
                  <span className="team-status">
                    {item.state === "ACTIVE" ? "Pending" : item.state.toLowerCase()}
                  </span>
                  {item.state === "ACTIVE" && (
                    <button
                      className="team-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setConfirmation({
                          operation: "REVOKE_INVITE",
                          target: item.id,
                          email: item.email,
                        })
                      }
                    >
                      Revoke invitation
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {team.isSuccess && team.data.invites.length === 0 && <p>No pending invitations.</p>}
          </div>
        </section>
      </div>
      <p role="status" aria-live="polite" className="team-message">
        {message}
      </p>
      {confirmation && (
        <Dialog.Root
          open
          onOpenChange={(open) => {
            if (!open && !busy) setConfirmation(null);
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="sheet-overlay" />
            <Dialog.Content className="team-confirm">
              <Dialog.Title>
                {confirmation.operation === "RESTORE" ? "Restore access?" : "Revoke access?"}
              </Dialog.Title>
              <p>{confirmation.email}</p>
              <Dialog.Description>
                {confirmation.operation === "REVOKE"
                  ? "This signs the assistant out and blocks new access. Their saved work is retained."
                  : confirmation.operation === "RESTORE"
                    ? "The assistant can sign in again to their existing private studio."
                    : "The unused code will stop working."}
              </Dialog.Description>
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void mutate(confirmation.operation, confirmation.target)}
                >
                  Confirm {confirmation.operation === "RESTORE" ? "restore" : "revoke"}
                </button>
                <button
                  type="button"
                  className="team-secondary"
                  disabled={busy}
                  onClick={() => setConfirmation(null)}
                >
                  Cancel
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </section>
  );
}
