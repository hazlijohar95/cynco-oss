import type { NextConfig } from 'next';

// The @cynco packages ship compiled dist (component CSS is inlined into the
// JS as strings at package build time), so no transpilePackages or CSS
// loader configuration is needed here.
const nextConfig: NextConfig = {};

export default nextConfig;
