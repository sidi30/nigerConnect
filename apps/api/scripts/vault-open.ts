/**
 * Ouverture break-glass d'une pièce archivée. C'est le SEUL chemin de lecture du
 * coffre : l'API ne dispose d'aucune route et son compte de service S3 n'a même
 * pas le droit de lire le bucket.
 *
 *   npx ts-node scripts/vault-open.ts \
 *     --archive <archiveId> \
 *     --key ./vault-keys/vault-private.pem \
 *     --operator "prenom.nom@exemple.fr" \
 *     --reason "Réquisition judiciaire n°… du …" \
 *     --out ./sortie
 *
 * À exécuter depuis la machine du responsable, avec la clé privée hors ligne et
 * un tunnel vers MinIO (`ssh -L 19000:nigerconnect-minio:9000 root@<vps>` puis
 * S3_ENDPOINT=http://localhost:19000). Chaque ouverture réussie écrit une ligne
 * dans `identity_archive_accesses` — le journal fait partie de la preuve.
 *
 * Variables attendues : DATABASE_URL, S3_ENDPOINT, S3_REGION,
 * S3_VAULT_BUCKET, et des identifiants S3 AUTORISÉS EN LECTURE sur le coffre
 * (identifiants d'administration MinIO, jamais ceux de l'API).
 */
import { createDecipheriv, createHash, privateDecrypt, constants } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { join, resolve } from 'path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

const MAGIC = Buffer.from('NCVAULT1', 'utf8');

interface Args {
  archive: string;
  key: string;
  operator: string;
  reason: string;
  out: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const archive = get('archive');
  const key = get('key');
  const operator = get('operator');
  const reason = get('reason');
  if (!archive || !key || !operator || !reason) {
    throw new Error('Usage: --archive <id> --key <private.pem> --operator <who> --reason <why>');
  }
  if (reason.trim().length < 15) {
    // Le motif finit dans un journal d'audit destiné à être relu des années
    // plus tard : « test » n'est pas un motif.
    throw new Error('--reason must be a real, specific justification (15+ chars)');
  }
  return { archive, key, operator, reason, out: get('out') ?? './vault-out' };
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((res) => rl.question(question, res));
  } finally {
    rl.close();
  }
}

function unseal(envelope: Buffer, privateKeyPem: string, passphrase: string, userId: string) {
  if (!envelope.subarray(0, 8).equals(MAGIC)) throw new Error('Not an NCVAULT1 envelope');
  let offset = 8;
  const wrappedLen = envelope.readUInt16BE(offset);
  offset += 2;
  const wrappedKey = envelope.subarray(offset, offset + wrappedLen);
  offset += wrappedLen;
  const iv = envelope.subarray(offset, offset + 12);
  offset += 12;
  const tag = envelope.subarray(offset, offset + 16);
  offset += 16;
  const ciphertext = envelope.subarray(offset);

  const dataKey = privateDecrypt(
    {
      key: privateKeyPem,
      passphrase,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    wrappedKey,
  );

  const decipher = createDecipheriv('aes-256-gcm', dataKey, iv);
  decipher.setAAD(Buffer.concat([MAGIC, Buffer.from(userId, 'utf8')]));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  dataKey.fill(0);

  const metaLen = plaintext.readUInt32BE(0);
  const meta = JSON.parse(plaintext.subarray(4, 4 + metaLen).toString('utf8')) as {
    contentType: string;
    [k: string]: unknown;
  };
  return { meta, file: plaintext.subarray(4 + metaLen) };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const prisma = new PrismaClient();
  try {
    const archive = await prisma.identityArchive.findUnique({ where: { id: args.archive } });
    if (!archive) throw new Error(`Unknown archive ${args.archive}`);
    if (archive.purgedAt) throw new Error('This archive was purged at the end of its retention');

    console.log(`Archive   : ${archive.id}`);
    console.log(`User      : ${archive.userId}`);
    console.log(`Outcome   : ${archive.outcome} (${archive.documentType})`);
    console.log(`Archived  : ${archive.archivedAt.toISOString()}`);
    console.log(`Purge due : ${archive.purgeAt.toISOString()}`);
    const go = (await prompt('\nOpen this sealed identity document? (type OPEN): ')).trim();
    if (go !== 'OPEN') throw new Error('Aborted');

    const passphrase = (await prompt('Private key passphrase: ')).trim();
    const privateKeyPem = readFileSync(resolve(args.key), 'utf8');

    const bucket = process.env.S3_VAULT_BUCKET;
    if (!bucket) throw new Error('S3_VAULT_BUCKET is not set');
    const s3 = new S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? '',
        secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      },
    });
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: archive.vaultKey }));
    const bytes = await (res.Body as { transformToByteArray: () => Promise<Uint8Array> })
      .transformToByteArray();

    const { meta, file } = unseal(Buffer.from(bytes), privateKeyPem, passphrase, archive.userId);
    const sha = createHash('sha256').update(file).digest('hex');
    if (sha !== archive.contentSha256) {
      // L'empreinte enregistrée à l'archivage ne correspond plus : le fichier a
      // été altéré. On le signale au lieu de le présenter comme une preuve.
      console.warn(`⚠️  sha256 MISMATCH — expected ${archive.contentSha256}, got ${sha}`);
    }

    const outDir = resolve(args.out);
    mkdirSync(outDir, { recursive: true });
    const ext = meta.contentType === 'image/png' ? '.png' : '.jpg';
    const filePath = join(outDir, `${archive.id}${ext}`);
    if (existsSync(filePath)) throw new Error(`${filePath} already exists`);
    writeFileSync(filePath, file, { mode: 0o600 });
    writeFileSync(join(outDir, `${archive.id}.meta.json`), JSON.stringify(meta, null, 2), {
      mode: 0o600,
    });

    await prisma.identityArchiveAccess.create({
      data: { archiveId: archive.id, operator: args.operator, reason: args.reason },
    });

    console.log(`\n✅ Opened → ${filePath}`);
    console.log(`   sha256 ${sha === archive.contentSha256 ? 'OK' : 'MISMATCH'}`);
    console.log('   Access logged in identity_archive_accesses.');
    console.log('   Delete the extracted copy once the request is served.\n');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
