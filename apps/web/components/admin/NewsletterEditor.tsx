"use client";

// Lightweight rich-text editor for the newsletter composer, built on TipTap
// (@tiptap/react, MIT). Chosen over react-quill because Quill is unmaintained
// and incompatible with React 19; TipTap is actively maintained, MIT-licensed
// (zero-payant rule) and — crucially — emits email-safe HTML: bold→<strong>,
// italic→<em>, underline→<u>, heading→<h2>, lists→<ul>/<ol>, and color / font /
// size as INLINE <span style="…"> (exactly what mail clients accept). Images are
// referenced by their absolute CDN URL (uploaded to our own bucket) so no remote
// third-party image is ever embedded.

import { useCallback, useRef } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  TextStyle,
  Color,
  FontFamily,
  FontSize,
} from "@tiptap/extension-text-style";
import Image from "@tiptap/extension-image";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Heading2,
  Link as LinkIcon,
  Unlink,
  Image as ImageIcon,
  Palette,
} from "lucide-react";
import { uploadNewsletterImage } from "@/lib/adminApi";

// Email-safe font stacks + colors offered in the toolbar.
const FONTS: Array<{ label: string; value: string }> = [
  { label: "Système", value: "" },
  {
    label: "Sans-serif",
    value: "Helvetica, Arial, sans-serif",
  },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "'Courier New', Consolas, monospace" },
];
const SIZES: Array<{ label: string; value: string }> = [
  { label: "Petit", value: "13px" },
  { label: "Normal", value: "16px" },
  { label: "Grand", value: "20px" },
  { label: "Titre", value: "26px" },
];
const COLORS = ["#1A0F0A", "#E05206", "#0DB02B", "#1D4ED8", "#B91C1C", "#8B7355"];

function ToolbarButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm transition ${
        active
          ? "border-[#E05206] bg-[#FFF4EC] text-[#E05206]"
          : "border-[#E8DFD3] bg-white text-[#5A4634] hover:bg-[#FDFBF7]"
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickImage = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-selecting the same file
      if (!file) return;
      try {
        const url = await uploadNewsletterImage(file);
        editor.chain().focus().setImage({ src: url, alt: file.name }).run();
      } catch {
        window.alert("Échec de l'envoi de l'image.");
      }
    },
    [editor],
  );

  const setLink = useCallback(() => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL du lien :", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  }, [editor]);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-[#E8DFD3] bg-[#FDFBF7] px-2 py-2">
      <ToolbarButton
        title="Gras"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={15} />
      </ToolbarButton>
      <ToolbarButton
        title="Italique"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={15} />
      </ToolbarButton>
      <ToolbarButton
        title="Souligné"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon size={15} />
      </ToolbarButton>
      <ToolbarButton
        title="Titre"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
      >
        <Heading2 size={15} />
      </ToolbarButton>
      <ToolbarButton
        title="Liste à puces"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={15} />
      </ToolbarButton>
      <ToolbarButton
        title="Liste numérotée"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={15} />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-[#E8DFD3]" />

      <ToolbarButton
        title="Lien"
        active={editor.isActive("link")}
        onClick={setLink}
      >
        <LinkIcon size={15} />
      </ToolbarButton>
      <ToolbarButton
        title="Retirer le lien"
        onClick={() => editor.chain().focus().unsetLink().run()}
      >
        <Unlink size={15} />
      </ToolbarButton>

      <span className="mx-1 h-5 w-px bg-[#E8DFD3]" />

      {/* Font family */}
      <select
        aria-label="Police"
        onChange={(e) => {
          const v = e.target.value;
          if (v) editor.chain().focus().setFontFamily(v).run();
          else editor.chain().focus().unsetFontFamily().run();
        }}
        className="h-8 rounded-md border border-[#E8DFD3] bg-white px-1.5 text-xs text-[#5A4634]"
        defaultValue=""
      >
        {FONTS.map((f) => (
          <option key={f.label} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      {/* Font size */}
      <select
        aria-label="Taille"
        onChange={(e) => {
          const v = e.target.value;
          if (v) editor.chain().focus().setFontSize(v).run();
        }}
        className="h-8 rounded-md border border-[#E8DFD3] bg-white px-1.5 text-xs text-[#5A4634]"
        defaultValue=""
      >
        <option value="" disabled>
          Taille
        </option>
        {SIZES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      {/* Color swatches */}
      <span className="ml-1 inline-flex items-center gap-1">
        <Palette size={14} className="text-[#8A6B4D]" aria-hidden="true" />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={`Couleur ${c}`}
            aria-label={`Couleur ${c}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setColor(c).run()}
            className="h-5 w-5 rounded-full border border-[#E8DFD3]"
            style={{ background: c }}
          />
        ))}
      </span>

      <span className="mx-1 h-5 w-px bg-[#E8DFD3]" />

      <ToolbarButton title="Insérer une image" onClick={() => fileRef.current?.click()}>
        <ImageIcon size={15} />
      </ToolbarButton>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={onPickImage}
      />
    </div>
  );
}

/**
 * Controlled rich editor. Emits both the email-safe HTML and a derived plain-text
 * part on every change. `value` seeds the initial document only (uncontrolled
 * thereafter — TipTap owns the live document).
 */
export default function NewsletterEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string, text: string) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false, // Next.js SSR: avoid hydration mismatch
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Image.configure({ inline: false, allowBase64: false }),
    ],
    content: value || "<p></p>",
    editorProps: {
      attributes: {
        class:
          "prose-email min-h-[180px] px-4 py-3 outline-none text-[#1A0F0A] text-sm leading-relaxed",
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML(), ed.getText());
    },
  });

  return (
    <div className="rounded-lg border border-[#E8DFD3] bg-white overflow-hidden">
      {editor ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
