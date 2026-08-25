import { Global, Module } from '@nestjs/common';
import { IdentityArchiverService } from './identity-archiver.service';
import { IdentityVaultService } from './identity-vault.service';
import { S3Service } from './s3.service';

@Global()
@Module({
  providers: [S3Service, IdentityVaultService, IdentityArchiverService],
  exports: [S3Service, IdentityVaultService, IdentityArchiverService],
})
export class StorageModule {}
