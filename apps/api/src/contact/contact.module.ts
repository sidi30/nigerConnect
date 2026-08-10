import { Module } from '@nestjs/common';
import { AdminContactController, ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  controllers: [ContactController, AdminContactController],
  providers: [ContactService],
})
export class ContactModule {}
