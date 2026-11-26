import type { AgentSkillDefinition } from '../models/agent-skill-definition.model.js';
import { ACCESSIBILITY_SKILL } from '../skills/accessibility.skill.js';
import { AGENT_TEAM_SKILL } from '../skills/agent-team.skill.js';
import { API_TESTING_SKILL } from '../skills/api-testing.skill.js';
import { ARTIFACT_BOARD_SKILL } from '../skills/artifact-board.skill.js';
import { ASKING_THE_USER_SKILL } from '../skills/asking-the-user.skill.js';
import { BOARD_REQUESTS_SKILL } from '../skills/board-requests.skill.js';
import { DATA_VISUALIZATION_SKILL } from '../skills/data-visualization.skill.js';
import { DELEGATION_PROTOCOL_SKILL } from '../skills/delegation-protocol.skill.js';
import { DESIGN_SYSTEMS_SKILL } from '../skills/design-systems.skill.js';
import { GIT_REMOTE_SKILL } from '../skills/git-remote.skill.js';
import { INTERACTION_STATES_SKILL } from '../skills/interaction-states.skill.js';
import { LAYOUT_COMPOSITION_SKILL } from '../skills/layout-composition.skill.js';
import { MOBILE_TESTING_SKILL } from '../skills/mobile-testing.skill.js';
import { MOTION_SKILL } from '../skills/motion.skill.js';
import { PROTOTYPING_SKILL } from '../skills/prototyping.skill.js';
import { REPOSITORY_SETUP_SKILL } from '../skills/repository-setup.skill.js';
import { RESPONSE_PROTOCOL_SKILL } from '../skills/response-protocol.skill.js';
import { RESPONSIVE_MOBILE_SKILL } from '../skills/responsive-mobile.skill.js';
import { REVIEW_PUBLISHING_SKILL } from '../skills/review-publishing.skill.js';
import { ROLE_GUIDE_SKILL } from '../skills/role-guide.skill.js';
import { RUNNING_CHECKS_SKILL } from '../skills/running-checks.skill.js';
import { RUNNING_THE_APP_SKILL } from '../skills/running-the-app.skill.js';
import { SKILL_AUTHORING_SKILL } from '../skills/skill-authoring.skill.js';
import { UX_WRITING_SKILL } from '../skills/ux-writing.skill.js';
import { VISUAL_FOUNDATIONS_SKILL } from '../skills/visual-foundations.skill.js';
import { VISUAL_POLISH_SKILL } from '../skills/visual-polish.skill.js';
import { WEB_UI_TESTING_SKILL } from '../skills/web-ui-testing.skill.js';
import { WORKSPACE_NAVIGATION_SKILL } from '../skills/workspace-navigation.skill.js';


export const BUILT_IN_SKILLS: readonly AgentSkillDefinition[] = [
  AGENT_TEAM_SKILL,
  ARTIFACT_BOARD_SKILL,
  DELEGATION_PROTOCOL_SKILL,
  RESPONSE_PROTOCOL_SKILL,
  WORKSPACE_NAVIGATION_SKILL,
  SKILL_AUTHORING_SKILL,
  BOARD_REQUESTS_SKILL,
  ASKING_THE_USER_SKILL,
  RUNNING_THE_APP_SKILL,
  WEB_UI_TESTING_SKILL,
  API_TESTING_SKILL,
  MOBILE_TESTING_SKILL,
  GIT_REMOTE_SKILL,
  REPOSITORY_SETUP_SKILL,
  REVIEW_PUBLISHING_SKILL,
  RUNNING_CHECKS_SKILL,
  ROLE_GUIDE_SKILL,
  VISUAL_FOUNDATIONS_SKILL,
  LAYOUT_COMPOSITION_SKILL,
  RESPONSIVE_MOBILE_SKILL,
  INTERACTION_STATES_SKILL,
  ACCESSIBILITY_SKILL,
  MOTION_SKILL,
  DATA_VISUALIZATION_SKILL,
  DESIGN_SYSTEMS_SKILL,
  PROTOTYPING_SKILL,
  UX_WRITING_SKILL,
  VISUAL_POLISH_SKILL,
];
