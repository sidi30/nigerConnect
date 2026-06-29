import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { FriendsService } from './friends.service';
import { BlockService } from './block.service';

@Controller()
export class SocialController {
  constructor(
    private readonly friends: FriendsService,
    private readonly blocks: BlockService,
  ) {}

  // ── Friend requests ─────────────────────────────────────────
  @Post('friends/request/:userId')
  async sendRequest(
    @CurrentUser() me: JwtUserPayload,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.friends.sendRequest(me.sub, userId);
  }

  @Post('friends/accept/:friendshipId')
  async accept(
    @CurrentUser() me: JwtUserPayload,
    @Param('friendshipId', new ParseUUIDPipe()) friendshipId: string,
  ) {
    return this.friends.accept(me.sub, friendshipId);
  }

  @Post('friends/decline/:friendshipId')
  async decline(
    @CurrentUser() me: JwtUserPayload,
    @Param('friendshipId', new ParseUUIDPipe()) friendshipId: string,
  ) {
    return this.friends.decline(me.sub, friendshipId);
  }

  @Delete('friends/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFriend(
    @CurrentUser() me: JwtUserPayload,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.friends.removeFriend(me.sub, userId);
  }

  @Get('friends')
  async listFriends(
    @CurrentUser() me: JwtUserPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(100, Math.max(1, Number(limit))) : 30;
    return this.friends.listFriends(me.sub, cursor, lim);
  }

  /** Type-ahead for @mentions: search the user's accepted friends by name. */
  // Per-keystroke endpoint (client already debounces) — cap bursts per user.
  @Throttle({ short: { limit: 30, ttl: 10_000 } })
  @Get('friends/search')
  searchFriends(@CurrentUser() me: JwtUserPayload, @Query('q') q?: string) {
    const query = (q ?? '').trim();
    if (query.length < 1) return { items: [] };
    return this.friends.searchFriends(me.sub, query.slice(0, 100));
  }

  @Get('friends/requests')
  incoming(@CurrentUser() me: JwtUserPayload) {
    return this.friends.pendingIncoming(me.sub);
  }

  @Get('friends/requests/sent')
  outgoing(@CurrentUser() me: JwtUserPayload) {
    return this.friends.pendingOutgoing(me.sub);
  }

  @Get('friends/mutual/:userId')
  mutual(
    @CurrentUser() me: JwtUserPayload,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.friends.mutualFriends(me.sub, userId);
  }

  @Get('friends/relationship/:userId')
  relationship(
    @CurrentUser() me: JwtUserPayload,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ) {
    return this.friends.relationship(me.sub, userId);
  }

  @Get('friends/suggestions')
  suggestions(@CurrentUser() me: JwtUserPayload, @Query('limit') limit?: string) {
    const lim = limit ? Math.min(50, Math.max(1, Number(limit))) : 20;
    return this.friends.suggestions(me.sub, lim);
  }

  // ── Blocks ──────────────────────────────────────────────────
  @Post('blocks/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async block(
    @CurrentUser() me: JwtUserPayload,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.blocks.block(me.sub, userId);
  }

  @Delete('blocks/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unblock(
    @CurrentUser() me: JwtUserPayload,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.blocks.unblock(me.sub, userId);
  }

  @Get('blocks')
  listBlocks(@CurrentUser() me: JwtUserPayload) {
    return this.blocks.listBlocked(me.sub);
  }
}
