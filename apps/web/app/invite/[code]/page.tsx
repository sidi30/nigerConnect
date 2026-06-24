import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Deep-link scheme and store URLs.
const APP_SCHEME = "nigerconnect://";
const IOS_STORE_URL =
  "https://apps.apple.com/fr/app/nigerconnect/id6775895189";
const ANDROID_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.sidi30.nigerconnect";

interface CheckResult {
  valid: boolean;
  inviterName?: string;
  /** v2: present when the invitation is a reusable link. */
  kind?: "single_use" | "reusable";
}

async function checkCode(code: string): Promise<CheckResult> {
  try {
    const res = await fetch(
      `${API_URL}/invitations/check?code=${encodeURIComponent(code)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return { valid: false };
    return (await res.json()) as CheckResult;
  } catch {
    return { valid: false };
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function InvitePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const result = await checkCode(code);

  // Deep-link that pre-fills the invite code in the app registration flow.
  const deepLink = `${APP_SCHEME}invite/${encodeURIComponent(code)}`;

  if (!result.valid) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FDFBF7] px-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-[#E8DFD3] p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-[#FCE8E8] flex items-center justify-center mx-auto mb-4">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#B91C1C"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-8 h-8"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[#1A0F0A] mb-3">
            Invitation invalide
          </h1>
          <p className="text-[#5A4634] mb-6 leading-relaxed">
            Ce lien d&apos;invitation n&apos;est plus valide. Il a peut-être
            été révoqué ou le code est incorrect.
          </p>
          <p className="text-sm text-[#8A6B4D] mb-6">
            Demande un nouveau lien à la personne qui souhaitait t&apos;inviter.
          </p>
          <Link
            href="/"
            className="inline-block text-[#E05206] font-semibold hover:underline"
          >
            Découvrir NigerConnect
          </Link>
        </div>
      </main>
    );
  }

  const inviterPhrase = result.inviterName
    ? `${result.inviterName} t'invite sur NigerConnect`
    : "Tu es invité(e) sur NigerConnect";

  // For reusable links: clarify that the link can be used by multiple people.
  const isReusable = result.kind === "reusable";

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#FDFBF7] px-6 py-12">
      <div className="max-w-md w-full">
        {/* Header card */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E8DFD3] p-8 text-center mb-4">
          {/* Brand mark */}
          <div className="w-16 h-16 rounded-2xl bg-[#E05206] flex items-center justify-center mx-auto mb-5">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-9 h-9"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-[#1A0F0A] mb-2">
            {inviterPhrase}
          </h1>
          {isReusable ? (
            <p className="text-xs font-semibold text-[#1D4ED8] bg-[#E6EDFB] rounded-full px-3 py-1 inline-block mb-3">
              Lien d&apos;invitation — partage-le librement
            </p>
          ) : null}
          <p className="text-[#5A4634] leading-relaxed mb-6">
            Le réseau social de la diaspora nigérienne — se retrouver,
            s&apos;entraider, rester connectés.
          </p>

          {/* Primary CTA — deep-link into the app if installed */}
          <a
            href={deepLink}
            className="flex items-center justify-center gap-2 w-full bg-[#E05206] hover:bg-[#C8470A] text-white font-semibold px-5 py-3.5 rounded-xl transition-colors mb-3 text-sm"
            aria-label="Ouvrir NigerConnect dans l'application"
          >
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
              <polyline points="15 3 21 3 21 9" />
              <path d="M10 14L21 3" />
              <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
            </svg>
            Ouvrir l&apos;app
          </a>

          {/* Hint if app not installed */}
          <p className="text-xs text-[#8A6B4D] mb-5">
            Si l&apos;app ne s&apos;ouvre pas, télécharge-la d&apos;abord.
          </p>

          {/* Store buttons */}
          <div className="flex gap-3 justify-center">
            <a
              href={IOS_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Télécharger sur l'App Store"
              className="flex-1 flex items-center justify-center gap-2 border border-[#E8DFD3] hover:bg-[#FDFBF7] text-[#1A0F0A] font-semibold px-4 py-2.5 rounded-xl transition-colors text-sm"
            >
              {/* Apple logo glyph */}
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4 shrink-0"
              >
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              App Store
            </a>
            <a
              href={ANDROID_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Télécharger sur Google Play"
              className="flex-1 flex items-center justify-center gap-2 border border-[#E8DFD3] hover:bg-[#FDFBF7] text-[#1A0F0A] font-semibold px-4 py-2.5 rounded-xl transition-colors text-sm"
            >
              {/* Google Play triangle glyph */}
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4 shrink-0"
              >
                <path d="M3.18 23.76c.34.19.73.24 1.11.14L13.88 12 4.29.1c-.38-.1-.77-.05-1.11.14C2.5.67 2.09 1.4 2.09 2.19v19.62c0 .79.41 1.52 1.09 1.95zM14.93 13.05l2.72 2.72-9.4 5.26 6.68-8zm3.95-5.57L16.66 9.7 13.88 12l2.78 2.3 2.22 1.24c.63.35 1.03.91 1.03 1.52s-.4 1.17-1.03 1.52L5.35 23.76l9.4-5.26 5.28-2.95c1.09-.61 1.79-1.72 1.79-2.95s-.7-2.34-1.79-2.95l-1.15-.17zM5.35.24l13.53 7.57-2.22 1.24L14.93 10.9 8.25 2.9z" />
              </svg>
              Google Play
            </a>
          </div>
        </div>

        {/* Code fallback card */}
        <div className="bg-white rounded-2xl border border-[#E8DFD3] px-6 py-4 text-center">
          <p className="text-xs text-[#8A6B4D] mb-2">
            Code d&apos;invitation à copier si nécessaire :
          </p>
          <p className="font-mono font-bold text-lg text-[#E05206] tracking-widest select-all">
            {code}
          </p>
        </div>

        <p className="text-center text-xs text-[#8A6B4D] mt-5">
          <Link href="/" className="hover:underline">
            En savoir plus sur NigerConnect
          </Link>
        </p>
      </div>
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const result = await checkCode(code);

  const title = result.inviterName
    ? `${result.inviterName} t'invite sur NigerConnect`
    : "Tu es invité(e) sur NigerConnect";

  return {
    title,
    description:
      "Rejoins NigerConnect, le réseau social de la diaspora nigérienne.",
    robots: { index: false, follow: false },
  };
}
