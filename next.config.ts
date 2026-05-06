import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare Workers deployment via @opennextjs/cloudflare
  // Wire up Cloudflare Images (cf.images.transformations) when ready
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
