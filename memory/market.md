# Analyse Marché — Vague d'améliorations majeures NigerConnect

**Date :** 2026-07-02
**Analyste :** market-researcher-agent
**Domaine analysé :** Réseau social diaspora (feed + carte + chat + entraide/services) — tour 360° ciblé sur 4 axes demandés par le propriétaire
**Périmètre :** (1) Lives/streaming vidéo, (2) Services/marketplace secondaire, (3) Profil avec beaucoup d'amis, (4) Gaps spécifiques diaspora nigérienne
**Note de méthode :** ceci est une analyse **ciblée** (pas un audit généraliste de tout le marché social), demandée en complément du travail déjà engagé (voir `memory/status.json`, sprints S1/S2 et vagues d'animation en cours). Elle nourrit le prochain arbitrage de backlog du `gwani-orchestrator`.

---

## Synthèse exécutive

Les 4 géants (Instagram, Facebook, TikTok, Snapchat) ont chacun résolu le problème de **découverte du live** différemment : IG mise sur l'anneau/badge en tête de la barre de stories + notif push, Snapchat sur un **carrousel d'événements en cours directement sur la carte** ("Map Explore"), TikTok sur le multi-guest poussé à l'extrême (jusqu'à 9) et sur un compteur "X personnes que tu suis sont en live". Le point commun : le live n'est jamais un onglet séparé, il **s'incruste** dans les surfaces déjà fréquentées (feed, stories, carte). C'est une excellente nouvelle pour NigerConnect : la carte interactive existe déjà (Leaflet, anneaux de story et halo "actif récent" prévus en ANIM-2/ANIM-8) — le pattern Snap Map Explore est directement réutilisable sans repartir de zéro sur l'UI de découverte. Le vrai coût est ailleurs : l'infrastructure de streaming (media server, TURN/STUN, multi-guest) est un **gros pari technique** qui impose un module natif (rebuild EAS + bump obligatoire).

Sur le marketplace, le marché a déjà tranché : Facebook Marketplace, Nextdoor et Leboncoin utilisent **un seul formulaire** pour "à vendre" et "gratuit" — seul le champ prix change de comportement (numérique → "Gratuit"). C'est exactement le pattern qu'il faut pour un positionnement "entraide au centre, marketplace discrète" : un toggle Gratuit/Payant en progressive disclosure, pas deux flux séparés. Nextdoor va plus loin avec un assistant IA qui suggère catégorie/titre/prix à partir des photos — piste V2 intéressante, pas un prérequis V1.

Sur le profil, IG et FB partagent le même pattern (aperçu limité + compteur cliquable → écran dédié avec recherche), mais Snapchat s'en écarte volontairement en gardant les listes d'amis peu exposées, pour des raisons de confidentialité — un signal utile pour une diaspora où l'exposition publique du réseau social peut être sensible (politique, sécurité, statut migratoire).

La vraie opportunité de différenciation n'est dans aucun des 3 géants généralistes : c'est le **contexte diaspora lui-même**. Les communautés nigériennes s'organisent aujourd'hui de façon disparate sur des groupes WhatsApp (informations administratives, entraide, taux de change informels type Lemonade Finance) faute d'outil dédié structuré. Peu d'apps (Agbora est la seule tentative notable identifiée) adressent frontalement ce besoin, et aucune n'a la granularité "ville d'accueil" + multilingue haoussa/zarma que NigerConnect peut apporter à faible coût technique. C'est là que se trouvent les quick wins à plus fort impact perçu.

---

## AXE 1 — Lives / streaming vidéo en direct

### Patterns qui marchent chez les leaders

| Pattern | Qui le fait | Description observée |
|---|---|---|
| Anneau + badge de découverte | Instagram | Anneau coloré violet/rose autour de l'avatar + badge "LIVE" ; le profil qui démarre un live saute en tête de la barre de stories |
| Notification push immédiate | Instagram | "[Username] est en live" pour les comptes suivis avec notifs activées, tap direct pour rejoindre |
| Badge sur recherche/hashtag | Instagram | Badge "Live" affiché à côté du profil dans les résultats de recherche et hashtags dédiés |
| Compteur "X abonnements sont en live" | TikTok | Icône de notification dédiée qui indique combien de comptes suivis sont actuellement en direct |
| Réactions flottantes animées | Facebook | Émojis (like, love, haha, wow, sad, angry) qui montent en overlay depuis le bas de l'écran, en temps réel, déclenchés par les spectateurs |
| Compteur de viewers en direct | IG / FB / TikTok | Icône œil + nombre affiché en permanence sur le player, renforce l'effet de foule/urgence |
| Chat live défilant | Tous | Commentaires qui défilent en overlay bas de l'écran, généralement avec fade-out après quelques secondes sauf messages épinglés |
| Multi-guest co-diffusion | Instagram (jusqu'à 3 invités + hôte = 4 à l'écran) / TikTok (jusqu'à 9, layouts panel/grille) | Le host peut inviter des spectateurs à rejoindre l'écran en grille ; combo "co-host + guests" chez TikTok pour des collabs à 2 hôtes + invités |
| **Découverte via carte ("Map Explore")** | **Snapchat** | Carrousel d'événements en cours en bas de l'écran carte, cliquable, recentre automatiquement sur le lieu ; les Stories de lieux apparaissent quand on zoome sur la carte |

### Valeur déduite pour la diaspora nigérienne

- **Événements pays/communauté en temps réel** : fête nationale du Niger, événement consulaire, veillée religieuse, match de foot (AFCON) — le live donne une **preuve de présence/authenticité** qu'un post statique n'a pas, essentiel pour une communauté dispersée géographiquement qui veut "vivre l'événement ensemble" à distance.
- **Entraide urgente et crédibilité** : un live pour une collecte de fonds (décès, urgence médicale, catastrophe au pays) crée une **confiance immédiate** — les diasporas s'appuient aujourd'hui sur des lives Facebook/WhatsApp non structurés pour ce type d'appel ; NigerConnect peut capter cet usage nativement.
- **Réunions d'association/ville d'accueil** : un bureau associatif (association des Nigériens de Paris, de Lyon, etc.) peut diffuser une AG ou une annonce administrative en direct à ses membres géolocalisés dans la même ville.
- **La carte comme surface de découverte est un atout déjà en construction** : le pattern "Map Explore" de Snapchat se greffe presque naturellement sur l'infra carte déjà planifiée (ANIM-1 pins animés, ANIM-2 halo actif-récent, ANIM-8 carte native + anneau de story) — un live pourrait simplement être un marqueur pulsant spécial + un carrousel "Lives en cours près de chez vous / dans votre ville d'accueil" en bas de la carte.

### Recommandations concrètes

| Opportunité | Pattern concurrent source | Valeur diaspora | Faisabilité |
|---|---|---|---|
| Anneau "LIVE" distinct de l'anneau story (réutilise l'infra rings déjà prévue ANIM-8) | Instagram (anneau+badge) | Reconnaissance immédiate d'un live en cours | S — une fois le live existant, c'est une variante de composant déjà planifié |
| Notification push "X est en live" pour les amis proches | Instagram | Rappelle un événement communautaire en cours | S — réutilise le système de notifications existant |
| Carrousel "Lives en cours" en bas de la carte, filtrable par ville d'accueil | Snapchat Map Explore | Découverte géographique naturelle, cohérente avec le positionnement diaspora-par-ville | M — UI carte + endpoint API listant les lives actifs par zone |
| Réactions flottantes + compteur viewers | Facebook, IG, TikTok | Engagement temps réel, sentiment de foule/soutien pendant une collecte | M — WebSocket déjà en place pour le chat/réactions (cf. reactions posts/commentaires livrées récemment) |
| Chat live overlay | Tous | Interaction en direct pendant l'événement | M — extension du pattern WS existant |
| Multi-guest (jusqu'à 3 invités à l'écran) | Instagram Live / TikTok multi-guest | Diffusions à plusieurs voix (ex. panel associatif, interview croisée pays/diaspora) | L — nécessite gestion de plusieurs flux média synchronisés, complexité SDK non triviale |
| **Infrastructure de live elle-même (ingest, lecture, multi-guest)** | — | Prérequis technique de tout ce qui précède | **XL — module natif obligatoire, rebuild EAS + bump version, nouvelle brique infra backend** |

