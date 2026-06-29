// Mentions are stored inline in content as `@[Display Name](uuid)`. These helpers
// parse that token format for rendering and serialize a composed message back
// into it. Kept in sync with the server-side regex in apps/api/src/feed/mentions.service.ts.

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export const MENTION_TOKEN_RE = new RegExp(`@\\[([^\\]\\n]{1,80})\\]\\((${UUID})\\)`, 'g');

export type MentionPart =
  | { type: 'text'; text: string }
  | { type: 'mention'; text: string; userId: string };

/** Split content into plain-text and mention parts for rich rendering. */
export function parseMentions(content: string): MentionPart[] {
  const parts: MentionPart[] = [];
  const re = new RegExp(MENTION_TOKEN_RE);
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push({ type: 'text', text: content.slice(last, m.index) });
    parts.push({ type: 'mention', text: `@${m[1]}`, userId: m[2]!.toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push({ type: 'text', text: content.slice(last) });
  return parts;
}

/** True if the content contains at least one mention token. */
export function hasMentions(content: string): boolean {
  return new RegExp(MENTION_TOKEN_RE).test(content);
}

/**
 * Turn the human display text + the picked mentions into the stored token form.
 * Replaces each "@Display Name" literal with `@[Display Name](uuid)`. Longest
 * names first so a name that is a prefix of another doesn't get half-matched.
 * A mention the user deleted from the text is simply dropped (its `@name` is
 * gone, so nothing to replace).
 */
export function serializeMentions(
  text: string,
  mentions: Array<{ display: string; userId: string }>,
): string {
  let out = text;
  const sorted = [...mentions].sort((a, b) => b.display.length - a.display.length);
  for (const m of sorted) {
    const needle = `@${m.display}`;
    const idx = out.indexOf(needle);
    if (idx === -1) continue; // user removed it
    out = out.slice(0, idx) + `@[${m.display}](${m.userId})` + out.slice(idx + needle.length);
  }
  return out;
}
