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
