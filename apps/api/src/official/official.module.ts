import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { StorageModule } from '../common/storage/storage.module';
import { FeedModule } from '../feed/feed.module';
import { OfficialAdminController } from './official.admin.controller';
import { OfficialService } from './official.service';

// Le compte officiel ne réécrit ni la publication ni la messagerie : il passe
// par PostsService et ChatService, donc il importe leurs modules plutôt que de
// dupliquer des écritures Prisma qui rateraient badge non-lu, push et socket.
@Module({
  imports: [StorageModule, FeedModule, ChatModule],
  controllers: [OfficialAdminController],
  providers: [OfficialService],
  exports: [OfficialService],
})
export class OfficialModule {}
