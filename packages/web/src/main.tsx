import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { ConnectionProvider } from './connection/connection-context.js';
import { WebSocketServerConnection } from './connection/websocket-server-connection.js';
import './index.css';
import { router } from './router.js';
import { ThemeProvider } from './theme/theme-provider.js';


if (import.meta.env.DEV) {
  void import('react-grab');
}

const connection = new WebSocketServerConnection();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ConnectionProvider connection={connection}>
        <RouterProvider router={router} />
      </ConnectionProvider>
    </ThemeProvider>
  </StrictMode>,
);
