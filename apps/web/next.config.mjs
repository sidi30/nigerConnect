import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Standalone output → ships only the files Next actually needs at runtime.
  // Lets the production Dockerfile copy `.next/standalone` and skip
  // node_modules entirely, shrinking the final image to ~150 MB.
  output: "standalone",
  // Tells Next which workspace root to trace files from in a monorepo —
  // avoids dragging the whole repo into the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  // Point Turbopack at the monorepo root so it doesn't pick up
  // C:\Users\ramzi\package-lock.json on dev machines.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  async headers() {
    return [
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
      {
        source: "/.well-known/assetlinks.json",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
};

export default nextConfig;
