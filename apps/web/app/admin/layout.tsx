"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getToken } from "@/lib/adminApi";

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

  // The dashboard shell (sidebar + content offset) is rendered by the page
  // itself, since it owns the active-section state. The layout only enforces
  // the auth guard, the noindex meta, and the warm app background.
  return (
    <div className="min-h-screen bg-[#FDFBF7] text-[#1A0F0A]">
      <NoIndexMeta />
      {children}
    </div>
  );
}

// robots noindex via meta — belt-and-suspenders alongside robots.ts. Next 16
// hoists tags rendered in the body into <head>.
function NoIndexMeta() {
  return <meta name="robots" content="noindex, nofollow" />;
}
