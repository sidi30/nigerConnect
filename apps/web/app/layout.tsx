import type { Metadata, Viewport } from "next";
import { DM_Sans, Playfair_Display } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-dm-sans",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  display: "swap",
  weight: ["700", "800", "900"],
  variable: "--font-playfair",
});

const siteName = "NigerConnect";
const description =
  "Le réseau social de la diaspora nigérienne. Se retrouver, s'entraider, rester connectés — où que tu sois dans le monde. App gratuite iOS et Android.";

// Public origin used for OG images, sitemap, and absolute URLs.
// Settable via NEXT_PUBLIC_APP_URL at build time (eas/Vercel/Docker build arg).
// Falls back to the prod URL on sahabiguide.com.
const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://nigerconnect.sahabiguide.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${siteName} — Le réseau social de la diaspora nigérienne`,
    template: `%s · ${siteName}`,
  },
  description,
  keywords: [
    "Niger",
    "diaspora",
    "nigérien",
    "nigérienne",
    "réseau social",
    "communauté",
    "Niamey",
    "entraide",
    "Afrique",
    "app mobile",
  ],
  authors: [{ name: "NigerConnect" }],
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "/",
    siteName,
    title: `${siteName} — Se retrouver, s'entraider, rester connectés`,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteName} — Le réseau social de la diaspora nigérienne`,
    description,
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#E05206",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${dmSans.variable} ${playfair.variable}`}>
      <body>{children}</body>
    </html>
  );
}
