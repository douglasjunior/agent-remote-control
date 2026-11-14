import { createBrowserRouter } from 'react-router';

import { AppLayout } from './components/app-layout.js';
import { ConversationPage } from './pages/conversation-page.js';
import { SkillsPage } from './pages/skills-page.js';


export const routes = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <ConversationPage /> },
      { path: 'c/:conversationId', element: <ConversationPage /> },
      { path: 'c/:conversationId/tasks', element: <ConversationPage /> },
      { path: 'c/:conversationId/tasks/:artifactId', element: <ConversationPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'skills/:skillName', element: <SkillsPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
