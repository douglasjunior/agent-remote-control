import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';


const serverPort = process.env.ARC_SERVER_PORT ?? '3000';

const serverProxy = {
  '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
  '/health': { target: `http://localhost:${serverPort}` },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    conditions: ['source', ...defaultClientConditions],
  },
  server: { proxy: serverProxy },
  preview: { proxy: serverProxy },
  build: { outDir: 'dist' },
});
