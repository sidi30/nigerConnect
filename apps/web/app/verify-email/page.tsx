import Link from "next/link";

export const dynamic = "force-dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface VerifyResponse {
  ok: boolean;
  message: string;
}

async function verifyToken(token: string): Promise<VerifyResponse> {
  try {
    const res = await fetch(
      `${API_URL}/auth/verify-email?token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return { ok: false, message: "Lien invalide ou expiré." };
    }
    return (await res.json()) as VerifyResponse;
  } catch {
    return { ok: false, message: "Impossible de joindre le serveur. Réessaie." };
  }
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = token
    ? await verifyToken(token)
    : { ok: false, message: "Token manquant." };

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#FDFBF7] px-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-[#E8DFD3] p-8 text-center">
        <div className="text-6xl mb-4">{result.ok ? "✅" : "⚠️"}</div>
        <h1 className="text-2xl font-bold text-[#1A0F0A] mb-3">
          {result.ok ? "Email vérifié" : "Vérification impossible"}
        </h1>
        <p className="text-[#5A4634] mb-6 leading-relaxed">{result.message}</p>
        {result.ok ? (
          <p className="text-sm text-[#8A6B4D]">
            Tu peux fermer cet onglet et retourner dans l&apos;app NigerConnect.
          </p>
        ) : (
          <p className="text-sm text-[#8A6B4D]">
            Ouvre l&apos;app NigerConnect et saisis le <strong>code à 6 chiffres</strong>
            {" "}reçu par email. Tu peux en demander un nouveau depuis l&apos;app.
          </p>
        )}
        <Link
          href="/"
          className="inline-block mt-8 text-[#E05206] font-semibold hover:underline"
        >
          ← Retour à l&apos;accueil
        </Link>
      </div>
    </main>
  );
}

export const metadata = {
  title: "Vérification email",
  description: "Confirme ton adresse email NigerConnect.",
  robots: { index: false, follow: false },
};
