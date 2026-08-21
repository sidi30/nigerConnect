"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  listMyAssociations,
  listMembers,
  listPendingRequests,
  listOfficers,
  approveRequest,
  rejectRequest,
  changeRole,
  designateOfficer,
  removeOfficer,
  isOfficer,
  personName,
  roleLabelOf,
  officerTitleLabel,
  ASSIGNABLE_ROLES,
  OFFICER_TITLES,
  AssoApiError,
  type MyAssociation,
  type AssociationMember,
  type AssociationOfficer,
  type AssignableRole,
  type OfficerTitle,
  type MemberUser,
} from "@/lib/assoApi";

type Tab = "requests" | "members" | "board";

// B4 — tenir le registre depuis un ordinateur.
//
// Trois surfaces gardées séparées, parce qu'elles répondent à trois questions
// différentes : qui demande à entrer, qui est déjà là, et qui parle au nom de
// l'association. Ce sont aussi trois ressources distinctes côté API.
//
// Tout est autorisé côté serveur. L'écran ne refuse de lui-même que ce qui ne
// peut pas marcher (voir la ligne `owner`) : quand l'API dit non — dernier
// administrateur, poste déjà proposé, membre non approuvé — on affiche SA
// réponse telle quelle plutôt que de deviner une règle qui finirait par
// diverger de la sienne.
export default function MembersManager({ associationId }: { associationId: string }) {
  const [association, setAssociation] = useState<MyAssociation | null>(null);
  const [access, setAccess] = useState<"loading" | "granted" | "denied" | "error">("loading");
  const [tab, setTab] = useState<Tab>("requests");

  const [requests, setRequests] = useState<AssociationMember[]>([]);
  const [requestsCursor, setRequestsCursor] = useState<string | null>(null);
  const [members, setMembers] = useState<AssociationMember[]>([]);
  const [membersCursor, setMembersCursor] = useState<string | null>(null);
  const [board, setBoard] = useState<AssociationOfficer[]>([]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const report = useCallback((err: unknown) => {
    setError(err instanceof AssoApiError ? err.message : "Action impossible.");
    setNotice(null);
  }, []);

  // Contrôle d'accès + premier chargement. `/associations/mine` est la seule
  // source de rôle dont dispose le navigateur : ce qui n'y figure pas n'est pas
  // administrable.
  useEffect(() => {
    const controller = new AbortController();
    listMyAssociations(controller.signal)
      .then(async (mine) => {
        const found = mine.find((a) => a.id === associationId);
        if (!found || !isOfficer(found.role)) {
          setAccess("denied");
          return;
        }
        setAssociation(found);
        setAccess("granted");
        const [pending, approved, officers] = await Promise.all([
          listPendingRequests(associationId, {}, controller.signal),
          listMembers(associationId, {}, controller.signal),
          listOfficers(associationId, controller.signal),
        ]);
        setRequests(pending.items);
        setRequestsCursor(pending.nextCursor);
        setMembers(approved.items);
        setMembersCursor(approved.nextCursor);
        setBoard(officers);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof AssoApiError ? err.message : "Chargement impossible.");
        setAccess((prev) => (prev === "granted" ? prev : "error"));
      });
    return () => controller.abort();
  }, [associationId]);

  async function reloadRequests() {
    const page = await listPendingRequests(associationId);
    setRequests(page.items);
    setRequestsCursor(page.nextCursor);
  }

  async function reloadMembers() {
    const page = await listMembers(associationId);
    setMembers(page.items);
    setMembersCursor(page.nextCursor);
  }

  async function onApprove(member: AssociationMember) {
    setBusy(member.userId);
    setError(null);
    try {
      await approveRequest(associationId, member.userId);
      setNotice(personName(member.user) + " a rejoint l'association.");
      await Promise.all([reloadRequests(), reloadMembers()]);
    } catch (err) {
      report(err);
    } finally {
      setBusy(null);
    }
  }

  async function onReject(member: AssociationMember, reason: string) {
    setBusy(member.userId);
    setError(null);
    try {
      await rejectRequest(associationId, member.userId, reason.trim() || undefined);
      setNotice("Demande de " + personName(member.user) + " refusée.");
      await reloadRequests();
    } catch (err) {
      report(err);
    } finally {
      setBusy(null);
    }
  }

  async function onChangeRole(member: AssociationMember, role: AssignableRole) {
    setBusy(member.userId);
    setError(null);
    try {
      await changeRole(associationId, member.userId, role);
      setNotice(personName(member.user) + " est maintenant " + roleLabelOf(role).toLowerCase() + ".");
      await reloadMembers();
    } catch (err) {
      report(err);
    } finally {
      setBusy(null);
    }
  }

  async function onDesignate(userId: string, title: OfficerTitle, customTitle: string) {
    setBusy(userId);
    setError(null);
    try {
      await designateOfficer(associationId, {
        userId,
        title,
        ...(title === "other" ? { customTitle: customTitle.trim() } : {}),
      });
      // Le poste est PROPOSÉ, pas pris : listOfficers ne rend que les sièges
      // acceptés. Le dire ici évite le rapport « j'ai désigné quelqu'un et il
      // ne se passe rien ».
      setNotice("Proposition envoyée. Le poste apparaîtra ici une fois qu'elle sera acceptée.");
    } catch (err) {
      report(err);
    } finally {
      setBusy(null);
    }
  }

  async function onRemoveOfficer(officer: AssociationOfficer) {
    setBusy(officer.userId);
    setError(null);
    try {
      await removeOfficer(associationId, officer.userId);
      setNotice(personName(officer.user) + " ne siège plus au bureau.");
      setBoard(await listOfficers(associationId));
    } catch (err) {
      report(err);
    } finally {
      setBusy(null);
    }
  }

  if (access === "loading") return <Centered>Chargement…</Centered>;
  if (access === "error") return <Centered>{error ?? "Chargement impossible."}</Centered>;
  if (access === "denied" || !association) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-white border border-[#E8DFD3] rounded-2xl p-8 text-center">
          <p className="font-semibold">Cette association n&apos;est pas administrable par toi</p>
          <Link
            href="/asso"
            className="inline-block mt-6 text-[#E05206] font-semibold hover:underline"
          >
            Revenir à mes associations
          </Link>
        </div>
      </main>
    );
  }

  const boardUserIds = new Set(board.map((o) => o.userId));
  const designatable = members.filter((m) => !boardUserIds.has(m.userId));

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <Link href={"/asso/" + associationId} className="text-sm text-[#5A4634] hover:underline">
        ← {association.name}
      </Link>
      <h1 className="text-2xl font-bold mt-3 mb-6">Membres</h1>

      <nav className="flex gap-2 mb-6 border-b border-[#E8DFD3]">
        <TabButton active={tab === "requests"} onClick={() => setTab("requests")}>
          {requests.length > 0 ? "Demandes (" + requests.length + ")" : "Demandes"}
        </TabButton>
        <TabButton active={tab === "members"} onClick={() => setTab("members")}>
          Membres
        </TabButton>
        <TabButton active={tab === "board"} onClick={() => setTab("board")}>
          Bureau
        </TabButton>
      </nav>

      {error ? <Banner tone="error" message={error} /> : null}
      {notice ? <Banner tone="ok" message={notice} /> : null}

      {tab === "requests" ? (
        <RequestList
          requests={requests}
          busy={busy}
          onApprove={onApprove}
          onReject={onReject}
          hasMore={requestsCursor !== null}
          onLoadMore={async () => {
            const page = await listPendingRequests(associationId, { cursor: requestsCursor });
            setRequests((prev) => [...prev, ...page.items]);
            setRequestsCursor(page.nextCursor);
          }}
        />
      ) : null}

      {tab === "members" ? (
        <MemberList
          members={members}
          busy={busy}
          onChangeRole={onChangeRole}
          hasMore={membersCursor !== null}
          onLoadMore={async () => {
            const page = await listMembers(associationId, { cursor: membersCursor });
            setMembers((prev) => [...prev, ...page.items]);
            setMembersCursor(page.nextCursor);
          }}
        />
      ) : null}

      {tab === "board" ? (
        <BoardPanel
          board={board}
          designatable={designatable}
          busy={busy}
          onDesignate={onDesignate}
          onRemove={onRemoveOfficer}
        />
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------

function RequestList({
  requests,
  busy,
  onApprove,
  onReject,
  hasMore,
  onLoadMore,
}: {
  requests: AssociationMember[];
  busy: string | null;
  onApprove: (m: AssociationMember) => void;
  onReject: (m: AssociationMember, reason: string) => void;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  if (requests.length === 0) {
    return <Empty>Aucune demande en attente.</Empty>;
  }

  return (
    <>
      <ul className="space-y-3">
        {requests.map((m) => (
          <li key={m.userId} className="bg-white border border-[#E8DFD3] rounded-2xl p-4">
            <div className="flex items-center gap-4">
              <Avatar user={m.user} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold truncate">{personName(m.user)}</p>
                <p className="text-sm text-[#5A4634]">
                  Demande du {formatDate(m.joinedAt)}
                  {m.user.city ? " · " + m.user.city : ""}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => onApprove(m)}
                  disabled={busy === m.userId}
                  className="bg-[#E05206] hover:bg-[#C8470A] disabled:bg-[#E8DFD3] disabled:text-[#A89882] text-white text-sm font-semibold px-4 py-2 rounded-lg"
                >
                  Accepter
                </button>
                <button
                  onClick={() => {
                    setRejecting(rejecting === m.userId ? null : m.userId);
                    setReason("");
                  }}
                  disabled={busy === m.userId}
                  className="text-sm font-semibold px-4 py-2 rounded-lg border border-[#E8DFD3] text-[#5A4634] hover:border-[#5A4634]"
                >
                  Refuser
                </button>
              </div>
            </div>

            {rejecting === m.userId ? (
              <div className="mt-4 pt-4 border-t border-[#E8DFD3]">
                <label htmlFor={"reason-" + m.userId} className="block text-sm font-semibold mb-1">
                  Motif (facultatif, transmis à la personne)
                </label>
                <input
                  id={"reason-" + m.userId}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  className="w-full border border-[#E8DFD3] rounded-lg px-4 py-2 mb-3 focus:outline-none focus:border-[#E05206]"
                />
                <button
                  onClick={() => {
                    onReject(m, reason);
                    setRejecting(null);
                  }}
                  disabled={busy === m.userId}
                  className="text-sm font-semibold px-4 py-2 rounded-lg border border-[#F5C2C2] text-[#8B1F1F] hover:bg-[#FCE8E8]"
                >
                  Confirmer le refus
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {hasMore ? <LoadMore onClick={onLoadMore} /> : null}
    </>
  );
}

function MemberList({
  members,
  busy,
  onChangeRole,
  hasMore,
  onLoadMore,
}: {
  members: AssociationMember[];
  busy: string | null;
  onChangeRole: (m: AssociationMember, role: AssignableRole) => void;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  if (members.length === 0) return <Empty>Aucun membre pour l&apos;instant.</Empty>;

  return (
    <>
      <ul className="space-y-3">
        {members.map((m) => (
          <li
            key={m.userId}
            className="bg-white border border-[#E8DFD3] rounded-2xl p-4 flex items-center gap-4"
          >
            <Avatar user={m.user} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate">{personName(m.user)}</p>
              <p className="text-sm text-[#5A4634]">Membre depuis le {formatDate(m.joinedAt)}</p>
            </div>
            {m.role === "owner" ? (
              // Le siège non rétrogradable (A3). Il ne bouge que par le
              // transfert de responsabilité, donc offrir un menu ici serait un
              // contrôle qui échoue à tous les coups.
              <span
                className="text-sm text-[#5A4634] shrink-0"
                title="Le responsable principal ne peut pas être rétrogradé"
              >
                Responsable principal
              </span>
            ) : (
              <select
                value={m.role}
                disabled={busy === m.userId}
                onChange={(e) => onChangeRole(m, e.target.value as AssignableRole)}
                className="border border-[#E8DFD3] rounded-lg px-3 py-2 text-sm bg-white shrink-0 focus:outline-none focus:border-[#E05206]"
                aria-label={"Rôle de " + personName(m.user)}
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabelOf(r)}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
      {hasMore ? <LoadMore onClick={onLoadMore} /> : null}
    </>
  );
}

function BoardPanel({
  board,
  designatable,
  busy,
  onDesignate,
  onRemove,
}: {
  board: AssociationOfficer[];
  designatable: AssociationMember[];
  busy: string | null;
  onDesignate: (userId: string, title: OfficerTitle, customTitle: string) => void;
  onRemove: (o: AssociationOfficer) => void;
}) {
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState<OfficerTitle>("president");
  const [customTitle, setCustomTitle] = useState("");

  const canSubmit =
    userId !== "" && (title !== "other" || customTitle.trim().length > 0) && busy === null;

  return (
    <>
      {board.length === 0 ? (
        <Empty>Le bureau n&apos;est pas encore constitué.</Empty>
      ) : (
        <ul className="space-y-3">
          {board.map((o) => (
            <li
              key={o.id}
              className="bg-white border border-[#E8DFD3] rounded-2xl p-4 flex items-center gap-4"
            >
              <Avatar user={o.user} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold truncate">{personName(o.user)}</p>
                <p className="text-sm text-[#5A4634]">{officerTitleLabel(o)}</p>
              </div>
              <button
                onClick={() => onRemove(o)}
                disabled={busy === o.userId}
                className="text-sm font-semibold px-4 py-2 rounded-lg border border-[#E8DFD3] text-[#5A4634] hover:border-[#8B1F1F] hover:text-[#8B1F1F] shrink-0"
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8 bg-white border border-[#E8DFD3] rounded-2xl p-5">
        <h2 className="font-semibold">Proposer un poste</h2>
        <p className="text-sm text-[#5A4634] mt-1 mb-4">
          La personne devra accepter : un poste au bureau est nominatif et public, il ne
          s&apos;impose pas.
        </p>

        <label htmlFor="officer-member" className="block text-sm font-semibold mb-1">
          Membre
        </label>
        <select
          id="officer-member"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="w-full border border-[#E8DFD3] rounded-lg px-4 py-3 mb-4 bg-white focus:outline-none focus:border-[#E05206]"
        >
          <option value="">Choisir un membre…</option>
          {designatable.map((m) => (
            <option key={m.userId} value={m.userId}>
              {personName(m.user)}
            </option>
          ))}
        </select>

        <label htmlFor="officer-title" className="block text-sm font-semibold mb-1">
          Poste
        </label>
        <select
          id="officer-title"
          value={title}
          onChange={(e) => setTitle(e.target.value as OfficerTitle)}
          className="w-full border border-[#E8DFD3] rounded-lg px-4 py-3 mb-4 bg-white focus:outline-none focus:border-[#E05206]"
        >
          {OFFICER_TITLES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        {title === "other" ? (
          <>
            <label htmlFor="officer-custom" className="block text-sm font-semibold mb-1">
              Intitulé
            </label>
            <input
              id="officer-custom"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              maxLength={100}
              placeholder="Chargé des relations avec le pays"
              className="w-full border border-[#E8DFD3] rounded-lg px-4 py-3 mb-4 focus:outline-none focus:border-[#E05206]"
            />
          </>
        ) : null}

        <button
          onClick={() => onDesignate(userId, title, customTitle)}
          disabled={!canSubmit}
          className="bg-[#E05206] hover:bg-[#C8470A] disabled:bg-[#E8DFD3] disabled:text-[#A89882] disabled:cursor-not-allowed text-white font-semibold px-5 py-3 rounded-lg"
        >
          Proposer le poste
        </button>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={
        "px-4 py-2 text-sm font-semibold border-b-2 -mb-px " +
        (active
          ? "border-[#E05206] text-[#E05206]"
          : "border-transparent text-[#5A4634] hover:text-[#1A0F0A]")
      }
    >
      {children}
    </button>
  );
}

function Banner({ tone, message }: { tone: "error" | "ok"; message: string }) {
  const cls =
    tone === "error"
      ? "bg-[#FCE8E8] border-[#F5C2C2] text-[#8B1F1F]"
      : "bg-[#EAF5E9] border-[#C3E0C0] text-[#2C5C2A]";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={"border rounded-lg px-4 py-3 mb-4 text-sm " + cls}
    >
      {message}
    </div>
  );
}

function Avatar({ user }: { user: MemberUser }) {
  if (user.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- remote CDN host, no loader configured
    return (
      <img
        src={user.avatarUrl}
        alt=""
        className="w-11 h-11 rounded-full object-cover bg-[#E8DFD3] shrink-0"
      />
    );
  }
  return (
    <span className="w-11 h-11 rounded-full bg-[#E8DFD3] text-[#5A4634] font-bold flex items-center justify-center shrink-0">
      {personName(user).slice(0, 1).toUpperCase()}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E8DFD3] rounded-2xl p-8 text-center text-sm text-[#5A4634]">
      {children}
    </div>
  );
}

function LoadMore({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full mt-4 border border-[#E8DFD3] rounded-lg py-3 text-sm font-semibold text-[#5A4634] hover:border-[#5A4634]"
    >
      Charger plus
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[60vh] flex items-center justify-center">
      <p className="text-[#5A4634] text-sm">{children}</p>
    </main>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
