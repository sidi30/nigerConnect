# Assets du build store

Ce dossier doit contenir les 4 fichiers suivants **avant le premier build EAS pour les stores**. Sans eux, le build échouera ou sera rejeté par Apple / Google.

| Fichier | Taille requise | Usage | Commentaire |
|---|---|---|---|
| `icon.png` | **1024 × 1024** (carré) | Icône iOS + source par défaut | PNG sans transparence, sans coins arrondis (Apple les applique) |
| `adaptive-icon.png` | **1024 × 1024** | Android 8.0+ foreground | Le logo doit tenir dans un cercle de 66 % centré ; le reste est masqué par le système |
| `splash.png` | **1284 × 2778** (ou plus) | Splash iOS + Android | Sur fond `#FDFBF7` (défini dans `app.json`) ; centré |
| `notification-icon.png` | **96 × 96** | Notifications Android | **Blanc sur transparent uniquement** (le système teinte l'icône) |
| `favicon.png` | **48 × 48** ou plus | Onglet navigateur (web) | Optionnel, mais évite l'icône par défaut Expo |

## Production des assets

Le plus simple :

1. Garde un SVG source unique (logo NigerConnect)
2. Exporte en PNG aux dimensions ci-dessus via Figma, Sketch ou `@expo/configure-splash-screen`
3. Pour l'`adaptive-icon.png`, vérifie le rendu dans le [Play Console Icon Preview](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive/preview)

## Placeholder temporaire

Pendant le développement, tu peux copier n'importe quel PNG 1024×1024 (même un fond uni orange) pour débloquer les builds. À remplacer **impérativement** avant soumission.

## Ne pas oublier

- Apple : icône **sans canal alpha** (pas de transparence)
- Google : icône adaptative avec un padding de sécurité (logo pas trop grand)
- Notification Android : icône **monochrome** (le système applique la couleur définie dans `app.json` → `expo-notifications` → `color: "#E05206"`)
