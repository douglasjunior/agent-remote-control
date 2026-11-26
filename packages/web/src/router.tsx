import { AppLayout } from './components/app-layout.js';
import { MovedToHub } from './components/settings-hub/moved-to-hub.js';
import { ServerSettingsSection } from './components/settings-hub/server-settings-section.js';
import { SettingsHubLayout } from './components/settings-hub/settings-hub-layout.js';
import { SkillsSection } from './components/settings-hub/skills-section.js';
import { SquadsSection } from './components/settings-hub/squads-section.js';
import { ConversationPage } from './pages/conversation-page.js';


export const routes = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <ConversationPage /> },
      { path: 'c/:conversationId', element: <ConversationPage /> },
      { path: 'c/:conversationId/tasks', element: <ConversationPage /> },
      { path: 'c/:conversationId/squad', element: <ConversationPage /> },
      { path: 'c/:conversationId/tasks/:artifactId', element: <ConversationPage /> },
      {
        path: 'settings',
        element: <SettingsHubLayout />,
        children: [
          { path: 'general', element: <ServerSettingsSection section="general" /> },
          { path: 'agents', element: <ServerSettingsSection section="agents" /> },
          { path: 'squads', element: <SquadsSection />, children: [{ path: 'new', element: null }, { path: ':squadId', element: null }] },
          { path: 'skills', element: <SkillsSection />, children: [{ path: ':skillName', element: null }] },
          { path: 'discord', element: <ServerSettingsSection section="discord" /> },
          { path: 'advanced', element: <ServerSettingsSection section="advanced" /> },
        ],
      },
      { path: 'skills/*', element: <MovedToHub /> },
      { path: 'squads/*', element: <MovedToHub /> },
    ],
  },
];
