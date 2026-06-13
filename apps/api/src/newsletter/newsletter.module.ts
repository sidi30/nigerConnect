import { Module } from '@nestjs/common';
import { NewsletterAdminController } from './newsletter.admin.controller';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';

// PrismaModule and MailModule are @Global → no imports needed here.
@Module({
  controllers: [NewsletterController, NewsletterAdminController],
  providers: [NewsletterService],
})
export class NewsletterModule {}
