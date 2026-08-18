import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { AnimationService } from './animation.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { S3Service } from '../common/storage/s3.service';
import { emailFor, ROSTER } from './roster';

/**
 * Amorçage des comptes d'animation, en ligne de commande.
 *
 * Pourquoi un CLI plutôt que la route admin : le seul compte administrateur a
 * le TOTP activé, donc personne ne peut fabriquer un jeton sans l'application
 * d'authentification du propriétaire. Passer par un contexte Nest autonome
 * dans le conteneur évite à la fois d'écrire en base à la main et de faire
 * circuler un identifiant.
 *
 *   docker exec nigerconnect-api node dist/animation/animation.cli.js
 *   docker exec nigerconnect-api node dist/animation/animation.cli.js --avatars /tmp/avatars
 *   docker exec nigerconnect-api node dist/animation/animation.cli.js --enqueue /tmp/lot.json
 *
 * `--enqueue <fichier>` : depose un lot redige hors ligne. Meme chemin que la
 * route admin (donc memes refus : un contenu juridique sans source est rejete,
 * et repasse en draft quoi qu'il arrive).
 *
 * `--avatars <dir>` : téléverse les fichiers `nc01.png` … `nc25.png` du dossier
 * comme photos de profil. Le dossier de destination reste `users/{id du
 * compte}`, comme pour n'importe quel membre.
 */
async function main(): Promise<void> {
  const logger = new Logger('AnimationCLI');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const animation = app.get(AnimationService);
    const result = await animation.ensureAccounts();
    logger.log(
      `Comptes : ${result.created} créés, ${result.updated} mis à jour, ${result.total} attendus`,
    );

    const queueFlag = process.argv.indexOf('--enqueue');
    if (queueFlag > -1) {
      const file = process.argv[queueFlag + 1];
      if (!file) throw new Error('--enqueue attend un chemin de fichier JSON');
      const items = JSON.parse(await readFile(file, 'utf8')) as Parameters<
        AnimationService['enqueue']
      >[0][];
      let queued = 0;
      for (const item of items) {
        await animation.enqueue(item);
        queued += 1;
      }
      logger.log(`File : ${queued} publication(s) déposée(s)`);
    }

    const flag = process.argv.indexOf('--avatars');
    if (flag > -1) {
      const dir = process.argv[flag + 1];
      if (!dir) throw new Error('--avatars attend un chemin de dossier');
      await uploadAvatars(app.get(PrismaService), app.get(S3Service), dir, logger);
    }
  } finally {
    await app.close();
  }
}

async function uploadAvatars(
  prisma: PrismaService,
  s3: S3Service,
  dir: string,
  logger: Logger,
): Promise<void> {
  const files = await readdir(dir);
  let done = 0;
  let missing = 0;

  for (const entry of ROSTER) {
    const file = files.find((f) => f.toLowerCase().startsWith(entry.handle));
    if (!file) {
      missing += 1;
      continue;
    }
    const bot = await prisma.user.findFirst({
      where: { email: emailFor(entry.handle), isAnimated: true },
      select: { id: true },
    });
    if (!bot) {
      logger.warn(`${entry.handle} : compte introuvable, avatar ignoré`);
      continue;
    }

    const bytes = await readFile(path.join(dir, file));
    const ext = path.extname(file).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    // Même convention de clé que pour un membre : c'est ce qui rend l'avatar
    // vérifiable par assertOwnedPublicImage, sans traitement de faveur.
    const url = await s3.putPublicObject(`users/${bot.id}/${randomUUID()}${ext}`, bytes, contentType);
    await prisma.user.update({ where: { id: bot.id }, data: { avatarUrl: url } });
    logger.log(`${entry.handle} ← ${file}`);
    done += 1;
  }

  logger.log(`Avatars : ${done} posés, ${missing} sans fichier`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
