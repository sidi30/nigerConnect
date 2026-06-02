# Déploiement rapide — tester une modif sur iPhone

> Référence : que lancer après une modification pour la voir sur le téléphone.
> Prérequis (déjà en place) : EAS connecté (compte `sidi30`), clé SSH vers le VPS,
> variable `NODE_EXTRA_CA_CERTS` définie (certificat Norton).

## Quel cas suis-je ?

| Ce que j'ai modifié | Cas | Durée |
|---|---|---|
| Écrans / code mobile (JS/TS dans `apps/mobile`) | **Cas 1 — OTA** | ~2 min |
| API backend (`apps/api`) | **Cas 2 — VPS** | ~10 min |
| Les deux | Cas 2 **puis** Cas 1 | ~12 min |
| Nouveau package natif (`pnpm add` mobile) ou `app.json` | **Cas 3 — Rebuild EAS** | ~20 min |

---

## Cas 1 — OTA mobile (JS/TS uniquement)

```powershell
# 1. Commit + push
git add -A
git commit -m "description de la modif"
git push

# 2. Publier l'OTA (TOUJOURS depuis apps/mobile)
cd apps\mobile
npx eas-cli update --channel preview --platform ios --message "description de la modif"
```

**Sur l'iPhone** : fermer l'app complètement (swipe) → la rouvrir **2 fois**.
1ère ouverture = téléchargement, 2ème = application de la mise à jour.

---

## Cas 2 — Deploy API sur le VPS

```powershell
# 1. Commit OBLIGATOIRE d'abord (le deploy part du dernier commit, pas des fichiers non commités)
git add -A
git commit -m "description"
git push

# 2. Deploy en une commande (Git Bash ou PowerShell)
git archive HEAD | ssh root@46.224.193.109 "cd /opt/apps/nigerConnect && tar xf - && find . -name '*.sh' -not -path './node_modules/*' -exec sed -i 's/\r$//' {} + && chmod +x scripts/*.sh && ./scripts/deploy-vps.sh"
```

La commande fait : copie du code → fix des fins de ligne Windows → fix des permissions →
rebuild Docker → migrations Prisma → redémarrage API + web.

Vérification : <https://api-nigerconnect.sahabiguide.com/health> doit répondre `{"status":"ok",...}`.

---

## Cas 3 — Rebuild natif EAS (nouveau package / app.json modifié)

L'OTA ne peut PAS livrer du code natif. Il faut un nouveau build :

```powershell
cd apps\mobile
npx eas-cli build --profile preview --platform ios --non-interactive --no-wait
```

Suivre le lien affiché (expo.dev) → quand le build est fini (~15-20 min),
ouvrir le lien sur l'iPhone → **Install**.

---

## Pièges connus

| Erreur | Cause | Fix |
|---|---|---|
| `unable to verify the first certificate` | Norton intercepte le TLS | Ouvrir un **nouveau** terminal (la variable `NODE_EXTRA_CA_CERTS` est définie pour les nouveaux terminaux). Sinon : `$env:NODE_EXTRA_CA_CERTS = "C:\Users\ramzi\.certs\norton-root.pem"` |
| `Entity not authorized: AppEntity[...]` | eas-cli lancé depuis la racine du repo | Toujours `cd apps\mobile` avant les commandes `eas-cli` |
| `ERR_PNPM_OUTDATED_LOCKFILE` (build EAS) | `pnpm install` pas relancé après modif d'un package.json | `pnpm install` à la racine, commit du `pnpm-lock.yaml` |
| `bash\r: No such file or directory` (VPS) | Fins de ligne Windows | Inclus dans la commande du Cas 2 (`sed -i 's/\r$//'`) |
| `Permission denied ./scripts/deploy-vps.sh` (VPS) | tar perd le bit exécutable | Inclus dans la commande du Cas 2 (`chmod +x`) |
| Hermes `private properties are not supported` | Mauvaise version babel-preset-expo | Déjà épinglé `~54.0.10` — ne pas mettre à jour ce package sans upgrade SDK |

---

## Plus tard : automatisation GitHub Actions

Les workflows `.github/workflows/` font tout ça automatiquement au push sur `main`
(deploy VPS + OTA). Pour les activer : merger la branche dans `main` et ajouter le
secret `EXPO_TOKEN` (créé sur <https://expo.dev/accounts/sidi30/settings/access-tokens>) :

```powershell
gh secret set EXPO_TOKEN --body "TOKEN_ICI"
```
