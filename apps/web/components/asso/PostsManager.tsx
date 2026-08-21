"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  listMyAssociations,
  listAssociationPosts,
  createAssociationPost,
  deletePost,
  presignAssociationMedia,
  uploadToSignedUrl,
  getUserId,
  isOfficer,
  personName,
  AssoApiError,
  MAX_IMAGE_BYTES,
  UPLOADABLE_IMAGE_TYPES,
  type MyAssociation,
  type AssociationPost,
  type PostMedia,
  type UploadableImageType,
} from "@/lib/assoApi";

// B3 — écrire au nom de l'association depuis un vrai clavier.
//
// Le fichier ne transite jamais par l'API : elle signe un PUT vers son propre
// espace de stockage (ADR-002, `associations/{id}/`), le navigateur y dépose
// les octets, puis l'API vérifie à l'attache que l'objet existe, qu'il est bien
// une image et qu'il est bien dans l'espace annoncé.
//
// Publier est réservé aux dirigeants (décision proprio du 2026-08-21). L'écran
// n'est atteignable que par eux, et l'API refuse de toute façon.
export default function PostsManager({ associationId }: { associationId: string }) {
  const [association, setAssociation] = useState<MyAssociation | null>(null);
  const [access, setAccess] = useState<"loading" | "granted" | "denied" | "error">("loading");
  const [posts, setPosts] = useState<AssociationPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const me = getUserId();

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
        const page = await listAssociationPosts(associationId, {}, controller.signal);
        setPosts(page.items);
        setCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof AssoApiError ? err.message : "Chargement impossible.");
        setAccess((prev) => (prev === "granted" ? prev : "error"));
      });
    return () => controller.abort();
  }, [associationId]);

  function addFiles(selected: FileList | null) {
    if (!selected) return;
    const accepted: File[] = [];
    for (const file of Array.from(selected)) {
      if (!UPLOADABLE_IMAGE_TYPES.includes(file.type as UploadableImageType)) {
        setError(`« ${file.name} » n'est pas une image acceptée (JPEG, PNG, WebP, HEIC).`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`« ${file.name} » dépasse 15 Mo.`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length > 0) {
      setFiles((prev) => [...prev, ...accepted].slice(0, 10));
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onPublish() {
    if (content.trim().length === 0 && files.length === 0) return;
    setPublishing(true);
    setError(null);
    setNotice(null);
    try {
      const media: PostMedia[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]!;
        setProgress(`Envoi de l'image ${i + 1} sur ${files.length}…`);
        const presigned = await presignAssociationMedia(
          associationId,
          file.type as UploadableImageType,
        );
        const url = await uploadToSignedUrl(presigned, file);
        media.push({ mediaUrl: url, mediaType: "image", sortOrder: i });
      }
      setProgress("Publication…");
      await createAssociationPost(associationId, {
        content: content.trim() || undefined,
        media: media.length > 0 ? media : undefined,
      });
      setContent("");
      setFiles([]);
      setNotice("Publié. Les membres le verront dans leur fil.");
      const page = await listAssociationPosts(associationId);
      setPosts(page.items);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof AssoApiError ? err.message : "Publication impossible.");
    } finally {
      setPublishing(false);
      setProgress(null);
    }
  }

  async function onDelete(post: AssociationPost) {
    setError(null);
    try {
      await deletePost(post.id);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      setNotice("Publication supprimée.");
    } catch (err) {
      setError(err instanceof AssoApiError ? err.message : "Suppression impossible.");
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

  const canPublish = (content.trim().length > 0 || files.length > 0) && !publishing;

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <Link href={"/asso/" + associationId} className="text-sm text-[#5A4634] hover:underline">
        ← {association.name}
      </Link>
      <h1 className="text-2xl font-bold mt-3 mb-6">Publications</h1>

      {error ? <Banner tone="error" message={error} /> : null}
      {notice ? <Banner tone="ok" message={notice} /> : null}

      <section className="bg-white border border-[#E8DFD3] rounded-2xl p-5 mb-8">
        <label htmlFor="post-content" className="block text-sm font-semibold mb-1">
          Écrire au nom de {association.name}
        </label>
        <textarea
          id="post-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={5000}
          rows={5}
          placeholder="Assemblée générale samedi à 15 h, salle des fêtes…"
          className="w-full border border-[#E8DFD3] rounded-lg px-4 py-3 focus:outline-none focus:border-[#E05206] resize-y"
        />
        <p className="text-xs text-[#5A4634] mt-1 mb-4">{content.length} / 5000</p>

        {files.length > 0 ? (
          <ul className="flex flex-wrap gap-3 mb-4">
            {files.map((file, i) => (
              <li
                key={file.name + i}
                className="flex items-center gap-2 bg-[#F7F2EA] border border-[#E8DFD3] rounded-lg px-3 py-2 text-sm"
              >
                <span className="max-w-[14rem] truncate">{file.name}</span>
                <span className="text-[#5A4634]">{formatBytes(file.size)}</span>
                <button
                  onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={publishing}
                  aria-label={"Retirer " + file.name}
                  className="text-[#8B1F1F] font-bold px-1"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileInput}
            id="post-images"
            type="file"
            accept={UPLOADABLE_IMAGE_TYPES.join(",")}
            multiple
            onChange={(e) => addFiles(e.target.files)}
            disabled={publishing || files.length >= 10}
            className="hidden"
          />
          <label
            htmlFor="post-images"
            className="cursor-pointer text-sm font-semibold px-4 py-2 rounded-lg border border-[#E8DFD3] text-[#5A4634] hover:border-[#5A4634]"
          >
            Ajouter des images
          </label>
          <button
            onClick={onPublish}
            disabled={!canPublish}
            className="bg-[#E05206] hover:bg-[#C8470A] disabled:bg-[#E8DFD3] disabled:text-[#A89882] disabled:cursor-not-allowed text-white font-semibold px-5 py-2 rounded-lg"
          >
            {publishing ? "Envoi…" : "Publier"}
          </button>
          {progress ? <span className="text-sm text-[#5A4634]">{progress}</span> : null}
        </div>
        <p className="text-xs text-[#5A4634] mt-4">
          10 images au maximum, 15 Mo chacune. La publication atteint le fil de tous les
          membres approuvés.
        </p>
      </section>

      {posts.length === 0 ? (
        <Empty>Aucune publication pour l&apos;instant.</Empty>
      ) : (
        <ul className="space-y-4">
          {posts.map((post) => (
            <li key={post.id} className="bg-white border border-[#E8DFD3] rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm text-[#5A4634]">
                    {post.author ? personName(post.author) : "Un dirigeant"} ·{" "}
                    {formatDateTime(post.createdAt)}
                  </p>
                  {post.content ? (
                    <p className="mt-2 whitespace-pre-wrap break-words">{post.content}</p>
                  ) : null}
                </div>
                {me && post.author?.id === me ? (
                  <button
                    onClick={() => onDelete(post)}
                    className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-[#E8DFD3] text-[#5A4634] hover:border-[#8B1F1F] hover:text-[#8B1F1F] shrink-0"
                  >
                    Supprimer
                  </button>
                ) : null}
              </div>

              {post.media && post.media.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  {post.media.map((m, i) => (
                    // eslint-disable-next-line @next/next/no-img-element -- remote CDN host, no loader configured
                    <img
                      key={m.id ?? m.mediaUrl + i}
                      src={m.thumbnailUrl ?? m.mediaUrl}
                      alt=""
                      className="w-32 h-32 object-cover rounded-lg bg-[#E8DFD3]"
                    />
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <button
          onClick={async () => {
            const page = await listAssociationPosts(associationId, { cursor });
            setPosts((prev) => [...prev, ...page.items]);
            setCursor(page.nextCursor);
          }}
          className="w-full mt-4 border border-[#E8DFD3] rounded-lg py-3 text-sm font-semibold text-[#5A4634] hover:border-[#5A4634]"
        >
          Charger plus
        </button>
      ) : null}
    </main>
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

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#E8DFD3] rounded-2xl p-8 text-center text-sm text-[#5A4634]">
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[60vh] flex items-center justify-center">
      <p className="text-[#5A4634] text-sm">{children}</p>
    </main>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " Ko";
  return (bytes / (1024 * 1024)).toFixed(1) + " Mo";
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}
