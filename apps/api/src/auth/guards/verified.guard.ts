import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtUserPayload } from '../../common/decorators/current-user.decorator';

@Injectable()
export class VerifiedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtUserPayload }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Not authenticated');
    if (user.identityStatus !== 'approved') {
      throw new ForbiddenException('Identity verification required');
    }
    return true;
  }
}
