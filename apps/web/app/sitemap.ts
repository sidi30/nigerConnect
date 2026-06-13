import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://nigerconnect.app";
  const now = new Date();
  // Legal pages must be discoverable by store reviewers — they routinely
  // verify that the privacy/terms URLs declared in the listing actually
  // resolve. Listing them here helps Google index them quickly.
  // Account-deletion / reset-password / verify-email are intentionally
  // excluded — they are utility flows excluded from indexing in robots.ts.
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/community`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/support`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];
}
