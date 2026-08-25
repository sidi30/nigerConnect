/**
 * Génère la paire de clés du coffre d'identité.
 *
 *   npx ts-node scripts/vault-keygen.ts ./vault-keys
 *
 * Produit deux fichiers dans le dossier indiqué :
 *   - `vault-public.pem`  → à déposer sur le serveur, en base64, dans
 *                           IDENTITY_VAULT_PUBLIC_KEY (.env.prod).
 *   - `vault-private.pem` → NE JAMAIS déposer sur le VPS. Il reste sur la
 *                           machine du responsable + une sauvegarde hors ligne
 *                           (clé USB chiffrée, coffre physique). Sans lui,
 *                           AUCUNE pièce archivée n'est lisible — y compris par
 *                           toi. Perdre les deux copies = coffre définitivement
 *                           illisible.
 *
 * La clé privée est chiffrée par une phrase de passe demandée au clavier ; elle
 * n'est jamais écrite en clair.
 */
import { generateKeyPairSync } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { join, resolve } from 'path';

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((res) => rl.question(question, res));
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const outDir = resolve(process.argv[2] ?? './vault-keys');
  const publicPath = join(outDir, 'vault-public.pem');
  const privatePath = join(outDir, 'vault-private.pem');
  if (existsSync(publicPath) || existsSync(privatePath)) {
    // Écraser une paire existante rendrait illisibles toutes les pièces déjà
    // scellées avec l'ancienne. Refus catégorique.
    throw new Error(`Key pair already present in ${outDir} — refusing to overwrite`);
  }

  const passphrase = (await prompt('Passphrase for the PRIVATE key (min 12 chars): ')).trim();
  if (passphrase.length < 12) throw new Error('Passphrase too short');
  const confirm = (await prompt('Repeat passphrase: ')).trim();
  if (confirm !== passphrase) throw new Error('Passphrases do not match');

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase,
    },
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(publicPath, publicKey, { mode: 0o644 });
  writeFileSync(privatePath, privateKey, { mode: 0o600 });

  console.log(`\n✅ Key pair written to ${outDir}`);
  console.log(`   public : ${publicPath}`);
  console.log(`   private: ${privatePath}  ← keep OFFLINE, never deploy\n`);
  console.log('Add this line to .env.prod on the VPS (public key only):\n');
  console.log(`IDENTITY_VAULT_PUBLIC_KEY=${Buffer.from(publicKey, 'utf8').toString('base64')}\n`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
