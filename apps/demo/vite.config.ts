import { defineConfig } from 'vite';

// Kitchen-sink demo app. Port is pinned (and strict) so moon tasks, agent
// harnesses, and humans all agree on where the dev server lives.
export default defineConfig({
  server: {
    port: 4600,
    strictPort: true,
  },
  preview: {
    port: 4600,
    strictPort: true,
  },
});
