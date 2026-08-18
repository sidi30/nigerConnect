import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AnimationChatService } from './animation-chat.service';
import { AnimationEngagementService } from './animation-engagement.service';
import { AnimationService } from './animation.service';

/**
 * Cinq minutes : c'est la granularité utile d'un créneau éditorial. Plus court
 * ferait tourner un balayage pour rien la plupart du temps ; plus long ferait
 * arriver « le bon plan de 19 h » à 19 h 25.
 */
const INTERVAL_MS = 5 * 60 * 1000;

/**
 * Vide la file d'animation à l'heure prévue.
 *
 * C'est la moitié SERVEUR du dispositif : l'atelier tourne sur le poste du
 * propriétaire et remplit la file par lots, ce cron publie sans lui. Poste
 * éteint pendant trois jours = la plateforme continue de vivre sur le stock
 * déjà validé. Même forme que DigestCron et StoriesCron : setInterval unref,
 * inerte sous NODE_ENV=test.
 */
@Injectable()
export class AnimationCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnimationCron.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly animation: AnimationService,
    private readonly chat: AnimationChatService,
    private readonly engagement: AnimationEngagementService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.run(), INTERVAL_MS).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      await this.animation.publishDue();
      // Les conversations passent par le même balayage : un seul réveil, et
      // les réponses partent à la même granularité que les publications.
      await this.chat.scanIncoming();
      await this.chat.sendDue();
      // Engagement : on programme d'abord (cibles + heures étalées), on exécute
      // ensuite ce qui est dû. Jamais dans le même geste, sinon tout partirait
      // en rafale à la seconde du balayage.
      await this.engagement.plan();
      await this.engagement.execute();
      // Les demandes d'ami reçues sont acceptées ici : un compte qui publie et
      // ne répond jamais à une demande se repère immédiatement.
      await this.engagement.acceptPendingFriendRequests();
    } catch (error) {
      this.logger.error("Balayage de la file d'animation échoué", error as Error);
    }
  }
}
