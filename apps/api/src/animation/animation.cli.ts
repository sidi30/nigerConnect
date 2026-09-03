import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { AnimationService } from './animation.service';
import { AnimationIllustrationService } from './animation-illustration.service';
import { AnimationEngagementService } from './animation-engagement.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { S3Service } from '../common/storage/s3.service';
import { emailFor, ROSTER } from './roster';
import { illustrationsEnabled } from './animation-guardrails';

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
 * route admin (donc meme refus : un contenu juridique sans source est rejete).
 * Depuis le 22/08/2026 la publication est programmee directement ; seul
 * `hold: true` dans le lot la gare en `draft`.
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

    // --list-work : ce que l'atelier doit rédiger, en JSON sur la sortie
    // standard. C'est ce qui remplace l'appel HTTP admin : le compte
    // administrateur ayant le TOTP, aucun jeton ne peut être fabriqué, donc
    // l'atelier passe par SSH + ce CLI plutôt que par l'API.
    if (process.argv.includes('--list-work')) {
      const prisma = app.get(PrismaService);
      const replies = await prisma.animationReply.findMany({
        where: { status: 'pending', draft: null },
        include: { bot: { select: { handle: true } } },
        orderBy: { dueAt: 'asc' },
        take: 30,
      });
      const work = [];
      let closed = 0;
      for (const r of replies) {
        // Le fil de la conversation, pour que la réponse réponde vraiment.
        // Les VINGT DERNIERS messages, pas les vingt premiers : sur un fil qui
        // dure, l'ordre croissant montrait le début de l'échange et laissait
        // croire que le membre venait d'écrire.
        const recent = await prisma.message.findMany({
          where: { conversationId: r.conversationId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { content: true, sender: { select: { displayName: true, isAnimated: true } } },
        });
        const messages = recent.reverse();
        // Le fil se termine déjà par le compte : répondre enverrait deux
        // messages d'affilée du même expéditeur, ce qui se voit tout de suite.
        // La ligne n'a plus d'objet — on la clôt ici, sinon elle reste
        // `pending` pour toujours et remonte à CHAQUE exécution de l'atelier.
        // `skipped`, jamais `escalated` : `escalated` est réservé à la
        // suspicion et rien ne le réarme.
        if (messages[messages.length - 1]?.sender.isAnimated) {
          await prisma.animationReply.update({
            where: { id: r.id },
            data: { status: 'skipped' },
          });
          closed += 1;
          continue;
        }
        work.push({
          type: 'reply',
          id: r.id,
          handle: r.bot.handle,
          dueAt: r.dueAt,
          conversation: messages.map((m) => ({
            de: m.sender.displayName,
            bot: m.sender.isAnimated,
            texte: m.content,
          })),
        });
      }
      if (closed > 0) {
        logger.log(`Réponses sans objet closes : ${closed} (le compte a déjà le dernier mot)`);
      }
      const comments = await prisma.animationAction.findMany({
        where: { type: 'comment', status: 'pending', draft: null },
        include: { bot: { select: { handle: true } } },
        orderBy: { dueAt: 'asc' },
        take: 30,
      });
      for (const c of comments) {
        const post = c.targetPostId
          ? await prisma.post.findUnique({
              where: { id: c.targetPostId },
              select: { content: true, author: { select: { displayName: true } } },
            })
          : null;
        work.push({
          type: 'comment',
          id: c.id,
          handle: c.bot.handle,
          dueAt: c.dueAt,
          publication: post ? { de: post.author.displayName, texte: post.content } : null,
        });
      }
      console.log(JSON.stringify(work, null, 2));
    }

    // --drafts <fichier> : applique les textes rédigés par l'atelier.
    const draftsFlag = process.argv.indexOf('--drafts');
    if (draftsFlag > -1) {
      const file = process.argv[draftsFlag + 1];
      if (!file) throw new Error('--drafts attend un chemin de fichier JSON');
      const drafts = JSON.parse(await readFile(file, 'utf8')) as {
        type: 'reply' | 'comment';
        id: string;
        draft: string;
      }[];
      const engagement = app.get(AnimationEngagementService);
      let applied = 0;
      for (const d of drafts) {
        try {
          if (d.type === 'reply') await animation.draftReply(d.id, d.draft);
          else await engagement.draftComment(d.id, d.draft);
          applied += 1;
        } catch (error) {
          logger.warn(`Brouillon ${d.id} refusé : ${String(error)}`);
        }
      }
      logger.log(`Brouillons : ${applied} appliqué(s) sur ${drafts.length}`);
    }

    const queueFlag = process.argv.indexOf('--enqueue');
    if (queueFlag > -1) {
      const file = process.argv[queueFlag + 1];
      if (!file) throw new Error('--enqueue attend un chemin de fichier JSON');
      // `imagePrompt` n'existe que dans le fichier de lot : l'atelier décrit
      // l'image voulue, et c'est ICI qu'elle devient un objet du bucket. Rien
      // de cette description n'est stocké — seule l'URL de l'image l'est.
      const items = JSON.parse(await readFile(file, 'utf8')) as (Parameters<
        AnimationService['enqueue']
      >[0] & { imagePrompt?: string })[];
      const illustrations = app.get(AnimationIllustrationService);
      let queued = 0;
      let illustrated = 0;
      for (const item of items) {
        const { imagePrompt, ...post } = item;
        if (imagePrompt && !post.mediaUrl && illustrationsEnabled()) {
          // Le compte doit exister avant de ranger une image sous sa clé.
          const bot = await app
            .get(PrismaService)
            .user.findFirst({
              where: { email: emailFor(post.handle), isAnimated: true },
              select: { id: true },
            });
          if (bot) {
            const url = await illustrations.illustrate(bot.id, imagePrompt);
            if (url) {
              post.mediaUrl = url;
              illustrated += 1;
            }
          } else {
            logger.warn(`${post.handle} : compte introuvable, image ignorée`);
          }
        }
        await animation.enqueue(post);
        queued += 1;
      }
      logger.log(
        `File : ${queued} publication(s) déposée(s), dont ${illustrated} illustrée(s)`,
      );
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
