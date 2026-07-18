import type { NextConfig } from 'next';

// The @cynco packages ship compiled dist (component CSS is inlined into the
// JS as strings at package build time), so no transpilePackages or CSS
// loader configuration is needed here.
//
// The site is fully static (seeded demo data, no runtime server APIs), so
// deploys build with NEXT_OUTPUT=export and ship the `out/` directory to
// Cloudflare Workers static assets (see wrangler.jsonc). The flag is
// env-gated so `next dev` / `next start` keep their default behavior.
const nextConfig: NextConfig = {
  ...(process.env.NEXT_OUTPUT === 'export'
    ? { output: 'export' as const }
    : {}),
};

export default nextConfig;
