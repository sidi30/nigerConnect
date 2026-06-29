import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

// Mentions are stored inline in the content as `@[Display Name](uuid)`. We only
// ever trust the uuid; the display name is cosmetic (re-derived on render).
const MENTION_RE = /@\[[^\]\n]{1,80}\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;
// Cap fan-out: a single post/comment can't ping more than this many people.
const MAX_MENTIONS = 20;

/** Extract the unique mentioned user ids from a content string. */
export function extractMentionIds(content: string | null | undefined): string[] {
  if (!content) return [];
  const ids = new Set<string>();
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_RE.exec(content)) !== null) {
    ids.add(m[1]!.toLowerCase());
    if (ids.size >= MAX_MENTIONS) break;
  }
  return [...ids];
}

@Injectable()
export class MentionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Notify the people mentioned in `content` — but ONLY those who are accepted
   * friends of the author (you can't ping strangers). Self-mentions are ignored.
   * Fire-and-forget per recipient so one failure doesn't block the others.
   */
  async notify(params: {
    authorId: string;
    authorName: string;
    content: string | null | undefined;
    preview: string;
    data: Prisma.InputJsonObject;
  }): Promise<void> {
    const ids = extractMentionIds(params.content).filter((id) => id !== params.authorId);
    if (ids.length === 0) return;

    // Keep only the ids that are accepted friends of the author.
    const friendships = await this.prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: params.authorId, addresseeId: { in: ids } },
          { addresseeId: params.authorId, requesterId: { in: ids } },
        ],
      },
      select: { requesterId: true, addresseeId: true },
    });
    const friendIds = friendships.map((f) =>
      f.requesterId === params.authorId ? f.addresseeId : f.requesterId,
    );
    if (friendIds.length === 0) return;

    await Promise.all(
      friendIds.map((uid) =>
        this.notifications
          .create({
            userId: uid,
            actorId: params.authorId,
            type: 'mention',
            title: `${params.authorName} vous a mentionné`,
            body: params.preview,
            data: params.data,
          })
          .catch(() => null),
      ),
    );
  }
}
