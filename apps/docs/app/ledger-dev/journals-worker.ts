// Bundler entry for the @cynco/journals portable worker. The portable build
// is fully self-contained ESM (protocol handler and renderers inlined, no
// imports), and importing it registers the worker's onmessage handler as a
// side effect. This local module exists only so Next/Turbopack can resolve
// `new Worker(new URL('./journals-worker.ts', import.meta.url))` statically
// and emit the worker as its own asset in the static export.
import '@cynco/journals/worker/worker-portable.js';
