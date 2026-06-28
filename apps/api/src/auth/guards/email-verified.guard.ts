import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ALLOW_UNVERIFIED_KEY } from '../../common/decorators/allow-unverified.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtUserPayload } from '../../common/decorators/current-user.decorator';

const VERIFIED_CACHE_TTL_MS = 60_000;

/**
 * Global guard, run AFTER JwtAuthGuard (declaration order in the module = run
 * order). It blocks authenticated-but-unverified users from the rest of the
 * app.
 *
 * Routes opting out:
 *   - `@Public()`        → unauthenticated routes, nothing to check.
 *   - `@AllowUnverified()` → routes a not-yet-verified user must still reach
 *     (e.g. resend verification email, /me, logout).
 *
 * Perf: a positive verdict (verified=true) is cached in-process for a short
 * TTL so we don't hit the DB on every request. We deliberately never cache the
 * negative verdict so that a user who clicks the verification link is unblocked
 * on their very next request.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  private readonly verifiedCache = new Map<string, number>();

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allowUnverified = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowUnverified) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: JwtUserPayload }>();
    const user = request.user;
    // No user → JwtAuthGuard already decided (public route slipped through or
    // auth failed). Nothing for us to enforce.
    if (!user) return true;

    const cachedAt = this.verifiedCache.get(user.sub);
    if (cachedAt !== undefined && Date.now() - cachedAt < VERIFIED_CACHE_TTL_MS) {
      return true;
    }

    const record = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { emailVerified: true, status: true },
    });

    if (record?.emailVerified === false) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Veuillez vérifier votre adresse email pour continuer.',
      });
    }

    // An admin can block an account at any time; enforce it here so a banned /
    // suspended user is cut off on their next request (within the short positive
    // cache TTL) without waiting for their access token to expire. Login already
    // refuses these statuses, and the ban also revokes their refresh tokens, so
    // they cannot mint new tokens either. Never cached (we throw), so lifting a
    // suspension unblocks immediately — same rationale as the unverified case.
    if (record?.status === 'banned') {
      throw new ForbiddenException({
        code: 'ACCOUNT_BANNED',
        message: 'Votre compte a été banni.',
      });
    }
    if (record?.status === 'suspended') {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Votre compte est suspendu.',
      });
    }

    // Verified + active (or user no longer exists — JwtAuthGuard's concern).
    this.verifiedCache.set(user.sub, Date.now());
    return true;
  }
}
