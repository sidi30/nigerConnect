import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type JwtUserPayload } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PageService } from './page.service';
import {
  changePageRoleSchema,
  createPageSchema,
  listPagesSchema,
  updatePageSchema,
  type ChangePageRoleDto,
  type CreatePageDto,
  type ListPagesDto,
  type UpdatePageDto,
} from './dto/page.dto';

@Controller('pages')
export class PageController {
  constructor(private readonly pages: PageService) {}

  @Post()
  create(
    @CurrentUser() me: JwtUserPayload,
    @Body(new ZodValidationPipe(createPageSchema)) dto: CreatePageDto,
  ) {
    return this.pages.create(me.sub, dto);
  }

  @Get()
  list(@Query(new ZodValidationPipe(listPagesSchema)) dto: ListPagesDto) {
    return this.pages.list(dto);
  }

  @Get('mine')
  mine(@CurrentUser() me: JwtUserPayload) {
    return this.pages.listMine(me.sub);
  }

  @Get(':id')
  get(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.pages.getById(id, me.sub);
  }

  @Patch(':id')
  update(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updatePageSchema)) dto: UpdatePageDto,
  ) {
    return this.pages.update(me.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.pages.remove(me.sub, id);
  }

  @Post(':id/follow')
  follow(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.pages.follow(me.sub, id);
  }

  @Delete(':id/follow')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unfollow(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.pages.unfollow(me.sub, id);
  }

  @Get(':id/admins')
  admins(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.pages.listAdmins(id);
  }

  @Patch(':id/admins/:userId')
  setAdmin(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(changePageRoleSchema)) dto: ChangePageRoleDto,
  ) {
    return this.pages.setAdmin(me.sub, id, userId, dto);
  }

  @Delete(':id/admins/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAdmin(
    @CurrentUser() me: JwtUserPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.pages.removeAdmin(me.sub, id, userId);
  }
}
