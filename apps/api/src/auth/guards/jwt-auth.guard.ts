import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { RedisService } from '../../common/redis/redis.service';
import type { JwtUserPayload } from '../../common/decorators/current-user.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const canActivate = await super.canActivate(context);
    if (!canActivate) return false;

    const req = context.switchToHttp().getRequest();
    const user = req.user as JwtUserPayload | undefined;
    if (user?.jti && (await this.redis.isJwtBlacklisted(user.jti))) {
      throw new UnauthorizedException('Token revoked');
    }
    return true;
  }
}
