import { AppLayout } from './components/app-layout.js';
import { ConversationPage } from './pages/conversation-page.js';
import { SettingsPage } from './pages/settings-page.js';
import { SkillsPage } from './pages/skills-page.js';
import { SquadsPage } from './pages/squads-page.js';


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
      { path: 'settings', element: <SettingsPage /> },
      { path: 'squads', element: <SquadsPage /> },
      { path: 'squads/new', element: <SquadsPage creating /> },
      { path: 'squads/:squadId', element: <SquadsPage /> },
    ],
  },
];
