import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // postgres.js uses Node.js built-ins (fs, net, tls) — must run in Node.js runtime, not Edge.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
