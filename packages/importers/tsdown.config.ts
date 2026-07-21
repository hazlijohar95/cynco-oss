import { defineConfig, type UserConfig } from 'tsdown';

// Pure data package: no CSS pipeline, no worker entries, nothing inlined.
// Unbundled like the other libraries so consumers can deep-import a single
// parser without paying for the rest.
const config: UserConfig = defineConfig({
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
