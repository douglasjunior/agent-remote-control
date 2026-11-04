import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig, loadEnv } from 'vite';


export default defineConfig(({ mode }) => {
  const serverPort = loadEnv(mode, '../..', '').PORT || '3000';
  const serverProxy = {
    '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    '/health': { target: `http://localhost:${serverPort}` },
  };

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      conditions: ['source', ...defaultClientConditions],
    },
    server: { proxy: serverProxy },
    preview: { proxy: serverProxy },
    build: { outDir: 'dist' },
  };
});
