"use client";

// Compte officiel NigerConnect — la voix de la plateforme.
//
// Ce compte n'est pas un membre : il n'apparaît ni dans la recherche, ni dans
// les suggestions, ni sur la carte, et personne ne peut lui écrire en premier.
// En échange, c'est le seul qui parle à toute la communauté d'un coup. Chaque
// envoi part vers TOUS les membres joignables : d'où la confirmation explicite
// avant les deux boutons de diffusion.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Bell,
  Image as ImageIcon,
  Inbox,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import {
  AdminApiError,
  broadcastOfficialMessage,
  broadcastOfficialNotification,
  deleteOfficialContent,
  fetchOfficialAccount,
  fetchOfficialBroadcasts,
  fetchOfficialContent,
  fetchOfficialThread,
  fetchOfficialThreads,
  publishOfficialPost,
  publishOfficialStory,
  replyOfficialThread,
  searchAdminUsers,
  sendOfficialDirectMessage,
  updateOfficialAccount,
  uploadOfficialImage,
  type AdminUserSummary,
  type OfficialBroadcast,
  type OfficialOverview,
  type OfficialPost,
  type OfficialStory,
  type OfficialThread,
  type OfficialThreadMessage,
} from "@/lib/adminApi";
import {
  Avatar,
  Card,
  EmptyState,
  ErrorBanner,
  formatDate,
  GhostButton,
  Modal,
  PrimaryButton,
  Skeleton,
  StatCard,
  StatusChip,
} from "./ui";

type Tab = "profil" | "diffuser" | "publier" | "messages" | "historique";

const TABS: { id: Tab; label: string }[] = [
  { id: "profil", label: "Profil & badge" },
  { id: "diffuser", label: "Diffuser" },
  { id: "publier", label: "Publier" },
  { id: "messages", label: "Conversations" },
  { id: "historique", label: "Historique" },
];

function errMsg(e: unknown): string {
  return e instanceof AdminApiError ? e.message : "Erreur. Réessaie.";
}

function peerName(t: OfficialThread): string {
  const p = t.peer;
  if (!p) return "Membre supprimé";
  return p.displayName || [p.firstName, p.lastName].filter(Boolean).join(" ") || "Membre";
}

// ---------------------------------------------------------------------------
// Champ image réutilisable (avatar, photo de publication, image de story)
// ---------------------------------------------------------------------------

