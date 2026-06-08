"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, getToken } from "@/lib/adminApi";

// Client guard for the whole /admin tree. On mount, if there's no admin token
// in localStorage we redirect to the login page. The login page itself opts
// out of the guard (it must render for unauthenticated users).
//
// /admin is kept out of search indexes via a robots <meta> rendered here, in
// addition to the noindex metadata on the (server) login page.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const isLogin = pathname === "/admin/login";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (isLogin) {
      setReady(true);
      return;
    }
    if (!getToken()) {
      router.replace("/admin/login");
      return;
    }
    setReady(true);
  }, [isLogin, router]);

  function logout() {
    clearSession();
    router.replace("/admin/login");
  }

  // The login page renders without the chrome (its own full-screen layout).
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
      <header className="bg-white border-b border-[#E8DFD3] sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold">
            <span className="text-[#E05206]">NigerConnect</span>
            <span className="text-[#5A4634] font-medium">Admin</span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="text-sm font-semibold text-[#5A4634] border border-[#E8DFD3] rounded-lg px-3 py-1.5 hover:bg-[#FDFBF7] transition-colors"
          >
            Déconnexion
          </button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">{children}</main>
    </div>
  );
}

// robots noindex via meta — belt-and-suspenders alongside robots.ts. Next 16
// hoists tags rendered in the body into <head>.
function NoIndexMeta() {
  return <meta name="robots" content="noindex, nofollow" />;
}
