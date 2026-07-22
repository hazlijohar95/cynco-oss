import createMDX from '@next/mdx';
import type { NextConfig } from 'next';
import { join } from 'node:path';

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
  pageExtensions: ['ts', 'tsx', 'mdx'],
};

// Docs prose lives in app/docs/*/content.mdx, compiled by @next/mdx.
// Turbopack requires plugin references to be serializable strings: package
// names resolve from node_modules, and the local plugin goes in by absolute
// path (builds always run from apps/docs — both the moon task and the
// wrangler deploy lane documented in wrangler.jsonc).
const withMDX = createMDX({
  options: {
    remarkPlugins: ['remark-gfm'],
    rehypePlugins: [join(process.cwd(), 'lib/mdx/rehype-docs.mjs')],
  },
});

export default withMDX(nextConfig);
