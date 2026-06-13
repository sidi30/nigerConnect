import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://nigerconnect.app";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Utility pages: crawlers must not index transient flows where the URL
        // carries a token (verify-email, reset-password) or the only purpose is
        // a destructive action (account-deletion). Keeping them out of the
        // SERPs avoids users landing on a stale token URL via Google.
        disallow: ["/verify-email", "/reset-password", "/account-deletion", "/admin"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
