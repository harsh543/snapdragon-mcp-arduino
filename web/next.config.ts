import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only applies to `next dev`. Needed when a tunnel (e.g. ngrok) points at
  // the local dev server directly, since its hostname isn't localhost.
  // Not needed for the deployed Vercel app - this dev-only protection
  // doesn't exist on production builds.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok.io", "*.ngrok.app"],
};

export default nextConfig;
