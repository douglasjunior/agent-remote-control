import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { ConnectionProvider } from './connection/connection-context.js';
import { createAppConnection } from './connection/create-server-connection.js';
import './index.css';
import { RemoteLinkMissingPage } from './pages/remote-link-missing-page.js';
import { routes } from './router.js';
import { ThemeProvider } from './theme/theme-provider.js';


if (import.meta.env.DEV) {
  void import('react-grab');
}

const app = createAppConnection(import.meta.env.MODE);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      {app
        ? (
          <ConnectionProvider connection={app.connection}>
            <RouterProvider router={createBrowserRouter(routes, { basename: app.basename })} />
          </ConnectionProvider>
        )
        : <RemoteLinkMissingPage />}
    </ThemeProvider>
  </StrictMode>,
);
