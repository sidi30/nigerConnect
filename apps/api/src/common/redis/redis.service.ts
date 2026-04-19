import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.validation';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    const url = config.get('REDIS_URL', { infer: true });
    this.client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  // ── JWT blacklist ───────────────────────────────────────
  async blacklistJwt(jti: string, ttlSeconds: number): Promise<void> {
    await this.client.set(`jwt:blacklist:${jti}`, '1', 'EX', Math.max(1, ttlSeconds));
  }

  async isJwtBlacklisted(jti: string): Promise<boolean> {
    const v = await this.client.get(`jwt:blacklist:${jti}`);
    return v === '1';
  }

  // ── Rate limiting (simple) ──────────────────────────────
  async incrementCounter(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, ttlSeconds);
    return count;
  }
}