function ImagePicker({
  value,
  onChange,
  label,
  ratio = "aspect-video",
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  label: string;
  ratio?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadOfficialImage(file));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="block text-xs font-semibold text-[#5A4634] mb-1.5">{label}</label>
      {value ? (
        <div className="relative">
          {/* Pas de next/image : l'URL vient du CDN/MinIO du déploiement. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            className={`w-full ${ratio} object-cover rounded-lg border border-[#E8DFD3]`}
          />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-2 right-2 rounded-lg bg-white/90 border border-[#E8DFD3] px-2 py-1 text-xs font-semibold text-[#8B1F1F]"
          >
            Retirer
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className={`w-full ${ratio} rounded-lg border border-dashed border-[#E5D5C3] bg-[#FDFBF7] grid place-items-center text-sm text-[#8A6B4D] hover:bg-[#FFF8F3] disabled:opacity-60`}
        >
          <span className="flex items-center gap-2">
            <ImageIcon size={16} aria-hidden="true" />
            {busy ? "Envoi…" : "Choisir une image"}
          </span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {error ? <p className="text-xs text-red-600 mt-1">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation avant un envoi à toute la communauté
// ---------------------------------------------------------------------------

function ConfirmBroadcast({
  title,
  reach,
  onCancel,
  onConfirm,
  pending,
}: {
  title: string;
  reach: number;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Modal onClose={onCancel} labelledBy="confirm-broadcast">
      <Card className="p-5">
        <h3 id="confirm-broadcast" className="font-bold text-[#1A0F0A] text-lg">
          {title}
        </h3>
        <p className="text-sm text-[#5A4634] mt-2">
          L&apos;envoi partira vers <strong>{reach}</strong> membre
          {reach > 1 ? "s" : ""}. Il n&apos;est pas annulable une fois lancé.
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <GhostButton onClick={onCancel} disabled={pending}>
            Annuler
          </GhostButton>
          <PrimaryButton onClick={onConfirm} disabled={pending}>
            {pending ? "Envoi…" : "Envoyer maintenant"}
          </PrimaryButton>
        </div>
      </Card>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Onglet : profil & badge
// ---------------------------------------------------------------------------

function ProfileTab({
  overview,
  onSaved,
}: {
  overview: OfficialOverview;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(overview.account.displayName ?? "");
  const [bio, setBio] = useState(overview.account.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(overview.account.avatarUrl);
  const [coverUrl, setCoverUrl] = useState<string | null>(overview.account.coverUrl);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await updateOfficialAccount({ displayName, bio, avatarUrl, coverUrl });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Membres joignables" value={overview.reach} icon={Users} accent />
        <StatCard label="Publications" value={overview.stats.postsCount} icon={Megaphone} />
        <StatCard label="Stories en ligne" value={overview.stats.storiesCount} icon={ImageIcon} />
        <StatCard
          label="Conversations non lues"
          value={overview.stats.unreadThreads}
          icon={Inbox}
        />
      </div>

      <Card className="p-5">
        <div className="flex items-start gap-4">
          <Avatar src={overview.account.avatarUrl} name={displayName || "NigerConnect"} size={56} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-[#1A0F0A] truncate">
                {displayName || "NigerConnect"}
              </span>
              <BadgeCheck className="w-5 h-5 text-[#1D4ED8]" aria-label="Compte officiel" />
            </div>
            <p className="text-xs text-[#8A6B4D] mt-0.5">
              Compte officiel depuis{" "}
              {overview.account.officialSince
                ? formatDate(overview.account.officialSince)
                : formatDate(overview.account.createdAt)}
            </p>
            <p className="text-sm text-[#5A4634] mt-2">
              Le badge bleu n&apos;est posé que par cette console. Le compte est absent de
              la recherche, des suggestions et de la carte : personne ne peut l&apos;imiter
              ni lui envoyer une demande d&apos;ami.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-[#5A4634] mb-1.5">
            Nom affiché
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={60}
            className="w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] focus:outline-none focus:ring-2 focus:ring-[#E05206]/40"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[#5A4634] mb-1.5">
            Présentation
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={1000}
            className="w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] focus:outline-none focus:ring-2 focus:ring-[#E05206]/40"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ImagePicker
            label="Photo de profil"
            value={avatarUrl}
            onChange={setAvatarUrl}
            ratio="aspect-square"
          />
          <ImagePicker label="Bannière" value={coverUrl} onChange={setCoverUrl} />
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        <div className="flex items-center gap-3">
          <PrimaryButton onClick={() => void save()} disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </PrimaryButton>
          {saved ? <StatusChip tone="green">Enregistré</StatusChip> : null}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet : diffuser (notification / message à tout le monde)
// ---------------------------------------------------------------------------

function BroadcastTab({ reach, onSent }: { reach: number; onSent: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [linkPath, setLinkPath] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<"notification" | "message" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function send() {
    setPending(true);
    setError(null);
    try {
      if (confirm === "notification") {
        await broadcastOfficialNotification({
          title: title.trim(),
          body: body.trim(),
          ...(linkPath.trim() ? { linkPath: linkPath.trim() } : {}),
        });
        setTitle("");
        setBody("");
        setLinkPath("");
        setDone("Notification en cours d'envoi.");
      } else {
        await broadcastOfficialMessage({ content: message.trim() });
        setMessage("");
        setDone("Message en cours d'envoi.");
      }
      setConfirm(null);
      onSent();
    } catch (e) {
      setError(errMsg(e));
      setConfirm(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-[#E05206]" aria-hidden="true" />
          <h3 className="font-bold text-[#1A0F0A]">Notification à toute la communauté</h3>
        </div>
        <p className="text-sm text-[#8A6B4D]">
          Cloche + notification push. Les membres qui ont coupé les annonces dans leurs
          réglages ne la reçoivent pas — {reach} membre{reach > 1 ? "s" : ""} joignable
          {reach > 1 ? "s" : ""} aujourd&apos;hui.
        </p>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre (ex. Nouvelle version disponible)"
          maxLength={140}
          className="w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white focus:outline-none focus:ring-2 focus:ring-[#E05206]/40"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message court affiché sous le titre"
          rows={3}
          maxLength={500}
          className="w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white focus:outline-none focus:ring-2 focus:ring-[#E05206]/40"
        />
        <input
          value={linkPath}
          onChange={(e) => setLinkPath(e.target.value)}
          placeholder="Ouvrir dans l'app (facultatif, ex. /post/<id>)"
          maxLength={200}
          className="w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white focus:outline-none focus:ring-2 focus:ring-[#E05206]/40"
        />
        <PrimaryButton
          onClick={() => setConfirm("notification")}
          disabled={title.trim().length < 3 || body.trim().length === 0}
        >
          <span className="inline-flex items-center gap-1.5">
            <Send size={14} /> Envoyer la notification
          </span>
        </PrimaryButton>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-[#E05206]" aria-hidden="true" />
          <h3 className="font-bold text-[#1A0F0A]">Message direct à toute la communauté</h3>
        </div>
        <p className="text-sm text-[#8A6B4D]">
          Chaque membre reçoit une vraie conversation avec le compte officiel : badge
          non-lu et notification « message reçu ». Il peut répondre — sa réponse arrive
          dans l&apos;onglet Conversations.
        </p>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Votre message…"
          rows={4}
          maxLength={4000}
          className="w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white focus:outline-none focus:ring-2 focus:ring-[#E05206]/40"
        />
        <PrimaryButton
          onClick={() => setConfirm("message")}
          disabled={message.trim().length === 0}
        >
          <span className="inline-flex items-center gap-1.5">
            <Send size={14} /> Envoyer le message
          </span>
        </PrimaryButton>
      </Card>

      {error ? <ErrorBanner message={error} /> : null}
      {done ? <StatusChip tone="green">{done}</StatusChip> : null}

      {confirm ? (
        <ConfirmBroadcast
          title={
            confirm === "notification"
              ? "Envoyer cette notification à tout le monde ?"
              : "Envoyer ce message à tout le monde ?"
          }
          reach={reach}
          pending={pending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void send()}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet : publier (publication + story) et retrait du contenu en ligne
// ---------------------------------------------------------------------------

function PublishTab({ onChanged }: { onChanged: () => void }) {
  const [postContent, setPostContent] = useState("");
  const [postImage, setPostImage] = useState<string | null>(null);
  const [postAnnounce, setPostAnnounce] = useState(false);
  const [storyImage, setStoryImage] = useState<string | null>(null);
  const [storyCaption, setStoryCaption] = useState("");
  const [storyAnnounce, setStoryAnnounce] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<{ posts: OfficialPost[]; stories: OfficialStory[] } | null>(
    null,
  );

  const load = useCallback((signal?: AbortSignal) => {
    fetchOfficialContent(signal)
      .then(setContent)
      .catch((e) => {
        if (!signal?.aborted) setError(errMsg(e));
      });
  }, []);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  async function publishPost() {
    setPending(true);
    setError(null);
    try {
      await publishOfficialPost({
        content: postContent.trim(),
        media: postImage ? [{ mediaUrl: postImage, mediaType: "image" }] : undefined,
        announce: postAnnounce,
      });
      setPostContent("");
      setPostImage(null);
      setPostAnnounce(false);
      load();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  }

  async function publishStory() {
    if (!storyImage) return;
    setPending(true);
    setError(null);
    try {
      await publishOfficialStory({
        content: storyCaption.trim() || undefined,
        media: { mediaUrl: storyImage, mediaType: "image" },
        announce: storyAnnounce,
      });
      setStoryImage(null);
      setStoryCaption("");
      load();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    try {
      await deleteOfficialContent(id);
      load();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="space-y-5">
      {error ? <ErrorBanner message={error} /> : null}

      <Card className="p-5 space-y-3">
        <h3 className="font-bold text-[#1A0F0A]">Publication (visible par tout le monde)</h3>
        <textarea
          value={postContent}
          onChange={(e) => setPostContent(e.target.value)}
          placeholder="Ce que l'équipe veut dire…"
          rows={4}
          maxLength={5000}
          className="w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white focus:outline-none focus:ring-2 focus:ring-[#E05206]/40"
        />
        <ImagePicker label="Image (facultatif)" value={postImage} onChange={setPostImage} />
        <label className="flex items-center gap-2 text-sm text-[#5A4634]">
          <input
            type="checkbox"
            checked={postAnnounce}
            onChange={(e) => setPostAnnounce(e.target.checked)}
          />
          Prévenir tout le monde par notification
        </label>
        <PrimaryButton onClick={() => void publishPost()} disabled={pending || !postContent.trim()}>
          {pending ? "…" : "Publier"}
        </PrimaryButton>
      </Card>

      <Card className="p-5 space-y-3">
        <h3 className="font-bold text-[#1A0F0A]">Story (24 h, en tête de la barre)</h3>
        <ImagePicker label="Image de la story" value={storyImage} onChange={setStoryImage} />
        <input
          value={storyCaption}
          onChange={(e) => setStoryCaption(e.target.value)}
          placeholder="Légende (facultatif)"
          maxLength={500}
          className="w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white focus:outline-none focus:ring-2 focus:ring-[#E05206]/40"
        />
        <label className="flex items-center gap-2 text-sm text-[#5A4634]">
          <input
            type="checkbox"
            checked={storyAnnounce}
            onChange={(e) => setStoryAnnounce(e.target.checked)}
          />
          Prévenir tout le monde par notification
        </label>
        <PrimaryButton onClick={() => void publishStory()} disabled={pending || !storyImage}>
          {pending ? "…" : "Publier la story"}
        </PrimaryButton>
      </Card>

      <div>
        <h3 className="text-sm font-bold text-[#1A0F0A] mb-3">En ligne</h3>
        {!content ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : content.posts.length === 0 && content.stories.length === 0 ? (
          <EmptyState>
            <p className="font-semibold text-[#1A0F0A]">Rien de publié pour l&apos;instant</p>
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {content.stories.map((s) => (
              <Card key={s.id} className="p-3 flex items-center gap-3">
                <StatusChip tone="brand">Story</StatusChip>
                <span className="flex-1 min-w-0 truncate text-sm text-[#1A0F0A]">
                  {s.content || "(sans légende)"}
                </span>
                <span className="text-xs text-[#8A6B4D] shrink-0">
                  expire {s.storyExpiresAt ? formatDate(s.storyExpiresAt) : "—"}
                </span>
                <GhostButton tone="danger" onClick={() => void remove(s.id)}>
                  <Trash2 size={14} />
                </GhostButton>
              </Card>
            ))}
            {content.posts.map((p) => (
              <Card key={p.id} className="p-3 flex items-center gap-3">
                <StatusChip tone="neutral">Publication</StatusChip>
                <span className="flex-1 min-w-0 truncate text-sm text-[#1A0F0A]">
                  {p.content || "(sans texte)"}
                </span>
                <span className="text-xs text-[#8A6B4D] shrink-0">
                  {p.likeCount} ❤ · {p.commentCount} 💬 · {formatDate(p.createdAt)}
                </span>
                <GhostButton tone="danger" onClick={() => void remove(p.id)}>
                  <Trash2 size={14} />
                </GhostButton>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet : conversations (boîte de réception + écrire à un membre)
// ---------------------------------------------------------------------------

function NewConversation({ onSent }: { onSent: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUserSummary[]>([]);
  const [picked, setPicked] = useState<AdminUserSummary | null>(null);
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const c = new AbortController();
    const t = setTimeout(() => {
      searchAdminUsers(query.trim(), 8, c.signal)
        .then((r) => setResults(r.items))
        .catch(() => undefined);
    }, 250);
    return () => {
      c.abort();
      clearTimeout(t);
    };
  }, [query]);

  async function send() {
    if (!picked) return;
    setPending(true);
    setError(null);
    try {
      await sendOfficialDirectMessage({ userId: picked.id, content: content.trim() });
      setContent("");
      setPicked(null);
      setQuery("");
      setSent(true);
      onSent();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="p-5 space-y-3">
      <h3 className="font-bold text-[#1A0F0A]">Écrire à un membre</h3>
      <p className="text-sm text-[#8A6B4D]">
        Le membre reçoit exactement ce qu&apos;il recevrait d&apos;un ami : un message,
        une notification, un badge non-lu — signé du compte officiel.
      </p>
      {picked ? (
        <div className="flex items-center gap-2">
          <Avatar src={picked.avatarUrl} name={picked.displayName ?? picked.email} size={32} />
          <span className="text-sm font-semibold text-[#1A0F0A]">
            {picked.displayName ?? picked.email}
          </span>
          <GhostButton onClick={() => setPicked(null)}>Changer</GhostButton>
        </div>
      ) : (
        <div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A6B4D]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Chercher un membre (nom ou email)…"
              className="w-full pl-10 pr-3 py-2 rounded-lg border border-[#E5D5C3] bg-white focus:outline-none focus:ring-2 focus:ring-[#E05206]/40"
            />
          </div>
          {results.length > 0 ? (
            <div className="mt-2 space-y-1">
              {results.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setPicked(u)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#FDFBF7] text-sm text-[#1A0F0A]"
                >
                  {u.displayName || `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email}
                  <span className="text-[#8A6B4D]"> · {u.email}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Votre message…"
        rows={3}
        maxLength={4000}
        className="w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white focus:outline-none focus:ring-2 focus:ring-[#E05206]/40"
      />
      {error ? <ErrorBanner message={error} /> : null}
      <div className="flex items-center gap-3">
        <PrimaryButton onClick={() => void send()} disabled={pending || !picked || !content.trim()}>
          {pending ? "…" : "Envoyer"}
        </PrimaryButton>
        {sent ? <StatusChip tone="green">Message envoyé</StatusChip> : null}
      </div>
    </Card>
  );
}

function ThreadView({ conversationId, onReplied }: { conversationId: string; onReplied: () => void }) {
  const [messages, setMessages] = useState<OfficialThreadMessage[] | null>(null);
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) => {
      fetchOfficialThread(conversationId, signal)
        .then((r) => setMessages(r.items))
        .catch((e) => {
          if (!signal?.aborted) setError(errMsg(e));
        });
    },
    [conversationId],
  );

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  async function send() {
    setPending(true);
    setError(null);
    try {
      await replyOfficialThread(conversationId, reply.trim());
      setReply("");
      load();
      onReplied();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="p-4 space-y-3">
      {!messages ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : messages.length === 0 ? (
        <EmptyState>
          <p className="text-sm">Conversation vide.</p>
        </EmptyState>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {[...messages].reverse().map((m) => (
            <div key={m.id} className="text-sm">
              <span className="font-semibold text-[#1A0F0A]">
                {m.sender?.displayName ?? m.sender?.firstName ?? "—"}
              </span>
              <span className="text-[#8A6B4D] text-xs"> · {formatDate(m.createdAt)}</span>
              <p className="text-[#5A4634]">
                {m.deletedAt ? <em>message supprimé</em> : m.content ?? "[média]"}
              </p>
            </div>
          ))}
        </div>
      )}
      {error ? <ErrorBanner message={error} /> : null}
      <div className="flex gap-2">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Répondre au nom du compte officiel…"
          maxLength={4000}
          className="flex-1 px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white focus:outline-none focus:ring-2 focus:ring-[#E05206]/40"
        />
        <PrimaryButton onClick={() => void send()} disabled={pending || !reply.trim()}>
          {pending ? "…" : "Répondre"}
        </PrimaryButton>
      </div>
    </Card>
  );
}

function ThreadsTab({ onChanged }: { onChanged: () => void }) {
  const [threads, setThreads] = useState<OfficialThread[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    fetchOfficialThreads(signal)
      .then((r) => setThreads(r.items))
      .catch((e) => {
        if (!signal?.aborted) setError(errMsg(e));
      });
  }, []);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  return (
    <div className="space-y-5">
      <NewConversation
        onSent={() => {
          load();
          onChanged();
        }}
      />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#1A0F0A]">Boîte de réception</h3>
        <GhostButton onClick={() => load()}>
          <RefreshCw className="w-3.5 h-3.5" /> Rafraîchir
        </GhostButton>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => load()} /> : null}

      {!threads ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : threads.length === 0 ? (
        <EmptyState>
          <p className="font-semibold text-[#1A0F0A]">Aucune conversation</p>
          <p className="text-sm mt-1">
            Les réponses des membres à un message officiel arriveront ici.
          </p>
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <div key={t.conversationId} className="space-y-2">
              <Card className="p-3">
                <button
                  type="button"
                  onClick={() =>
                    setOpen((cur) => (cur === t.conversationId ? null : t.conversationId))
                  }
                  className="w-full flex items-center gap-3 text-left"
                >
                  <Avatar src={t.peer?.avatarUrl ?? null} name={peerName(t)} size={36} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-[#1A0F0A] truncate">
                      {peerName(t)}
                    </span>
                    <span className="block text-xs text-[#8A6B4D] truncate">
                      {t.lastMessagePreview ?? "—"}
                    </span>
                  </span>
                  {t.unreadCount > 0 ? (
                    <StatusChip tone="red">{t.unreadCount} non lu</StatusChip>
                  ) : null}
                  <span className="text-xs text-[#8A6B4D] shrink-0">
                    {t.lastMessageAt ? formatDate(t.lastMessageAt) : ""}
                  </span>
                </button>
              </Card>
              {open === t.conversationId ? (
                <ThreadView
                  conversationId={t.conversationId}
                  onReplied={() => {
                    load();
                    onChanged();
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onglet : historique des diffusions
// ---------------------------------------------------------------------------

function HistoryTab() {
  const [rows, setRows] = useState<OfficialBroadcast[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    fetchOfficialBroadcasts(signal)
      .then(setRows)
      .catch((e) => {
        if (!signal?.aborted) setError(errMsg(e));
      });
  }, []);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  if (error) return <ErrorBanner message={error} onRetry={() => load()} />;
  if (!rows) return <Skeleton className="h-32 w-full rounded-xl" />;
  if (rows.length === 0) {
    return (
      <EmptyState>
        <p className="font-semibold text-[#1A0F0A]">Aucune diffusion</p>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <GhostButton onClick={() => load()}>
          <RefreshCw className="w-3.5 h-3.5" /> Rafraîchir
        </GhostButton>
      </div>
      {rows.map((b) => (
        <Card key={b.id} className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusChip tone={b.kind === "message" ? "blue" : "brand"}>
              {b.kind === "message" ? "Message" : "Notification"}
            </StatusChip>
            <span className="font-semibold text-[#1A0F0A] truncate">{b.title}</span>
            <StatusChip
              tone={b.status === "sent" ? "green" : b.status === "failed" ? "red" : "amber"}
            >
              {b.status === "sent" ? "Envoyé" : b.status === "failed" ? "Échec" : "En cours"}
            </StatusChip>
            <span className="text-xs text-[#8A6B4D]">
              {b.sentCount}/{b.totalRecipients} livrés
              {b.failedCount > 0 ? ` · ${b.failedCount} échec(s)` : ""} ·{" "}
              {formatDate(b.createdAt)}
            </span>
          </div>
          <p className="text-sm text-[#5A4634] mt-1 line-clamp-2">{b.body}</p>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function OfficialSection() {
  const [tab, setTab] = useState<Tab>("profil");
  const [overview, setOverview] = useState<OfficialOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    fetchOfficialAccount(signal)
      .then(setOverview)
      .catch((e) => {
        if (!signal?.aborted) setError(errMsg(e));
      });
  }, []);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  return (
    <section>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-bold text-[#1A0F0A]">Compte officiel</h2>
          <p className="text-sm text-[#8A6B4D] mt-0.5">
            La voix de NigerConnect : notification, message, story et publication à toute
            la communauté.
          </p>
        </div>
        <StatusChip tone="blue" icon={BadgeCheck}>
          Badge officiel
        </StatusChip>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.id
                ? "bg-[#E05206] text-white"
                : "border border-[#E8DFD3] text-[#5A4634] hover:bg-[#FDFBF7]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => load()} /> : null}

      {!overview ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : tab === "profil" ? (
        <ProfileTab overview={overview} onSaved={() => load()} />
      ) : tab === "diffuser" ? (
        <BroadcastTab reach={overview.reach} onSent={() => load()} />
      ) : tab === "publier" ? (
        <PublishTab onChanged={() => load()} />
      ) : tab === "messages" ? (
        <ThreadsTab onChanged={() => load()} />
      ) : (
        <HistoryTab />
      )}
    </section>
  );
}
