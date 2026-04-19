import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PostsService } from './posts.service';

const INTERVAL_MS = 60 * 60 * 1000; // hourly

@Injectable()
export class StoriesCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StoriesCron.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly posts: PostsService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      const deleted = await this.posts.deleteExpiredStories();
      if (deleted > 0) this.logger.log(`Soft-deleted ${deleted} expired stories`);
    } catch (error) {
      this.logger.error('Failed to clean expired stories', error as Error);
    }
  }
}
