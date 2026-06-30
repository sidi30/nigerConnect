# ADR-001 — Carte native « façon Snapchat » + intégration Lottie

**Statut :** `ACCEPTED` (2026-06-30) — décisions proprio : **react-native-maps + Apple Maps iOS** (0 clé), **anneau story P-04 inclus** (champ backend `hasActiveStory`, sans migration), **build ANIM-8+9 groupé → bump 1.7.0→1.8.0** via CI `ios-build.yml` (rebuild = action sortante, GO final au gate build). Implémentation derrière **feature flag** (Leaflet en fallback).
**Date :** 2026-06-30
**Auteur :** gwani-architect
**Backlog :** Sprint Animations, Vague B — items `ANIM-7` (cet ADR), `ANIM-8` (carte native), `ANIM-9` (Lottie).
**Périmètre :** mobile uniquement (`apps/mobile`). API `geo` impactée à la marge (aucune migration). Aucun code de prod produit par cet ADR.

> ⚠️ **GATE PROPRIO.** Cet ADR tranche l'architecture. Il ne déclenche **aucun** `prebuild`, `eas build`, ni bump
> de `app.json`. Tout cela attend un GO explicite (cf. §8 Questions ouvertes et §7 Plan).

---

## 1. Contexte — état réel du code (vérifié, file:line)

### 1.1 La carte aujourd'hui = WebView Leaflet
La carte vit entièrement dans `apps/mobile/app/(tabs)/map.tsx` :

- **HTML/JS injecté** dans une `<WebView>` (`react-native-webview` `13.15.0`) : constante `LEAFLET_HTML` l.58-236, montée l.419-428.
- **Tuiles** : raster CARTO Voyager via CDN (`basemaps.cartocdn.com/.../voyager`) l.105.
- **Rendu des marqueurs** : `window.renderMarkers` l.146-232. Repart d'un `markerLayer.clearLayers()` l.147 (= flash historique, partiellement corrigé par le diff l.171-184).
- **Types de pins** :
  - individuels (avatar rond `divIcon`, fallback initiales) l.187-200 ;
  - **halo « actif »** (ANIM-2) conditionné par `m.activeRecently` l.194-196 ;
  - associations l.201-208, pages l.209-216 (emoji + badge vérifié) ;
  - clusters pays/ville l.217-229.
