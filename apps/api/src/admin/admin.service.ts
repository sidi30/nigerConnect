import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../common/config/env.validation';
import { PrismaService } from '../common/prisma/prisma.service';
import { S3Service } from '../common/storage/s3.service';

export interface AdminMetrics {
  users: { total: number; emailVerified: number; identityApproved: number; signups24h: number; signups7d: number };
  identity: { pending: number; approved: number; rejected: number };
  content: { posts: number; messages24h: number; comments: number };
  moderation: { reportsPending: number };
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly privateBucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    config: ConfigService<Env, true>,
  ) {
    this.privateBucket = config.get('S3_PRIVATE_BUCKET', { infer: true });
  }

  /** Aggregate counters for the admin dashboard home. Cheap COUNT queries. */
  async metrics(): Promise<AdminMetrics> {
    const now = Date.now();
    const since24h = new Date(now - 24 * 3_600_000);
    const since7d = new Date(now - 7 * 24 * 3_600_000);

    const [
      usersTotal,
      emailVerified,
      identityApproved,
      identityPending,
      identityRejected,
      signups24h,
      signups7d,
      posts,
      messages24h,
      comments,
      reportsPending,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { emailVerified: true } }),
      this.prisma.user.count({ where: { identityStatus: 'approved' } }),
      this.prisma.user.count({ where: { identityStatus: 'pending' } }),
      this.prisma.user.count({ where: { identityStatus: 'rejected' } }),
      this.prisma.user.count({ where: { createdAt: { gte: since24h } } }),
      this.prisma.user.count({ where: { createdAt: { gte: since7d } } }),
      this.prisma.post.count({ where: { deletedAt: null } }),
      this.prisma.message.count({ where: { createdAt: { gte: since24h }, deletedAt: null } }),
      this.prisma.comment.count({ where: { deletedAt: null } }),
      this.prisma.report.count({ where: { status: 'pending' } }),
    ]);

    return {
      users: { total: usersTotal, emailVerified, identityApproved, signups24h, signups7d },
      identity: { pending: identityPending, approved: identityApproved, rejected: identityRejected },
      content: { posts, messages24h, comments },
      moderation: { reportsPending },
    };
  }

  /**
   * Identity review queue. Returns pending (or filtered) documents with the
   * submitter summary and a SHORT-lived presigned GET so the reviewer can view
   * the scan without the private bucket ever being public. URLs are never
   * persisted or logged.
   */
  async listIdentityDocuments(status: 'pending' | 'approved' | 'rejected', limit: number, cursor?: string) {
    const docs = await this.prisma.identityDocument.findMany({
      where: { status },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'asc' }, // oldest first — FIFO review queue
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            city: true,
            countryCode: true,
            identityStatus: true,
            createdAt: true,
          },
        },
      },
    });
    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;

    const items = await Promise.all(
      page.map(async (d) => ({
        id: d.id,
        userId: d.userId,
        documentType: d.documentType,
        status: d.status,
        createdAt: d.createdAt,
        rejectionReason: d.rejectionReason,
        viewUrl: await this.presignDoc(d.fileUrl),
        user: d.user,
      })),
    );
    return { items, nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  /** Turn an `s3://<privateBucket>/<key>` pointer into a short presigned GET. */
  private async presignDoc(fileUrl: string): Promise<string | null> {
    const prefix = `s3://${this.privateBucket}/`;
    if (!fileUrl.startsWith(prefix)) return null;
    const key = fileUrl.slice(prefix.length).split(/[?#]/)[0];
    if (!key) return null;
    try {
      return await this.s3.createPresignedDownload(key, 300);
    } catch (err) {
      this.logger.warn(`Failed to presign identity doc: ${String(err)}`);
      return null;
    }
  }
}
