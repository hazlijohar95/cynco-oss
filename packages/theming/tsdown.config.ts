import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
  // Unbundled per-file output so `./react` resolves to dist/react/index.js
  // without a second bundle entry; react stays external (optional peer).
  entry: ['src/**/*.ts'],
  attw: process.env.ATTW === 'true',
  tsconfig: './tsconfig.json',
  clean: true,
  dts: {
    sourcemap: true,
    tsgo: true,
  },
  unbundle: true,
  platform: 'neutral',
});

export default config;
