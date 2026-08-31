"use client";

import { useEffect, useState } from "react";

/**
 * CTA d'ouverture de l'invitation.
 *
 * Un lien brut vers `nigerconnect://` fait afficher à iOS Safari « Un problème
 * est survenu. Impossible d'ouvrir l'appli. » quand l'app n'est pas installée :
 * c'est un cul-de-sac pour la personne invitée. On route donc selon la
 * plateforme :
 *  - iOS    : le lien universel (AASA /invite/*) ouvre déjà l'app si elle est
 *             installée. Si on est ici, c'est qu'elle ne l'est pas → App Store.
 *             Le schéma reste accessible en action secondaire explicite.
 *  - Android: `intent://` embarque son propre repli (browser_fallback_url) →
 *             ouvre l'app si présente, sinon le Play Store, jamais d'erreur.
 *  - Desktop: pas de deep-link possible, on invite à ouvrir depuis le mobile.
 */

const APP_SCHEME = "nigerconnect://";
const APP_HOST = "nigerconnect.app";
const ANDROID_PACKAGE = "com.nigerconnect.app";

type Platform = "ios" | "android" | "desktop";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  // iPadOS 13+ se présente comme un Mac : on le distingue au tactile.
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "ios";
  return "desktop";
}

const btnPrimary =
  "flex items-center justify-center gap-2 w-full bg-[#E05206] hover:bg-[#C8470A] text-white font-semibold px-5 py-3.5 rounded-xl transition-colors text-sm";

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export default function InviteCta({
  code,
  iosStoreUrl,
  androidUrl,
}: {
  code: string;
  iosStoreUrl: string;
  /** Play Store, ou la liste d'attente tant que l'Android n'est pas publié. */
  androidUrl: string;
}) {
  const [platform, setPlatform] = useState<Platform | null>(null);

  useEffect(() => setPlatform(detectPlatform()), []);

  const encoded = encodeURIComponent(code);
  const deepLink = `${APP_SCHEME}invite/${encoded}`;
  const intentUrl =
    `intent://${APP_HOST}/invite/${encoded}#Intent;scheme=https;` +
    `package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(androidUrl)};end`;

  // Tentative de deep-link avec repli boutique si rien ne s'est ouvert.
  const tryOpen = (
    e: React.MouseEvent<HTMLAnchorElement>,
    target: string,
    fallback: string,
  ) => {
    e.preventDefault();
    const timer = window.setTimeout(() => {
      window.location.href = fallback;
    }, 1500);
    const cancel = () => {
      if (document.hidden) window.clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", cancel, { once: true });
    window.location.href = target;
  };

  // Avant hydratation : réserve la hauteur pour éviter un saut de mise en page.
  if (platform === null) {
    return <div className="h-[46px] mb-3" aria-hidden="true" />;
  }

  if (platform === "android") {
    return (
      <>
        <a
          href={androidUrl}
          onClick={(e) => tryOpen(e, intentUrl, androidUrl)}
          className={`${btnPrimary} mb-3`}
          aria-label="Ouvrir NigerConnect, ou l'installer"
        >
          <DownloadIcon />
          Ouvrir l&apos;app
        </a>
        <p className="text-xs text-[#8A6B4D] mb-5">
          Si l&apos;app n&apos;est pas installée, tu seras redirigé(e) vers le
          Play Store.
        </p>
      </>
    );
  }

  if (platform === "ios") {
    return (
      <>
        <a
          href={iosStoreUrl}
          className={`${btnPrimary} mb-3`}
          aria-label="Télécharger NigerConnect sur l'App Store"
        >
          <DownloadIcon />
          Télécharger sur l&apos;App Store
        </a>
        <p className="text-xs text-[#8A6B4D] mb-5">
          Déjà installée ?{" "}
          <a
            href={deepLink}
            onClick={(e) => tryOpen(e, deepLink, iosStoreUrl)}
            className="text-[#E05206] font-semibold hover:underline"
          >
            ouvrir l&apos;app
          </a>
          .
        </p>
      </>
    );
  }

  return (
    <p className="text-xs text-[#8A6B4D] mb-5">
      Ouvre ce lien depuis ton téléphone pour rejoindre directement, ou
      télécharge l&apos;app ci-dessous.
    </p>
  );
}
