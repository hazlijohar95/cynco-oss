import { resolve } from 'node:path';
import { defineConfig, type UserConfig } from 'vite';

const defaultPort = 9231;
const portFromEnv = Number(process.env.JOURNALS_E2E_PORT);
const port = Number.isFinite(portFromEnv) ? portFromEnv : defaultPort;

// Serves the package root so fixture pages can import the BUILT dist
// (`/dist/index.js`, `/dist/worker/...`) exactly as a consumer would.
const config: UserConfig = defineConfig({
  root: resolve(import.meta.dirname, '..', '..'),
  publicDir: false,
  // lru_map is the only bare (non-workspace) import reachable from dist;
  // pre-bundling it at server startup avoids vite's mid-session dependency
  // discovery reload, which would race the fixtures' ready flags.
  optimizeDeps: {
    include: ['lru_map'],
  },
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
});

export default config;
