import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare Workers deployment via @opennextjs/cloudflare
  // Wire up Cloudflare Images (cf.images.transformations) when ready
  images: {
    unoptimized: true,
  },
  experimental: {
    // Whole-workspace saves ship the full jsonb blob through a server action;
    // a multi-year QBO backfill can push it past the 1MB default, which would
    // make the workspace permanently unsavable (413 on every retry).
    // cloud-sync.ts refuses to send payloads over ~9MB so the limit is never
    // hit silently — keep the two numbers in step.
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
