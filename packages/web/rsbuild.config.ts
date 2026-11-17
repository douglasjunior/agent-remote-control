import { defineConfig, loadEnv, type ProxyConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss';


/** The default port of `packages/p2p-server`, which the `p2p` env mode reaches for signaling. */
const P2P_SERVER_PORT = 3100;

/**
 * The `p2p` env mode builds the hosted web app (`dist-p2p`), served by `packages/p2p-server`, which reaches a host
 * through WebRTC; every other mode reaches the server that serves the page. `import.meta.env.ARC_TARGET` tells the
 * app which one it is.
 */
export default defineConfig(({ envMode }) => {
  const p2p = envMode === 'p2p';
  const serverPort = process.env.PORT || loadEnv({ cwd: '../..', mode: envMode, processEnv: {} }).parsed.PORT || '3000';
  // `changeOrigin: false` keeps the page's Host, which the origin checks of the server and the p2p-server compare.
  const proxy: ProxyConfig = p2p
    ? { '/signal': { target: `ws://localhost:${P2P_SERVER_PORT}`, ws: true, changeOrigin: false } }
    : {
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true, changeOrigin: false },
      '/health': { target: `http://localhost:${serverPort}`, changeOrigin: false },
    };

  return {
    plugins: [pluginReact(), pluginTailwindcss()],
    source: {
      entry: { index: './src/main.tsx' },
      define: { 'import.meta.env.ARC_TARGET': JSON.stringify(p2p ? 'p2p' : 'server') },
    },
    resolve: {
      conditionNames: ['source', '...'],
    },
    html: { template: './index.html' },
    server: { port: 5173, allowedHosts: ['.devtunnels.ms'], proxy },
    output: { distPath: { root: p2p ? 'dist-p2p' : 'dist' } },
  };
});
