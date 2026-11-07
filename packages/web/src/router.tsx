import { createBrowserRouter } from 'react-router';

import { AppLayout } from './components/app-layout.js';
import { ConversationPage } from './pages/conversation-page.js';


export const routes = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <ConversationPage /> },
      { path: 'c/:conversationId', element: <ConversationPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
