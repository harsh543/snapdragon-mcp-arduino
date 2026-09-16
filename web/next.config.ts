import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only applies to `next dev`. Needed when a tunnel (e.g. ngrok) points at
  // the local dev server directly, since its hostname isn't localhost.
  // Not needed for the deployed Vercel app - this dev-only protection
  // doesn't exist on production builds.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok.io", "*.ngrok.app"],
  // Pins Turbopack's workspace root to this directory. Without this, a
  // lockfile anywhere above web/ (e.g. one Windows Explorer/OneDrive syncs
  // in) makes Next.js warn "Detected additional lockfiles" and guess the
  // wrong root, which can misresolve local imports.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
