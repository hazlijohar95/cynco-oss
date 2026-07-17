import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/**/*.ts'],
  unbundle: true,
  platform: 'neutral',
  dts: true,
});