- **Fan-out des coords identiques** (anti-empilement, anneau ~24 m) l.149-169.
- **Marqueur « moi » + cercle de zone proximité** : `window.drawMe(lat, lon, radiusKm)` l.126-135, `recenterMe` l.136-138, `flyTo` l.118-120.
- **Pont natif↔web** : `injectJavaScript(...renderMarkers(JSON))` l.393-395, messages `ready`/`bounds`/`select` via `onMessage` l.399-415.
- **Sheets** (RN natif, hors WebView) : `SelectedSheet` l.594, `IndividualSheet` l.743 (relation d'amitié, add-friend), `ClusterListSheet` l.834 (liste paginée des membres). **Contrat clé : taper un cluster ouvre une LISTE, sans zoom auto** l.225-227 + l.695-707.
- **Recherche** (globale `/profile/search` + filtrage client) l.337-345 & l.361-397 ; **filtres** all/people/associations l.27-31 & l.430-458.
- **Géoloc** : `expo-location` foreground, permission + fix + `persistMyPosition` l.267-315.

### 1.2 Le contrat geo (à préserver)
- Client : union `MapMarker` dans `apps/mobile/services/geoApi.ts` l.21-60 ; `members(bounds)` l.106-116 ; `countryMembers(code)` l.121-133 ; `activeRecently?` l.34.
- Serveur : `apps/api/src/geo/geo.service.ts` `getMarkers()` l.181-229. **Le clustering est calculé CÔTÉ SERVEUR par bounds+zoom** :
  - `zoom < 4` → clusters pays + orphelins l.206-211 ;
  - `4 ≤ zoom < 9` → clusters ville + orphelins l.212-214 ;
  - `zoom ≥ 9` → individus l.215-217.
  - Présence en ligne (`activeRecently`) dérivée de Redis `presence:user:*` l.1084-1098.
  - **Gating privacy appliqué côté serveur** : `showOnMap`, `privacyLevel='private'`, `blockedIds`, override admin. Les clusters ne renvoient qu'un **compte anonymisé** — jamais la liste des individus masqués.

### 1.3 Proximité (Sprint 2)
La proximité (`ProximityEncounter`, double-aveugle) consomme `apps/mobile/hooks/useProximityAlerts.ts` + `services/geoApi.ts` l.138-168 et le marqueur « moi » + cercle de zone de la carte. **Indépendante du moteur de rendu** : le portage carte ne doit pas toucher la logique proximité, seulement re-dessiner `drawMe` + le cercle nativement.

### 1.4 Stack & build
- **Expo SDK 54** (`expo ^54.0.35`), **New Architecture ACTIVÉE** (`app.json` l.9 `newArchEnabled: true`).
- Déjà natif dans le build : `react-native-reanimated ~4.1.7`, `react-native-gesture-handler ~2.28.0`, `react-native-webview 13.15.0`, `expo-location ~19.0.8`, `expo-notifications`.
- **ABSENTS** : `react-native-maps`, `@rnmapbox/maps`, `lottie-react-native`.
- `app.json` : `version 1.7.0` l.5 ; permissions localisation **déjà présentes** (iOS `NSLocationWhenInUseUsageDescription` l.36, Android `ACCESS_COARSE/FINE_LOCATION` l.142-143, **background location explicitement BLOQUÉE** l.151) ; plugins l.174-219 (aucun plugin carte).
- **Build** : EAS cloud gratuit épuisé ⇒ on passe par le CI `.github/workflows/ios-build.yml` = `eas build --local` sur runner `macos-15` (consomme les minutes GitHub Actions, **pas** le quota EAS), déclenchement manuel (`workflow_dispatch`). Équivalent Android : `android-build.yml`.

### 1.5 Web
**`apps/web` n'a AUCUNE carte** (aucune occurrence `leaflet`/`mapbox`/`react-leaflet`/`geo` dans `apps/web/src`). **Conséquence directe : il n'existe aucun code carte partagé. La question « migration vs cohabitation » est donc tranchée par les faits — voir §3.2.**

---

## 2. Décision 1 — Choix de la librairie native

### Option A — `react-native-maps`
Tuiles natives Apple Maps (iOS) / Google Maps (Android), ou Google sur les deux via `PROVIDER_GOOGLE`.

| Critère | Évaluation |
|--------|-----------|
| Coût | **Gratuit.** Apple Maps = 0 clé. Google Maps Mobile SDK = clé API mais **gratuit illimité** sur mobile (le pricing Google ne facture pas l'affichage de carte du SDK natif iOS/Android). |
| Look « Snap » | Moyen par défaut (tuiles standard). **`customMapStyle` (JSON Google)** permet une palette stylisée « façon Snap » — mais uniquement sur provider Google (Apple Maps n'accepte pas de style JSON complet). Pour un rendu Snap **homogène iOS+Android**, il faut `PROVIDER_GOOGLE` partout ⇒ clé Google + SDK Google sur iOS. |
| Pins avatars natifs | ✅ `<Marker>` avec enfant React custom (`<Avatar>` + anneau + halo en reanimated). Rendu natif. |
| Anneau de story P-04 / halo ANIM-2 | ✅ Composant RN superposé dans le `<Marker>` (View + reanimated). |
| 60 fps | ✅ Bon. Attention au coût de rendu de N markers custom (mitigé par clustering serveur, voir §4). |
| Compat Expo / New Arch | ✅ **Config plugin officiel `react-native-maps`**, supporte la New Architecture (Fabric). Intégration managée via `expo prebuild`/EAS. |
| Maintenance | ✅ Lib mature, large communauté, maintenue. |

### Option B — `@rnmapbox/maps`
Tuiles **vector** Mapbox (le moteur réellement utilisé par Snap Map).

| Critère | Évaluation |
|--------|-----------|
| Coût | **Token Mapbox requis** (public au runtime + secret de download au build). Tarif : palier gratuit ~25k MAU, puis facturation au **MAU / Map Loads**. = dépense récurrente, à arbitrer (cf. §8). |
| Look « Snap » | **Excellent.** Style vector custom (Mapbox Studio), palette douce, labels fins, 3D — le rendu Snap « authentique ». |
| Pins avatars natifs | ✅ `MarkerView`/`PointAnnotation` avec enfant RN custom. |
| Anneau / halo | ✅ Idem option A. |
| 60 fps | ✅ **Excellent** (rendu WebGL natif, gestes très fluides). |
| Compat Expo / New Arch | ✅ Config plugin `@rnmapbox/maps` (token de download au build) ; New Arch supportée (v10). Intégration un peu plus lourde (token secret en CI). |
| Maintenance | ✅ Maintenue, mais dépendance à un fournisseur payant + quota. |

### Analyse / arbitrage

Le « ressenti Snapchat » de NigerConnect provient à **~80 % des éléments qu'on dessine NOUS-MÊMES** : pins avatars ronds, anneau de story, halo de présence, animation d'entrée/clustering, glisse fluide. Ces 80 % sont **identiques** sur les deux libs (enfants RN + reanimated dans un `<Marker>`). Les **~20 % restants** = l'esthétique du fond de carte vector, là où Mapbox est strictement supérieur.

Face à ça : la culture du projet est **coût maîtrisé** (VPS ~6 €/mois, EAS gratuit, solo dev), et Mapbox introduit une **dépense récurrente au MAU + un token secret en CI**. `react-native-maps` est **gratuit, l'intégration Expo la plus simple**, et couvre les 80 % qui font le différenciateur.

### ✅ Recommandation : `react-native-maps` (provider à trancher, cf. §8)

- **Primaire : `react-native-maps`.** Démarrer en **Apple Maps sur iOS (0 clé)** + **Google sur Android**, OU **`PROVIDER_GOOGLE` partout** si l'on veut le `customMapStyle` Snap homogène (⇒ une clé Google, gratuite sur mobile). Recommandation : viser `PROVIDER_GOOGLE` partout + style JSON « Snap » pour la cohérence visuelle, sous réserve de l'accord proprio sur l'usage du SDK Google sur iOS (§8).
- **Réversibilité = clé de la décision.** On encapsule le moteur derrière un composant interne `MapCanvas` (interface : `markers`, `onSelectMarker`, `me`, `flyTo`, `recenter`). Le reste de `map.tsx` (sheets, recherche, filtres, fetch) ne connaît jamais la lib. **Si la palette vector Mapbox devient un objectif produit, le swap vers `@rnmapbox/maps` est confiné à `MapCanvas`** — pas une réécriture.

---

## 3. Décision 2 — Migration vs cohabitation

### 3.1 Mobile : migration franche (avec fallback temporaire)
On **remplace** Leaflet/WebView par la carte native sur mobile. Justification :
- WebView Leaflet = pont JSON sérialisé + DOM = plafond de fluidité (le `clearLayers` l.147, le `injectJavaScript` l.393) que le natif supprime.
- Aucune raison de garder deux moteurs sur mobile en régime permanent.

**MAIS** : on **garde l'écran Leaflet existant comme fallback derrière un feature flag** (cf. §7) le temps de valider la parité en TestFlight. Une fois la carte native validée → suppression du `LEAFLET_HTML` et du flag.

### 3.2 Web : aucune cohabitation à gérer
`apps/web` **n'a pas de carte** (vérifié §1.5). Il n'existe donc **aucun code carte partagé** entre mobile et web. La migration mobile **n'a aucun impact** sur le web. Si une carte web est créée un jour, elle restera naturellement sur du Leaflet/MapLibre web (les libs natives RN ne ciblent pas le DOM) — décision indépendante, hors périmètre de cet ADR.

**Conclusion : « migration » sur mobile, « non concerné » sur web. Pas de double maintenance de carte.**

---

## 4. Décision 3 — Clustering : RESTE côté serveur

### Décision : **conserver le clustering serveur** (`getMarkers` l.181-229), rendre nativement le même contrat `MapMarker`.

**On NE passe PAS à un clustering natif/client** (ex. `react-native-map-clustering`, clustering Mapbox GL). Raisons **non négociables** :

1. **Privacy / anti-fuite (bloquant).** Le clustering client exige d'envoyer **tous les points individuels** au device pour les regrouper localement. Or le serveur **ne renvoie JAMAIS les individus masqués** (`showOnMap=false`, `private`, bloqués) : aux zooms larges il ne renvoie qu'un **compte anonymisé** par pays/ville (l.206-214, l.975-976). Un clustering client violerait directement la règle CLAUDE.md « un compte private ne doit fuiter ni sur la map ». **Rédhibitoire.**
2. **Contrat stable & testé.** L'union `MapMarker` (country/city/individual/association/page) est déjà le contrat. Le natif consomme **exactement** la même donnée — zéro changement API, zéro migration Prisma.
3. **Comportement « tap cluster = liste » préservé.** Aujourd'hui taper un cluster ouvre `ClusterListSheet` (liste paginée), **sans zoom auto** (l.225-227, l.695-707). Le clustering natif des libs auto-zoome au tap par défaut — ce qui **casserait** ce comportement produit. En gardant le clustering serveur, le `<Marker cluster>` natif câble simplement `onPress → setSelected(marker)` → sheet liste inchangée.

**Conséquence :** le natif est un **pur changement de couche de rendu**. `geoApi.members()` et `getMarkers()` ne bougent pas. Seul ajout possible, déjà au contrat : `activeRecently` (l.34 / l.1098) pour le halo.

---

## 5. Décision 4 — Portage fonctionnel (non-régression)

Tout ce qui suit doit être **re-porté à l'identique** du WebView vers le natif. Chaque ligne = un risque de régression à tester (`ANIM-8` DoD : parité prouvée).

| Élément (réf WebView) | Cible native | Risque |
|---|---|---|
| Pin individuel avatar `divIcon` l.187-200 | `<Marker>` + enfant `<Avatar>` RN | Perf si beaucoup de markers ; cache image avatar |
| Fallback initiales l.192 | View stylée RN | Faible |
| **Halo « actif » ANIM-2** l.194-196 (`activeRecently`) | View pulsée reanimated dans le Marker | Boucle d'anim coûteuse × N → plafonner aux markers visibles |
| **Anneau de story P-04** (ANIM-8) — n'existe pas encore | Anneau dégradé autour de l'avatar ; tap → `router.push('/stories/[authorId]')` (le viewer existe : `app/stories/[authorId].tsx`) | Nécessite un champ `hasActiveStory` sur le marqueur individuel (cf. §5.1) |
| Marqueur « moi » `drawMe` l.126-135 | `<Marker>` me + `<Circle>` (cercle de zone proximité) | Cercle natif = primitive des deux libs ✅ |
| `flyTo` l.118-120 / `recenterMe` l.136-138 | `mapRef.animateCamera/animateToRegion` | Easing à recaler pour le « premium » d'ANIM-3 |
| Fan-out coords identiques l.149-169 | Re-implémenter en JS avant de passer les markers au Marker | Logique à porter telle quelle (pure fonction) |
| Association l.201-208 / Page l.209-216 (+ badge vérifié) | `<Marker>` custom | Faible |
| Cluster pays/ville l.217-229 (compte + drapeau) | `<Marker>` custom, **onPress → sheet liste** | **Ne pas** activer le clustering auto natif (§4) |
| `onMessage`/`select` l.199, 411 | `onPress` du Marker → `setSelected` | Faible |
| `bounds`/`moveend` l.110-116, 403-410 | `onRegionChangeComplete` → recalcul bounds+zoom → refetch debouncé | **Mapping region↔bounds/zoom à valider** (le debounce 250 ms l.350 reste) |
| Sheets `IndividualSheet`/`ClusterListSheet`/asso/page l.594-934 | **INCHANGÉS** (RN natif déjà, hors WebView) | ✅ Aucun portage |
| Recherche globale + filtrage l.337-397 | **INCHANGÉ** (RN, alimente `markers`) | ✅ |
| Filtres all/people/assos l.430-458 | **INCHANGÉ** | ✅ |
| Friend actions `IndividualSheet` l.757-826 | **INCHANGÉ** | ✅ |
| Animations Vague A (ANIM-1/2/3) en CSS/keyframes l.77-87 | **À réécrire en reanimated** (drop/fade/stagger, pulse, transitions cluster) | Les keyframes CSS ne survivent pas au natif ; reanimated les remplace |

### 5.1 Petit ajout backend pour P-04 (anneau de story)
Le marqueur individuel n'expose pas si l'utilisateur a une story active. Pour `ANIM-8`/P-04 il faudra un booléen `hasActiveStory` (comme `activeRecently`) sur `MapMarker.individual` :
- `apps/mobile/services/geoApi.ts` l.24-35 (type) + `packages/shared-types` si le type y est partagé.
- `apps/api/src/geo/geo.service.ts` `individuals()` l.1050+ (dériver d'une story non expirée, **sans fuiter d'horodatage** — juste le booléen).
- **Pas de migration** (lecture d'un `Story.expiresAt > now`). Privacy : un compte qui ne doit pas apparaître sur la map n'apparaît pas, anneau ou pas (gating déjà en amont).
- Livraison : déploiement API du dernier commit. Indépendant du build mobile.

---

## 6. Décision 5 — Lottie (ANIM-9)

- **Lib :** `lottie-react-native` (+ `lottie-ios`/`lottie-android` via autolinking). Compatible New Architecture. En Expo managé : pas de config plugin obligatoire (autolinking au prebuild/EAS) — à confirmer au moment du prebuild SDK 54.
- **Où l'utiliser (couche premium, NE remplace PAS reanimated d'ANIM-4) :**
  - Écrans de **succès** one-shot : ami accepté, post publié, invitation envoyée.
  - **Empty-states** illustrés animés : feed `app/(tabs)/index.tsx`, services `app/(tabs)/services.tsx`, recherche carte (vs texte sec actuel).
  - **Like premium** optionnel (au-delà du heart-burst reanimated d'ANIM-4).
- **Composants à créer :** `apps/mobile/components/ui/LottieSuccess.tsx`, `LottieEmpty.tsx`.
- **Poids des assets / bundle :**
  - `.lottie`/`.json` doivent rester légers (cibler < 30–50 KB/anim, vectoriel, **pas d'images embarquées**).
  - Bundlés via `assetBundlePatterns` (`app.json` l.16-18 = `**/*`, donc embarqués). Surveiller la taille de l'IPA/APK ; au besoin lazy-charger depuis le réseau les animations lourdes.
  - Le moteur natif lottie ajoute ~quelques centaines de KB au binaire (négligeable).
- **Perf :** les Lottie jouent sur le thread natif. Éviter les boucles infinies inutiles ; `autoPlay` + `loop={false}` pour les one-shot.

---

## 7. Décision 6 — Impact `app.json` / build, et plan de migration

### 7.1 Impact `app.json` (à appliquer SEULEMENT au moment du build, après GO)
- **Plugins natifs à ajouter** : `react-native-maps` (config plugin) ; `lottie-react-native` (si requis au prebuild). Si `@rnmapbox/maps` était finalement choisi → son plugin + token de download en secret CI.
- **Clés API** (selon provider retenu, §8) : Google Maps API key (iOS+Android si `PROVIDER_GOOGLE`). Injectée via le plugin `react-native-maps` (`config.googleMaps.apiKey`) — **secret, jamais committé**.
- **Permissions localisation : DÉJÀ présentes** (§1.4) — `react-native-maps` n'en exige pas de nouvelles ; le background reste **bloqué** (l.151), ce qui est cohérent avec la proximité foreground-only.
- **Bump version : `1.7.0` → `1.8.0`** (l.5). `runtimeVersion.policy = appVersion` (l.237) ⇒ le runtime suit automatiquement ; les anciens builds 1.7.0 ne recevront pas (et ne doivent pas recevoir) cet OTA. `buildNumber`/`versionCode` : gérés par EAS si `appVersionSource: remote` (à vérifier dans `eas.json`).

### 7.2 Effort & risques de rebuild
- **Un seul rebuild + un seul bump** couvre `ANIM-8` (carte) **et** `ANIM-9` (Lottie) — c'est tout l'intérêt du regroupement Vague B (deux modules natifs livrés ensemble = un cycle store au lieu de deux).
- **Build via CI** : `ios-build.yml` (`eas build --local` sur `macos-15`, minutes GitHub, **pas** le quota EAS épuisé) + `android-build.yml`. Déclenchement manuel.
- **Risques EAS / build :**
  - New Architecture (l.9) + module carte natif : vérifier la compat Fabric de la version de `react-native-maps` retenue (OK sur versions récentes, à pinner).
  - `expo prebuild` régénère les dossiers natifs : valider que les plugins existants (notifications, location, media-library, build-properties) cohabitent.
  - Provisioning Google Maps key (si `PROVIDER_GOOGLE`) : config dans le plugin avant build.
  - Premier build : export compliance Apple déjà réglé (`usesNonExemptEncryption: false` l.29).
  - Norton CA + login EAS `sidi30` requis côté CI/local (cf. CLAUDE.md).

### 7.3 Plan de migration séquencé
1. **ADR validé proprio** (provider + budget Mapbox tranchés, §8). ← *gate*
2. **Backend (indépendant, OTA-able)** : ajouter `hasActiveStory` au marqueur individuel (§5.1). Deploy dernier commit. Non bloquant pour la suite.
3. **Abstraction `MapCanvas`** : créer le composant qui encapsule la lib, derrière un **feature flag** (`map_engine: 'leaflet' | 'native'`). Source du flag : `AppSetting` distant (déjà utilisé pour proximité) ou `expo-constants`. Par défaut `leaflet` → zéro régression tant que le natif n'est pas prouvé.
4. **Portage natif** (§5) dans `MapCanvas` : pins avatars, halo, cercle « moi », flyTo/recenter, fan-out, clusters (rendu only), anneau story P-04, ré-écriture reanimated des anims Vague A. Sheets/recherche/filtres réutilisés tels quels.
5. **Lottie** (`ANIM-9`) : composants `LottieSuccess`/`LottieEmpty` + assets.
6. **`app.json`** : plugins + clé + bump 1.8.0 (§7.1).
7. **Build CI** (`ios-build.yml` / `android-build.yml`) **après GO proprio** — action sortante.
8. **Validation TestFlight/Internal** flag natif ON : parité (sheets, recherche, filtres, friend actions), 60 fps, anneau story tap→story, proximité (cercle/recenter). Chaîne `bug-hunter → fixer → e2e-tester`.
9. **Bascule** : flag par défaut `native`.
10. **Nettoyage** : suppression de `LEAFLET_HTML` + écran fallback + `react-native-webview` si plus aucun autre usage (à vérifier — la WebView peut servir ailleurs).

### 7.4 Rollback
- **Pendant la validation** : feature flag `map_engine` distant → bascule `native → leaflet` **sans rebuild** (le code Leaflet reste embarqué dans le build 1.8.0). C'est la sécurité principale.
- **Si défaut natif post-release** : flip du flag distant ramène tout le monde sur Leaflet instantanément.
- **OTA** : un correctif JS-only sur la carte native (post-1.8.0) repart en OTA canal sur le runtime 1.8.0 — pas de nouveau build tant qu'aucun natif ne change.

---

## 8. Questions ouvertes — à trancher par le proprio

1. **Budget Mapbox.** Accepte-t-on une **dépense récurrente au MAU** pour le rendu vector « Snap authentique » (`@rnmapbox/maps`), ou on reste **gratuit** avec `react-native-maps` (reco) ? → conditionne la lib finale.
2. **Provider sur iOS.** Si `react-native-maps` : **Apple Maps sur iOS (0 clé, look natif Apple)** OU **`PROVIDER_GOOGLE` partout** (une clé Google gratuite sur mobile, mais SDK Google sur iOS) pour un **style « Snap » homogène** via `customMapStyle` ? Reco : Google partout + style JSON.
3. **Clé Google Maps.** Si provider Google : OK pour créer/gérer une **Google Maps API key** (restreinte par bundle id / package) et la stocker en secret CI (jamais committée) ?
4. **Story ring P-04.** Confirme-t-on l'ajout backend `hasActiveStory` (§5.1) dans ce lot, ou P-04 est différé après la migration de base ?
5. **Timing du rebuild.** GO pour grouper `ANIM-8` + `ANIM-9` dans **un seul build 1.8.0** via le CI local (minutes GitHub Actions) ?

---

## 9. Conséquences

- ✅ Carte 60 fps native, pins avatars/anneau story/halo réellement « façon Snap », gestes fluides.
- ✅ Contrat geo et clustering serveur **inchangés** → zéro migration, privacy préservée.
- ✅ Sheets / recherche / filtres / friend actions **réutilisés tels quels**.
- ✅ Moteur encapsulé (`MapCanvas`) → choix de lib **réversible**, fallback Leaflet par flag.
- ✅ Web non impacté (pas de carte web).
- ⚠️ **Dette/contrainte** : un rebuild EAS + bump 1.8.0 obligatoires (action sortante). Module carte natif à maintenir au fil des SDK Expo.
- ⚠️ Les animations Vague A (CSS keyframes WebView) devront être **réécrites en reanimated** lors du portage natif.
- ⚠️ Si provider Google : gestion d'une clé API (secret) et dépendance au SDK Google sur iOS.

---

## 10. Décision finale (résumé)

| Sujet | Décision |
|---|---|
| Lib | **`react-native-maps`** (gratuit, Expo-natif, New Arch). `@rnmapbox/maps` = alternative premium si budget validé (Q1). Moteur encapsulé `MapCanvas` ⇒ swap réversible. |
| Migration vs cohabitation | **Migration** sur mobile (fallback Leaflet par feature flag le temps de valider). **Web : non concerné** (pas de carte web). |
| Clustering | **Reste serveur.** Native = rendu only. Privacy + contrat + « tap cluster = liste » préservés. |
| Lottie | `lottie-react-native`, couche **premium** (succès, empty-states, like premium) — ne remplace pas reanimated. |
| Build | **Un** rebuild + **un** bump **1.7.0 → 1.8.0** couvrant ANIM-8 + ANIM-9, via CI `--local`. **Après GO proprio.** |

> **STOP — aucun code de prod, aucun build tant que cet ADR n'est pas validé (§8).**
