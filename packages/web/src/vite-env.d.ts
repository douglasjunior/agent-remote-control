/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket URL of the server, e.g. `ws://localhost:3000/ws`. Empty: the same origin that serves the page, at `/ws`. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
