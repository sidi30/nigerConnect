"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getToken } from "@/lib/assoApi";

// Client guard for the whole /asso tree: no token in localStorage means no
// back-office. The login page opts out — it must render for a visitor who has
// no session yet.
//
// This guard is convenience, not security. It only decides what to paint; the
// API refuses every association action on its own (assertRole). A user who
// forges a token key in devtools gets a back-office that 401s on first fetch.
//
// /asso is kept out of search indexes here and in robots.ts.
export default function AssoLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isLogin = pathname === "/asso/login";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isLogin) {
      setReady(true);
      return;
    }
    if (!getToken()) {
      router.replace("/asso/login");
      return;
    }
    setReady(true);
  }, [isLogin, router]);

  if (isLogin) {
    return (
      <>
        <NoIndexMeta />
        {children}
      </>
    );
  }

  if (!ready) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FDFBF7]">
        <p className="text-[#5A4634] text-sm">Chargement…</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#1A0F0A]">
      <NoIndexMeta />
      {children}
    </div>
  );
}

function NoIndexMeta() {
  return <meta name="robots" content="noindex, nofollow" />;
}
