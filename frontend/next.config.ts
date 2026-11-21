import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

import { assertAuthConfigured } from "./lib/auth-env.mjs";

// Production never runs with sign-in silently off (CI and local builds may).
assertAuthConfigured(process.env);

const nextConfig: NextConfig = {
  cacheComponents: true,
  experimental: {
    // A build restored from Vercel's cache once shipped new HTML with the previous stylesheet.
    // Builds here take seconds, so always start cold.
    turbopackFileSystemCacheForBuild: false,
  },
  async headers() {
    return [
      {
        // MuJoCo WebAssembly lives under its version number, so a copy never changes.
        source: "/mujoco/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
