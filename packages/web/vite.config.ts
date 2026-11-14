import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, loadEnv, type ProxyOptions } from 'vite';


/** The default port of `packages/p2p-server`, which the `p2p` mode reaches for signaling. */
const P2P_SERVER_PORT = 3100;

/**
 * The `p2p` mode builds the hosted web app (`dist-p2p`), served by `packages/p2p-server`, which reaches a host
 * through WebRTC; every other mode reaches the server that serves the page.
 */
export default defineConfig(({ mode }) => {
  const p2p = mode === 'p2p';
  const serverPort = loadEnv(mode, '../..', '').PORT || '3000';
  const serverProxy: Record<string, ProxyOptions> = p2p
    ? { '/signal': { target: `ws://localhost:${P2P_SERVER_PORT}`, ws: true } }
    : {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
      '/health': { target: `http://localhost:${serverPort}` },
    };

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      conditions: ['source', ...defaultClientConditions],
    },
    server: { allowedHosts: ['.devtunnels.ms'], proxy: serverProxy },
    preview: { allowedHosts: ['.devtunnels.ms'], proxy: serverProxy },
    build: { outDir: p2p ? 'dist-p2p' : 'dist' },
  };
});