### Stack technique — recommandation

Le marché du live temps réel s'est standardisé autour de SDK WebRTC managés ou auto-hébergés :

| Option | Avantage | Contrainte |
|---|---|---|
| **LiveKit (self-hosted)** | Open-source, pas de coût par minute si hébergé sur le VPS existant, SDK React Native officiel, gère nativement le multi-guest en grille | Ajoute un service à opérer (media server + TURN/STUN) sur l'infra Hetzner/VPS actuelle — cohérent avec la philosophie "on gère notre infra" du projet |
| Agora | Réseau RTC mondial (200+ pays), très faible latence | Coût par minute, dépendance à un tiers pour une fonctionnalité cœur |
| Mux | Excellent pour du broadcast 1→N simple | Peu adapté au multi-guest interactif demandé (jusqu'à 3 invités) |

**Recommandation** : LiveKit self-hosted colle le mieux à l'infra VPS/Docker existante (`/opt/apps/nigerConnect`) et évite un coût variable par minute — cohérent avec un produit communautaire à marge faible. À valider via une spike/ADR (`gwani-architect`) avant tout engagement, comme cela a déjà été fait pour la carte native (ANIM-7).

---

## AXE 2 — Services / marketplace secondaire (entraide au centre)

### Patterns qui marchent

| Pattern | Qui le fait | Description |
|---|---|---|
| Un seul formulaire, prix optionnel | Facebook Marketplace / Nextdoor / Leboncoin | Le champ prix devient "Gratuit" au lieu d'être retiré — pas deux flux de création distincts |
| Multi-photos (jusqu'à 10) | Facebook Marketplace | Galerie, prise de vue multi-angle recommandée dans l'UX d'aide |
| Sections dédiées mais mêmes données | Nextdoor ("For Sale & Free" → rebrandé "Nextdoor Finds" avec section "Free Finds" séparée) | Organisation différente en surface (onglets/filtres), mais le modèle de données et le formulaire restent unifiés |
| Catégorisation guidée | Facebook Marketplace (Objet / Véhicule / Immobilier / Emploi + sous-catégories) | Réduit la friction de saisie, améliore la découvrabilité |
| Suggestions assistées par IA | Nextdoor (assistant GenAI suggère catégorie, titre, prix, description à partir des photos) | Réduit fortement la friction de création — tendance récente (2025-2026) |
| Réactions et commentaires sur les annonces | Nextdoor | Traite l'annonce comme un post social, pas comme une fiche produit froide — cohérent avec un positionnement "entraide" plutôt que "petites annonces" |

### Ce qui rend un flux de création "intelligent" et élégant

- **Formulaire adaptatif par intention plutôt que par prix** : au lieu de démarrer par "Vendre", proposer 3 verbes d'entrée cohérents avec le positionnement entraide : **"Proposer un coup de main / service"**, **"Donner"**, **"Demander de l'aide"** — le champ prix n'apparaît (toggle progressive disclosure) que si l'utilisateur choisit une prestation payante. C'est le même modèle de données que Nextdoor/Leboncoin (prix optionnel), mais une porte d'entrée plus chaleureuse que "Sell".
- **Discrétion du positionnement** : ne pas donner de tab dédié en bottom nav (contrairement à FB Marketplace) — accès via le "+" de création ou intégré aux pages de ville/groupe, pour rester cohérent avec "cœur = entraide communautaire, marketplace discrète".
- **Traiter l'annonce comme un post, pas comme une fiche produit** (pattern Nextdoor commentaires/réactions) : permet aux utilisateurs de réagir/commenter une offre d'entraide comme un post normal du feed, renforçant le lien social plutôt que la transaction pure.

### Opportunités

| Opportunité | Pattern concurrent source | Valeur diaspora | Faisabilité |
|---|---|---|---|
| Toggle Gratuit/Payant en progressive disclosure (formulaire unique) | Nextdoor, Leboncoin | Cœur du positionnement demandé — un seul flux à maintenir | S — champ optionnel côté schema Zod/Prisma déjà probablement modélisable |
| 3 verbes d'entrée chaleureux (Proposer / Donner / Demander) au lieu de "Vendre" | Nextdoor "Sell or give away" étendu | Aligne le vocabulaire produit sur l'entraide, pas le commerce | S — copywriting + branchement conditionnel simple |
| Galerie multi-photos | Facebook Marketplace | Standard attendu, réduit la méfiance sur une offre/demande | S/M — probablement déjà couvert par l'infra médias posts existante (S3Service) |
| Annonce traitée comme post (réactions/commentaires) | Nextdoor | Renforce le lien social, cohérent avec le feed déjà riche en réactions | M — réutilise le système de réactions emoji déjà livré (commit récent "reactions on comments + chat") |
| Suggestion assistée (catégorie/titre depuis photo) | Nextdoor GenAI | Réduit la friction de création | L — nécessite un modèle IA (vision), à considérer V2+ |

---

## AXE 3 — Profil avec beaucoup d'amis

### Patterns observés

| Pattern | Qui le fait | Description |
|---|---|---|
| Aperçu limité + compteur cliquable | Instagram / Facebook | Le nombre "X abonnés"/"X amis" est affiché en haut du profil et sert de point d'entrée vers un écran dédié |
| Écran dédié paginé avec recherche | Instagram | Tap sur le compteur ouvre une liste avec barre de recherche pour filtrer parmi des centaines/milliers d'entrées |
| Tri par pertinence, pas chronologique | Instagram | Les amis en commun ("mutuals") remontent en tête de liste quand on consulte le profil d'un tiers |
| Grille d'aperçu "Box of Nine" | Facebook | Grille 4x2/3x3 d'amis affichée directement sur le profil, pondérée par interactions/amis communs, avec un lien "Voir tous les amis" vers l'écran complet |
| **Retenue volontaire sur l'exposition du réseau** | **Snapchat** | Contrairement à IG/FB, Snapchat expose beaucoup moins la liste d'amis publiquement — logique de confidentialité par défaut |

### Recommandations pour NigerConnect

| Opportunité | Pattern source | Valeur diaspora | Faisabilité |
|---|---|---|---|
| Grille d'aperçu (6-9 avatars) sur le profil + compteur cliquable | Facebook "Box of Nine" | Standard attendu, évite un profil qui semble vide même avec beaucoup d'amis | S/M — front principalement, réutilise l'API friends existante avec pagination |
| Écran dédié paginé avec recherche | Instagram | Nécessaire dès que le réseau d'un utilisateur dépasse ~20-30 amis | S/M |
| **Filtre par ville d'accueil sur la liste d'amis** ("Amis à Paris", "Amis à Lyon"...) | Différenciateur propre au contexte diaspora — aucun concurrent généraliste ne le fait nativement | Très fort : la diaspora s'organise justement par ville d'accueil, retrouver "qui de mes contacts est dans ma ville" est une valeur directe | M — filtre sur un champ ville déjà probablement présent au profil |
| Tri par pertinence (mutuels d'abord) | Instagram | Aide à la découverte de connexions communes (même village, même ville d'accueil) | M |
| **Option de confidentialité "masquer ma liste d'amis"** | Snapchat (retenue par défaut) | Sensible pour une partie de la diaspora (visibilité politique, statut migratoire) — s'aligne avec les niveaux `public/friends/private` déjà en place dans le projet | S — extension du modèle de confidentialité déjà existant, pas une nouvelle brique |

---

## AXE 4 — Gaps diaspora nigérienne (différenciation vs les géants)

### Constat marché

Aucun des géants généralistes (IG/FB/TikTok/Snap) n'adresse la diaspora nigérienne comme communauté structurée. La coordination réelle se fait aujourd'hui de façon **informelle et fragmentée** :
- Groupes WhatsApp pour les annonces administratives, l'entraide, et même les taux de change informels (les diasporas échangent RIB et négocient des taux via WhatsApp faute d'outil dédié).
- Des solutions type **Lemonade Finance** émergent spécifiquement pour capter ce besoin de transferts informels, preuve que la douleur est réelle et non résolue par les outils généralistes.
- **Agbora** est la seule tentative identifiée de réseau social dédié à la diaspora africaine au sens large (feed, microblogging, sondages, chat, recherche avancée) — mais généraliste "Afrique", pas nigérien/multilingue haoussa-zarma, donc pas un concurrent direct frontal mais un signal que le marché existe.

### Opportunités différenciantes

| Opportunité | Justification | Valeur diaspora | Faisabilité |
|---|---|---|---|
| **Groupes par ville d'accueil** (ex. "Nigériens de Paris", "Nigériens de Cotonou") | Déjà amorcé au roadmap (ANIM-9 mentionne "groupes"), aucun concurrent généraliste ne structure nativement par ville d'accueil | Cœur de l'organisation réelle de la diaspora (associations locales, entraide de proximité) | M — modèle de données groupe probablement déjà en cours de conception |
| **Interface multilingue haoussa / zarma / français** | Aucun des géants (IG/FB/TikTok/Snap/WhatsApp) ne propose d'interface en haoussa ou zarma | Inclusion forte de la génération plus âgée ou moins à l'aise en français — différenciateur émotionnel fort à coût technique faible | **S — i18n de strings, pas de nouvelle logique métier** — bon candidat quick win |
| **Canal d'annonces "officielles" vérifiées** (info consulaires, taux de change, alertes sécurité/voyage) porté par des comptes vérifiés/ambassadeurs (badge déjà existant) | Répond au besoin identifié de transfert d'info pays actuellement dispersé sur WhatsApp | Fiabilise l'info par rapport aux rumeurs de groupes WhatsApp non modérés | M — réutilise le système de badges vérifiés existant + un type de post épinglé |
| **Post "Entraide" avec sous-types (Don / Demande d'aide / Collecte / Service)** unifiant marketplace et entraide sous une même taxonomie | Cohérent avec le positionnement "entraide au centre" demandé pour l'Axe 2 | Un seul endroit pour "qui a besoin de quoi" plutôt que dispersé entre feed et groupes WhatsApp | M |
| **Annuaire de compétences/métiers entre membres** ("qui sait faire quoi" : électricien, traducteur, chauffeur, garde d'enfants) | Extension naturelle du module services, pattern proche de Nextdoor (compétences de voisinage) mais orienté diaspora | Entraide pratique concrète, forte rétention | M/L |
| **Calendrier d'événements communautaires avec RSVP**, connecté aux Lives pour les proches ne pouvant pas se déplacer (mariage, baptême, fête nationale) | Combine Axe 1 (live) et différenciation diaspora | Très fort : "vivre l'événement à distance" est une douleur diaspora classique | L — dépend de l'infra live (Axe 1) |
| Facilitation de confiance pour transferts informels (profils vérifiés, avis) **sans jamais gérer l'argent nous-mêmes** | Lemonade Finance prouve la demande, mais gérer des paiements = risque réglementaire lourd | Répond à un vrai besoin sans s'exposer à la régulation des transferts d'argent | **Gros pari, à éviter en V1** — hors périmètre recommandé pour l'instant |

---

## Short-list priorisée

### Quick wins (fort impact perçu, effort S/M, pas de rebuild natif)

1. **Formulaire services unique avec toggle Gratuit/Payant** (Axe 2) — cœur du positionnement demandé, effort S.
2. **3 verbes d'entrée "Proposer / Donner / Demander"** au lieu de "Vendre" (Axe 2) — copywriting + branchement, effort S.
3. **Grille d'aperçu d'amis + écran dédié paginé avec recherche et filtre "ville d'accueil"** (Axe 3) — réutilise l'API friends existante, effort S/M.
4. **Option de confidentialité "masquer ma liste d'amis"** (Axe 3) — extension du modèle privacy déjà en place.
5. **Interface multilingue haoussa/zarma** (Axe 4) — i18n de strings, aucun concurrent ne le fait, fort effet différenciant/inclusion pour un coût très faible.
6. **Annonces traitées comme des posts** (réactions/commentaires réutilisés) (Axe 2) — réutilise le système de réactions déjà livré.
7. **Canal d'annonces officielles vérifiées** avec badge ambassadeur existant (Axe 4) — réutilise l'infra badges.

### Gros paris (fort effort, natif/infra, à cadrer via spike/ADR avant tout engagement)

1. **Infrastructure de live streaming complète** (LiveKit self-hosted, multi-guest jusqu'à 3, chat/réactions temps réel, découverte via carrousel sur la carte) (Axe 1) — module natif, rebuild EAS + bump obligatoire, nouvelle brique infra backend/VPS. Le plus gros pari de la vague mais aussi la plus forte valeur perçue (parité Instagram/Snap + cas d'usage diaspora très concrets : collectes, événements, AG associatives).
2. **Calendrier d'événements communautaires + RSVP connecté au live** (Axe 4) — dépend du live, à séquencer après.
3. **Suggestion assistée par IA pour les annonces** (catégorie/titre/prix depuis photo) (Axe 2) — nécessite un modèle vision, V2+.
4. **Annuaire de compétences/métiers** (Axe 4) — utile mais peut attendre que le module services soit stabilisé.
5. **Facilitation de confiance pour transferts informels** (Axe 4) — écarté du périmètre recommandé (risque réglementaire), à ne considérer qu'après validation juridique explicite du propriétaire.

### Recommandation de séquencement

Étant donné que la carte (Leaflet → potentiellement native) et le système de réactions/badges sont déjà en cours de construction (S-ANIM-1/2), les quick wins listés ci-dessus s'insèrent naturellement dans la vague en cours sans attendre le live. Le live lui-même mérite un **ADR dédié** (`gwani-architect`, sur le modèle d'ANIM-7 pour la carte native) avant tout engagement de développement, étant donné son impact sur l'infra VPS et l'obligation de rebuild natif.

---

## Sources

| Source | URL | Type |
|---|---|---|
| Comment découvrir/regarder les lives sur Instagram | https://buzzvoice.com/blog/how-to-find-lives-on-instagram/ | Guide |
| À propos des badges Instagram | https://help.instagram.com/939561509841026/ | Documentation officielle |
| TikTok Support — Multi-guest | https://support.tiktok.com/en/live-gifts-wallet/tiktok-live/tiktok-live-multi-guest | Documentation officielle |
| Introduction au Multi-guest TikTok | https://www.tiktok.com/live/creators/en-US/article/Multi-guest_Introduction_en-US | Documentation officielle |
| Réactions live Facebook (overlay animé) | https://getstream.io/blog/swift-animated-emojis/ | Article technique |
| Snap ajoute des outils de découverte à Snap Map (Map Explore) | https://www.socialmediatoday.com/news/snap-adds-new-discovery-tools-to-snap-map-highlighting-happening-events/519792/ | Presse tech |
| Snap Map — Snapchat Support | https://help.snapchat.com/hc/en-us/sections/5689786363284-Snap-Map | Documentation officielle |
| Comment vendre sur Facebook Marketplace en 2025 | https://www.threecolts.com/blog/how-sell-facebook-marketplace/ | Guide |
| Facebook Marketplace 2026, guide approfondi | https://groupboss.io/blog/facebook-marketplace/ | Guide |
| Bonnes pratiques For Sale & Free — Nextdoor | https://help.nextdoor.com/s/article/Best-practices-For-Sale-Free | Documentation officielle |
| Nextdoor étend son assistant GenAI à For Sale & Free | https://about.nextdoor.com/press-releases/nextdoors-genai-assistant-expands-to-for-sale-free-listings | Communiqué officiel |
| Nextdoor Free Finds | https://www.engadget.com/nextdoor-free-finds-neighborhood-items-151424761.html | Presse tech |
| Ordre de la liste d'abonnements Instagram (mutuals) | https://insights.vaizle.com/instagram-following-list-order/ | Article |
| Followers/Following UI — inspiration design | https://mobbin.com/explore/mobile/screens/followers-following | Bibliothèque design |
| Box of Nine — algorithme des amis affichés Facebook | https://www.vice.com/en/article/facebooks-magic-formula-for-determining-your-9-top-friends/ | Presse tech |
| Lemonade Finance — remittances diaspora Afrique | https://qz.com/africa/2084190/how-lemonade-finance-serves-africas-diasporas-remittance-needs | Presse |
| Diaspora africaine et groupes WhatsApp (double nationalité) | https://www.thecitizen.co.tz/tanzania/diaspora/whatsapp-groups-new-frontiers-for-diaspora-still-seeking-dual-citizenship-4968170 | Presse |
| Agbora — réseau social diaspora africaine | https://www.appsafrica.com/agbora-launches-africas-social-network-with-hopes-of-connecting-africa-and-the-african-diaspora/ | Presse tech |
| LiveKit vs Agora — analyse coût 2026 | https://www.forasoft.com/blog/article/livekit-vs-agora-cost-analysis | Comparatif technique |
| Meilleurs SDK de live streaming pour développeurs | https://www.mux.com/articles/best-live-streaming-sdk-and-api-providers-for-developers | Comparatif technique |

---

## Note sur l'état du pipeline

Ce document a été produit à la demande directe (recherche marché ciblée pour alimenter la prochaine vague de backlog), alors que `memory/status.json.current = "SPRINT_PLANNED"` (sprint S2 en cours, vagues d'animation planifiées). Conformément au protocole standard de cet agent, une exécution en tout début de pipeline attend `current === "DRAFT"` — ce n'est pas le cas ici puisque le projet est déjà en vol. **Je n'ai donc pas modifié `memory/status.json`** (ni forcé `READY_FOR_SPEC`) pour ne pas perturber le suivi de sprint actif du `gwani-orchestrator`. C'est à l'orchestrateur de décider comment intégrer ces findings (nouveau sprint dédié Live, ou items ajoutés au backlog existant).

---
---

# 2026-08-20 — Espace association

**Date :** 2026-08-20
**Analyste :** market-researcher-agent
**Domaine analysé :** Back-office web « espace association » pour la diaspora nigérienne — publications/membres/annonces (images+vidéo), certification visuelle association, bureau exécutif, adhérents, carte d'adhérent vérifiable, liste de diffusion (e-mail + notif in-app), mini-site public généré.
**Périmètre :** analyse ciblée (pas un audit généraliste), demandée en complément du travail déjà engagé sur NigerConnect (voir sections précédentes de ce document).
**Note de méthode :** conformément à ma mission, cette section est **ajoutée** à la fin du fichier existant sans rien écraser. `memory/status.json.current` n'est pas `DRAFT` (le pipeline est déjà en vol, sprint S-BETA livré/deployé dark) — comme pour la section 2026-07-02 ci-dessus, je n'ai **pas** touché `memory/status.json` pour ne pas perturber le suivi actif du `gwani-orchestrator`. C'est à lui de décider de l'intégration au backlog.

---

## 1. Tableau des concurrents/références — ce qu'on copie / ce qu'on ignore, et pourquoi

| Référence | Catégorie | Ce qu'on COPIE | Ce qu'on IGNORE | Pourquoi |
|---|---|---|---|---|
| **HelloAsso** | Leader FR gratuit, très utilisé par la diaspora africaine | (1) Modèle **100% gratuit pour l'association** (aucune commission imposée, aucun abonnement) ; (2) **mini-site automatique** généré à partir des données de l'asso (URL prévisible, campagnes/adhésions/annonces affichées automatiquement) ; (3) **carte d'adhérent PDF envoyée par e-mail** avec QR code intégré, générée automatiquement depuis les infos membre ; (4) collecte de cotisation en ligne **optionnelle**, jamais imposée | Le paiement en 3x sans frais / mensualisé (nécessite un partenaire bancaire tiers, hors périmètre « zéro payant » côté NigerConnect) | HelloAsso a déjà résolu le problème « comment rester gratuit pour l'asso » avec un modèle prouvé à l'échelle (contribution volontaire du payeur, jamais de commission imposée) — directement transposable à un contexte non-marchand comme le nôtre (pas de paiement du tout en V1, cf. §5) |
| **AssoConnect** | Payant, complet (gestion membres + bureau + compta) | La **structuration des rôles du bureau exécutif** (président, trésorier, secrétaire… avec droits différenciés) — pattern de gouvernance à reprendre tel quel dans le modèle de données | La **comptabilité intégrée** (28 €TTC/mois minimum, jusqu'à 112 €TTC/mois pour 1000 contacts) et la tarification liée au nombre de contacts | Coûte cher dès qu'une asso grandit (tarif indexé sur la taille de la base de contacts) — inadapté à des associations de diaspora à faible budget. Confirme que la comptabilité complète est un gouffre de complexité à **ne pas** reproduire en V1 : les utilisateurs eux-mêmes signalent une courbe d'apprentissage lourde et des liens entre modules peu clairs |
| **Facebook Pages / Groupes** | Usage réel actuel des associations diaspora | Rien à copier techniquement — mais **comprendre pourquoi elles y restent** : c'est gratuit, viral, déjà installé chez tous les membres, zéro friction de création | La dépendance à une plateforme qu'on ne contrôle pas | Les Pages Facebook ont un **reach organique en chute libre** (0,5 à 2% de la portée vue en 2026, contre les Groupes qui restent robustes) — et la vérification devient payante (Meta Verified dès 14,99 $/mois/page). C'est exactement la frustration qu'un espace association dédié doit adresser : ne pas dépendre d'un algorithme tiers pour joindre ses propres membres |
| **Meetup** | Événements + communautés payant pour les organisateurs | Le pattern RSVP + rappel avant événement | Le modèle payant pour les organisateurs de groupes (abonnement mensuel) | Confirme l'utilité du mini-site événementiel, mais le modèle économique est à l'opposé de la contrainte « zéro payant » du projet |
| **Mobilizon** (Framasoft/Kaihuri, ActivityPub) | Open-source, auto-hébergeable | La philosophie « pas de pub, pas de tracking, pas d'exploitation de données » + le concept de **page d'événement publique partageable** sans compte requis pour consulter | La fédération ActivityPub elle-même (complexité inutile pour un besoin mono-instance NigerConnect) | Preuve qu'un outil communautaire événementiel 100% gratuit et auto-hébergé est un modèle viable et déjà éprouvé — aligne avec la règle « zéro solution payante » du projet |
| **Gancio** | Open-source, agenda communautaire local, auto-hébergeable | Le concept d'« agenda partagé » minimaliste avec modération légère (les événements soumis par les membres sont validés par un admin avant publication) | — | Pattern simple et peu coûteux en dev, bon candidat pour la brique « annonces/événements » du mini-site association si on veut rester minimal |
| **Facebook (badge Business)** | Patterns de certification visuelle | Historiquement Facebook avait un badge **gris** distinct du badge **bleu** pour distinguer organisation/page vs personne/marque notable — badge retiré en 2023 car les utilisateurs ne comprenaient pas sa signification | Le badge gris lui-même (abandonné) | Leçon directe et importante : une couleur/forme distincte **sans libellé explicite au tap** crée de la confusion et finit par être retirée. Toute certification association doit avoir un libellé clair au tap, pas seulement une couleur |
| **LinkedIn** | Patterns de certification visuelle | Différenciation **par couleur, même forme** : coche **grise** pour les pages entreprise vérifiées vs coche **bleue/standard** pour les profils personnels vérifiés | — | Pattern simple, peu coûteux à implémenter (un seul composant badge, une prop couleur) et déjà culturellement compris par une partie des utilisateurs pro |
| **X (ex-Twitter)** | Patterns de certification visuelle | Différenciation **double signal** : coche **dorée** (organisation) vs coche **bleue** (individu) **+ avatar carré** (organisation) vs **avatar rond** (individu) — la forme de l'avatar seule permet de distinguer un compte organisation sans même regarder la couleur/le badge | Le modèle payant (Gold Check dès 200 $/mois pour les organisations, Blue Check dès 8 $/mois) | C'est le pattern le plus actionnable et le plus efficace visuellement (double codage couleur + forme = reconnaissable même par un utilisateur daltonien ou en scan rapide), et il est **gratuit à reproduire** puisqu'il ne s'agit que d'un choix de composant UI, aucune dépendance à un service payant |
| **Instagram** | Patterns de certification visuelle | Rien de différenciant à copier | Le badge unique (même coche bleue pour compte personnel notable et compte business) — pattern jugé **insuffisamment différenciant** | Instagram ne distingue PAS visuellement organisation vs personne avec la même forme de badge — exactement le problème qu'on veut éviter pour ne pas confondre un compte perso vérifié et un compte association |
| **Apple Wallet / Google Wallet** | Cartes numériques | Le **pattern de vérification dynamique** : le pass Wallet pointe vers un serveur qui peut invalider/mettre à jour la carte à distance (révocation immédiate d'une adhésion expirée sans réémettre de carte) | L'intégration elle-même en **V1** (voir §4 — coût de développement non trivial, à réserver en V2) | Apple Wallet exige un compte Apple Developer payant (99 $/an) — **déjà payé** par le projet pour l'app mobile (Team ID 4SRJRX4N45), donc coût marginal nul si on choisit d'y aller plus tard, via une lib open-source auto-hébergée (`passkit-generator`, Node.js, signature avec le certificat Pass Type ID existant). Google Wallet API : compte émetteur **gratuit** (vérification business requise, pas d'abonnement). Les deux respectent la règle « zéro payant » si on les auto-héberge — mais l'effort de mise en place (certificats, JWT, templates .pkpass) ne se justifie pas en V1 |

---

## 2. Frustrations récurrentes exploitables (3-5, avec sources)

1. **Aucun annuaire de membres fiable sur Facebook.** Un admin de groupe/page Facebook n'a **aucun outil natif** pour exporter ou consulter une vraie liste structurée de ses membres (nom, contact, statut d'adhésion) — les guides trouvés recommandent de copier-coller manuellement ou de passer par un outil tiers non officiel (PhantomBuster). *Implication pour NigerConnect* : l'espace association doit fournir nativement un **annuaire d'adhérents structuré et exportable** (CSV) — c'est une valeur immédiatement perçue par tout responsable associatif qui gère aujourd'hui ses membres dans un tableur à part.
   Source : [phantombuster.com/blog/social-selling/how-to-export-facebook-group-members-to-a-csv](https://phantombuster.com/blog/social-selling/how-to-export-facebook-group-members-to-a-csv/)

2. **La portée organique des Pages Facebook s'effondre, tandis que la vérification devient payante.** En 2026, une Page de 10 000 abonnés touche seulement 200-600 personnes par post organique (0,5-2%), contre une portée bien plus robuste sur les Groupes — et pour se démarquer (badge vérifié), Meta facture désormais 14,99 $/mois/page. *Implication* : une association ne peut plus compter sur Facebook pour toucher fiablement ses propres membres sans payer — l'espace NigerConnect doit garantir la portée via des canaux qu'on contrôle (notif in-app + e-mail), pas un algorithme tiers.
   Sources : [fbgroupbulkposter.com/blog/facebook-organic-reach-2026](https://fbgroupbulkposter.com/blog/facebook-organic-reach-2026), [mediacause.com/facebook-organic-reach-down-10-things-to-do](https://mediacause.com/facebook-organic-reach-down-10-things-to-do/)

3. **Aucune carte d'adhérent, aucune preuve de statut.** Sur Facebook/WhatsApp, il n'existe aucun moyen de prouver qu'une personne est réellement adhérente à jour de cotisation (utile pour l'accès à un événement, une réduction, une AG). HelloAsso a été créé en partie pour combler ce manque via sa fonctionnalité carte d'adhérent PDF+QR. *Implication* : c'est une fonctionnalité déjà demandée dans l'écosystème associatif francophone et directement duplicable.
   Source : [helloasso.com/blog/carte-adherent-comment-pourquoi-est-ce-obligatoire](https://www.helloasso.com/blog/carte-adherent-comment-pourquoi-est-ce-obligatoire/)

4. **Pas d'e-mail structuré, tout passe par des messages qui se perdent.** Les groupes WhatsApp/Facebook (déjà documentés dans la section 2026-07-02 de ce fichier, Axe 4) sont le canal de facto pour les annonces administratives et l'entraide de la diaspora, faute d'outil dédié — un message important se perd dans le flux au bout de quelques heures. *Implication* : une vraie liste de diffusion e-mail (persistante, consultable après coup, indépendante de l'activité en temps réel du membre) est un gain de fiabilité immédiat, en particulier pour les infos consulaires/administratives qui doivent être retrouvables plus tard.
   Source : section « AXE 4 » de ce même document (2026-07-02), [thecitizen.co.tz — WhatsApp groups diaspora](https://www.thecitizen.co.tz/tanzania/diaspora/whatsapp-groups-new-frontiers-for-diaspora-still-seeking-dual-citizenship-4968170)

5. **AssoConnect (l'alternative complète) est jugée complexe et chère dès que l'association grandit** — les avis pointent une courbe d'apprentissage lourde (« il faut du temps pour comprendre la logique de chaque module ») et un coût qui grimpe avec le nombre de contacts (jusqu'à 112 €TTC/mois pour 1000 contacts). *Implication* : à budget diaspora quasi nul, tout outil qui indexe son prix sur le nombre de membres est disqualifiant d'office — confirme qu'un espace association **gratuit sans palier** est le seul modèle acceptable pour ce public (voir §5).
   Source : [capterra.com/p/194611/AssoConnect/reviews](https://www.capterra.com/p/194611/AssoConnect/reviews/), [appvizer.fr/organisations/association/assoconnect](https://www.appvizer.fr/organisations/association/assoconnect)

---

## 3. Recommandation — badge de certification association (forme + couleur + libellé)

**Constat clé issu de la recherche** : les plateformes qui codent uniquement par couleur (LinkedIn : gris vs bleu, même coche) restent lisibles mais discrètes ; celles qui codent par **couleur + forme** (X : coche dorée + avatar carré vs coche bleue + avatar rond) sont **immédiatement reconnaissables sans même lire le libellé**, y compris en scan rapide dans un feed ou une liste de résultats de recherche. À l'inverse, Facebook a dû retirer son badge gris organisation en 2023 car les utilisateurs ne comprenaient pas sa signification sans lecture attentive — preuve qu'un signal ambigu sans libellé au tap finit par être abandonné. Instagram, de son côté, ne différencie pas du tout perso/business visuellement, ce qui est justement le problème qu'on veut éviter pour NigerConnect (ne pas confondre un compte personnel vérifié avec un compte association officiel).

**Recommandation concrète pour NigerConnect :**

- **Forme** : conserver la coche/checkmark déjà utilisée pour le badge « compte vérifié » personnel existant (identityStatus=approved), mais l'**encadrer dans un badge de forme différente** — par exemple un **écusson/losange** au lieu du cercle plein utilisé pour les comptes personnels — inspiré du double-codage X (couleur + forme), tout en restant à un coût de développement bas (un simple composant `<VerifiedBadge kind="person"|"association" />` avec une variante de `shape`, réutilisant l'infra badge déjà en place pour `isAmbassador`).
- **Couleur** : une couleur **distincte et non ambiguë** de celle du badge personnel (si le badge personnel est bleu, l'association doit être dans une teinte clairement différente — ambre/or, à l'image du gold check de X qui signale sans équivoque « entité officielle/organisation » dans l'inconscient collectif des utilisateurs habitués aux réseaux sociaux internationaux). Éviter le gris (retiré par Facebook faute de compréhension).
- **Libellé au tap** : obligatoire et explicite, ex. **« Association vérifiée »** (distinct de « Compte vérifié » pour les personnes) — affiché dans une bulle/modal au tap sur le badge, avec éventuellement la date de vérification et le nom légal de l'association. C'est la leçon directe de l'échec du badge gris Facebook : sans ce libellé, le badge seul ne suffit pas.
- **Avatar** (optionnel, fort ROI si peu coûteux) : envisager un **cadre carré ou à coins légèrement arrondis** pour l'avatar des comptes association, vs le cercle des comptes personnels — pattern X, réplicable en CSS/`borderRadius` sans dépendance native, donc **compatible OTA**.

Ce triple signal (forme du badge + couleur + libellé, éventuellement + forme d'avatar) permet une reconnaissance instantanée, gratuite à produire (aucune lib tierce, aucun coût), et directement compatible avec le système de confidentialité/badges déjà en place dans le code (`isAmbassador`, `identityStatus`).

Sources : [help.facebook.com/1288173394636262](https://www.facebook.com/help/1288173394636262), [linkedin.com/help/linkedin/answer/a1359065](https://www.linkedin.com/help/linkedin/answer/a1359065), [businessho.com/how-to-get-verified-on-x](https://businessho.com/how-to-get-verified-on-x/), [help.instagram.com/939561509841026](https://help.instagram.com/939561509841026/)

---

## 4. Recommandation — carte d'adhérent vérifiable

**Pattern à reproduire (HelloAsso + bonnes pratiques QR event-badging) :**

- **V1 — carte numérique PDF + QR dynamique, zéro coût, zéro dépendance store :**
  - Génération serveur (API NestJS existante) d'une carte PDF par adhérent : nom, photo (optionnelle), nom de l'association, type d'adhésion, **numéro d'adhérent**, **date de délivrance**, **date d'expiration**.
  - Le **QR code n'encode pas les données brutes de la carte** mais une **URL de vérification côté serveur** (`https://nigerconnect.app/verify/membre/{memberId}?t={token}`), affichant en temps réel le statut réel (actif / expiré / révoqué) — c'est le pattern dynamique documenté (WildApricot, guides event-badging) qui permet de **révoquer instantanément** une adhésion sans réémettre de carte physique, et évite qu'un QR statique falsifiable serve indéfiniment après une radiation.
  - Distribution par e-mail (PDF joint) + accessible à tout moment dans l'app (écran « ma carte »).
  - Coût marginal : quasi nul (génération PDF côté serveur, lib open-source type `pdfkit`/`puppeteer` déjà courantes en Node ; QR généré côté serveur avec une lib OSS type `qrcode`).

- **V2 (à ne PAS faire en V1, effort disproportionné) — intégration Apple Wallet / Google Wallet :**
  - Techniquement **faisable à coût zéro en argent** : Apple Wallet nécessite un certificat Pass Type ID rattaché à un compte Apple Developer — le projet en a **déjà un** (Team ID 4SRJRX4N45, payé pour l'app mobile), donc aucun coût additionnel ; génération/signature des `.pkpass` via la lib open-source `passkit-generator` (Node.js), auto-hébergée. Google Wallet API : compte émetteur **gratuit** (vérification business à faire une fois), lib officielle Google Wallet open-source.
  - Mais l'effort de développement (gestion des certificats, signatures JWT, templates de pass, mise à jour push des passes) est significatif pour un gain d'usage marginal par rapport à un simple PDF+QR déjà stocké dans l'app — **à réserver pour une itération ultérieure**, une fois l'espace association adopté et la demande confirmée par les utilisateurs.

- **Vérification terrain (contrôle à l'entrée d'un événement)** : un simple lecteur QR intégré à l'app (déjà utilisée par les membres du bureau) qui appelle l'endpoint de vérification et affiche statut + photo — pas besoin de matériel dédié, réutilise la caméra du téléphone comme le font tous les systèmes d'event-badging modernes.

Sources : [info.helloasso.com/fonctionnalites/cartes-des-membres](https://info.helloasso.com/fonctionnalites/cartes-des-membres), [pageloot.com/qr-codes-for/membership-cards](https://pageloot.com/qr-codes-for/membership-cards/), [github.com/alexandercerutti/passkit-generator](https://github.com/alexandercerutti/passkit-generator), [developers.google.com/wallet/generic/getting-started/issuer-onboarding](https://developers.google.com/wallet/generic/getting-started/issuer-onboarding), [walletwallet.alen.ro/blog/create-apple-wallet-pass-free](https://walletwallet.alen.ro/blog/create-apple-wallet-pass-free/)

---

## 5. Verdict — adhésion payante vs gratuite au vu du terrain diaspora

**Verdict : adhésion et cotisation GRATUITES et déclaratives dans NigerConnect en V1 — aucun paiement en ligne intégré.**

Justification :

1. **La règle absolue du projet** (« zéro solution payante », `memory/zero-solution-payante.md`) interdit d'introduire une dépendance SaaS payante — or tout paiement en ligne de cotisation (carte bancaire) impose de passer par un prestataire de paiement (Stripe ou équivalent), qui prélève une commission et introduit une surface de conformité (PCI-DSS, KYC) totalement disproportionnée pour un premier lot de fonctionnalités « espace association ».
2. **HelloAsso a déjà résolu ce problème pour tout le monde**, y compris pour les associations qui ont déjà un usage réel dans la diaspora africaine en France : c'est gratuit pour l'association, financé par la contribution volontaire du payeur, jamais imposée. **Recommandation directe** : NigerConnect ne doit **pas** réinventer un module de paiement — il suffit de laisser l'association renseigner un **lien externe HelloAsso** (ou équivalent) dans son profil back-office si elle souhaite collecter des cotisations en ligne. NigerConnect reste alors 100% hors du flux financier, ce qui est cohérent avec la règle « zéro payant » ET avec le principe de ne jamais gérer d'argent (déjà appliqué pour E-GP colis-voyageurs, voir Axe 4 ci-dessus).
3. **Le terrain diaspora confirme que le budget des associations est faible** : les avis négatifs d'AssoConnect (§1/§2) montrent que même un outil professionnel devient vite hors budget dès que la base de membres grandit — un signal fort qu'aucune tarification, même minime, ne doit être imposée par NigerConnect lui-même.
4. **En V1, le statut d'adhérent est donc déclaratif et géré manuellement par le bureau** : l'association enregistre ses adhérents dans le back-office (paiement de cotisation constaté hors ligne — espèces, virement, ou lien HelloAsso externe), et NigerConnect se contente de générer la carte, l'annuaire, la certification et la diffusion — la vraie valeur ajoutée du produit, sans jamais toucher à l'argent.
5. **Si une demande forte émerge plus tard** pour un paiement in-app, la voie la plus alignée avec la règle « zéro payant » resterait un modèle façon HelloAsso (contribution volontaire du payeur, zéro commission prélevée par NigerConnect) — mais cela reste un **gros pari hors périmètre V1**, à ne considérer qu'après validation explicite du propriétaire, exactement comme pour E-GP et les transferts informels (Axe 4).

Sources : [info.helloasso.com/modele-economique](https://info.helloasso.com/modele-economique), [helloasso.com/blog/infographie-le-modele-economique-unique-de-helloasso-en-un-coup-doeil](https://www.helloasso.com/blog/infographie-le-modele-economique-unique-de-helloasso-en-un-coup-doeil/), [capterra.com/p/194611/AssoConnect/reviews](https://www.capterra.com/p/194611/AssoConnect/reviews/)

---

## Sources complémentaires (section 2026-08-20)

| Source | URL | Type |
|---|---|---|
| Fonctionnalités HelloAsso | https://info.helloasso.com/nos-fonctionnalites | Landing page officielle |
| Cartes d'adhérent HelloAsso | https://info.helloasso.com/fonctionnalites/cartes-des-membres | Landing page officielle |
| Carte adhérent : pourquoi, comment | https://www.helloasso.com/blog/carte-adherent-comment-pourquoi-est-ce-obligatoire/ | Blog officiel |
| Mini-site HelloAsso | https://info.helloasso.com/fonctionnalites/mini-site-internet | Landing page officielle |
| Modèle économique HelloAsso | https://info.helloasso.com/modele-economique | Documentation officielle |
| AssoConnect — avis et tarifs | https://www.appvizer.fr/organisations/association/assoconnect | Comparatif |
| AssoConnect — offre comptabilité | https://www.assoconnect.com/tarifs/offre-comptabilite/ | Landing page officielle |
| AssoConnect — reviews Capterra | https://www.capterra.com/p/194611/AssoConnect/reviews/ | Reviews |
| Déclin de la portée organique Facebook 2026 | https://fbgroupbulkposter.com/blog/facebook-organic-reach-2026 | Article |
| Déclin de la portée organique Facebook (10 pistes) | https://mediacause.com/facebook-organic-reach-down-10-things-to-do/ | Article |
| Export des membres d'un groupe Facebook (limites) | https://phantombuster.com/blog/social-selling/how-to-export-facebook-group-members-to-a-csv/ | Guide |
| Mobilizon (Framasoft/Kaihuri) | https://elixirforum.com/t/mobilizon-a-decentralized-alternative-to-meetup-facebook-events-etc/26117 | Article |
| Gancio — alternatives | https://alternativeto.net/software/gancio | Comparatif |
| Types de badges vérifiés Facebook | https://www.facebook.com/help/1288173394636262 | Documentation officielle |
| Vérifications sur le profil LinkedIn | https://www.linkedin.com/help/linkedin/answer/a1359065 | Documentation officielle |
| Guide de vérification X 2026 | https://businessho.com/how-to-get-verified-on-x/ | Guide |
| Badges Instagram | https://help.instagram.com/939561509841026/ | Documentation officielle |
| Cartes de membre pour clubs — Apple/Google Wallet | https://www.passcreator.com/en/membership-cards-for-clubs-in-google-wallet-and-apple-wallet | Article technique |
| Créer un pass Apple Wallet gratuitement en 2026 | https://walletwallet.alen.ro/blog/create-apple-wallet-pass-free/ | Guide |
| passkit-generator (lib open-source Node.js) | https://github.com/alexandercerutti/passkit-generator | Dépôt open-source |
| Google Wallet API — onboarding émetteur | https://developers.google.com/wallet/generic/getting-started/issuer-onboarding | Documentation officielle |
| QR codes pour cartes de membre | https://pageloot.com/qr-codes-for/membership-cards/ | Article |
| Badges événementiels avec QR code | https://www.eventmobi.com/blog/event-badges-with-qr-codes/ | Article |
