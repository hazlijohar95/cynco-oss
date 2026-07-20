import { defineConfig } from 'vite';

// Kitchen-sink demo app. Port is pinned (and strict) so moon tasks, agent
// harnesses, and humans all agree on where the dev server lives. The moon
// dev/serve tasks pass --port with the worktree offset added (scripts/wt.ts);
// the CLI flag overrides these defaults while strictPort keeps clashes loud.
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
