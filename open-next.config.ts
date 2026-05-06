import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig({
  // All routes use the default Node.js-compatible server handler.
  // No edge runtime overrides — standard Node compat on Workers.
});
