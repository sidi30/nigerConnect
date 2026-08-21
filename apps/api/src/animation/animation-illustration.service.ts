import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { S3Service } from '../common/storage/s3.service';

/**
 * Fabrique l'image d'une publication d'animation.
 *
 * L'atelier rédige le texte ET une description de l'image souhaitée ; c'est
 * ici, côté serveur, que l'image devient un objet dans notre bucket. Le poste
 * du propriétaire n'a rien à téléverser : il ne transmet qu'une phrase.
 *
 * La clé suit la convention des membres — `users/{id du compte}/…` — pour que
 * `assertOwnedPublicImage` valide l'appartenance au moment de la publication,
 * sans exception taillée pour l'occasion. C'est la même règle que pour les
 * avatars de ces comptes.
 *
 * Le générateur est un service tiers gratuit et sans compte. Ce qui sort d'ici
 * est une description de scène — jamais une donnée personnelle, jamais le
 * texte de la publication, jamais un identifiant de compte. Si le service est
 * indisponible, la publication part SANS image plutôt que d'être perdue :
 * l'illustration est un agrément, le texte est la valeur.
 */
@Injectable()
export class AnimationIllustrationService {
  private readonly logger = new Logger(AnimationIllustrationService.name);

  /** Le générateur rend parfois une page d'erreur en HTML : on ne persiste que
   *  ce qui est réellement une image, et d'un type que notre garde accepte. */
  private static readonly ACCEPTED = new Map<string, string>([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
  ]);

  /** Au-delà, on jette : la garde d'attache refuserait de toute façon, et le
   *  quota disque n'a pas à payer pour une réponse aberrante. */
  private static readonly MAX_BYTES = S3Service.MAX_PUBLIC_IMAGE_BYTES;

  /** Une génération prend ~5 s. 60 s laisse de la marge sans bloquer un lot. */
  private static readonly TIMEOUT_MS = 60_000;

  constructor(private readonly s3: S3Service) {}

  /**
   * Rend l'URL CDN de l'image, ou `null` si elle n'a pas pu être fabriquée.
   *
   * Ne lève jamais : un lot de dix publications ne doit pas échouer parce
   * qu'une image sur dix n'est pas venue.
   */
  async illustrate(botId: string, prompt: string): Promise<string | null> {
    const cleaned = prompt.trim();
    if (cleaned.length === 0 || cleaned.length > 400) {
      this.logger.warn(`Description d'image ignorée (longueur ${cleaned.length})`);
      return null;
    }

    try {
      const { bytes, extension, contentType } = await this.fetchImage(cleaned);
      const key = `users/${botId}/animation/${randomUUID()}${extension}`;
      const url = await this.s3.putPublicObject(key, bytes, contentType);
      this.logger.log(`Illustration posée : ${key} (${Math.round(bytes.length / 1024)} Ko)`);
      return url;
    } catch (error) {
      this.logger.warn(`Illustration abandonnée : ${String(error)}`);
      return null;
    }
  }

  private async fetchImage(
    prompt: string,
  ): Promise<{ bytes: Buffer; extension: string; contentType: string }> {
    const url =
      'https://image.pollinations.ai/prompt/' +
      encodeURIComponent(prompt) +
      '?width=1024&height=1024&nologo=true';

    const res = await fetch(url, {
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(AnimationIllustrationService.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.toLowerCase();
    const extension = AnimationIllustrationService.ACCEPTED.get(contentType);
    if (!extension) throw new Error(`type refusé : ${contentType || 'inconnu'}`);

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) throw new Error('réponse vide');
    if (bytes.length > AnimationIllustrationService.MAX_BYTES) {
      throw new Error(`${bytes.length} octets, au-dessus du plafond`);
    }

    return { bytes, extension, contentType };
  }
}
