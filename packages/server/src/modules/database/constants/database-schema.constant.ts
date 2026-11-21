import { ArtifactCounterEntity } from '../../artifacts/entities/artifact-counter.entity.js';
import { ArtifactDependencyEntity } from '../../artifacts/entities/artifact-dependency.entity.js';
import { ArtifactHistoryChangeEntity } from '../../artifacts/entities/artifact-history-change.entity.js';
import { ArtifactHistoryEntity } from '../../artifacts/entities/artifact-history.entity.js';
import { ArtifactProjectEntity } from '../../artifacts/entities/artifact-project.entity.js';
import { ArtifactPullRequestEntity } from '../../artifacts/entities/artifact-pull-request.entity.js';
import { ArtifactRefinementEntity } from '../../artifacts/entities/artifact-refinement.entity.js';
import { ArtifactSectionEntity } from '../../artifacts/entities/artifact-section.entity.js';
import { ArtifactEntity } from '../../artifacts/entities/artifact.entity.js';
import { AgentProfileEntity } from '../../orchestrator/entities/agent-profile.entity.js';
import { AgentSessionEntity } from '../../orchestrator/entities/agent-session.entity.js';
import { AgentSettingsEntity } from '../../orchestrator/entities/agent-settings.entity.js';
import { OpenWorkEntity } from '../../orchestrator/entities/open-work.entity.js';
import { PreferencesEntity } from '../../orchestrator/entities/preferences.entity.js';
import { SessionEntity } from '../../orchestrator/entities/session.entity.js';
import { SquadProfileEntity } from '../../orchestrator/entities/squad-profile.entity.js';
import { SquadEntity } from '../../orchestrator/entities/squad.entity.js';
import { SettingEntity } from '../../settings/entities/setting.entity.js';
import { ConversationEntryEntity } from '../../web/entities/conversation-entry.entity.js';
import { ConversationEntity } from '../../web/entities/conversation.entity.js';
import { PromptHistoryEntity } from '../../web/entities/prompt-history.entity.js';
import { LegacyImportEntity } from '../entities/legacy-import.entity.js';
import { CreateLegacyImport1795150000000 } from '../migrations/1795150000000-create-legacy-import.migration.js';
import { CreateWebHistory1795150145081 } from '../migrations/1795150145081-create-web-history.migration.js';
import { CreateSettings1795160000000 } from '../migrations/1795160000000-create-settings.migration.js';
import { CreateAgentSettings1795170000000 } from '../migrations/1795170000000-create-agent-settings.migration.js';
import { CreateSquads1795180000000 } from '../migrations/1795180000000-create-squads.migration.js';
import { CreateArtifacts1795190000000 } from '../migrations/1795190000000-create-artifacts.migration.js';
import { CreateSessions1795200000000 } from '../migrations/1795200000000-create-sessions.migration.js';
import { CreateOpenWork1795210000000 } from '../migrations/1795210000000-create-open-work.migration.js';
import { AddOpenWorkUpdates1795220000000 } from '../migrations/1795220000000-add-open-work-updates.migration.js';
import { AddAgentSessionPromptHash1795230000000 } from '../migrations/1795230000000-add-agent-session-prompt-hash.migration.js';
import { AddArtifactProjects1795240000000 } from '../migrations/1795240000000-add-artifact-projects.migration.js';
import { KeyFeatureSessionsToRoot1795250000000 } from '../migrations/1795250000000-key-feature-sessions-to-root.migration.js';


/** Every entity of the database, whichever module owns it. */
export const DATABASE_ENTITIES = [
  LegacyImportEntity, ConversationEntity, ConversationEntryEntity, PromptHistoryEntity, SettingEntity, PreferencesEntity, AgentSettingsEntity, AgentProfileEntity, SquadEntity, SquadProfileEntity,
  ArtifactEntity, ArtifactRefinementEntity, ArtifactSectionEntity, ArtifactDependencyEntity, ArtifactProjectEntity, ArtifactPullRequestEntity, ArtifactHistoryEntity,
  ArtifactHistoryChangeEntity, ArtifactCounterEntity, SessionEntity, AgentSessionEntity, OpenWorkEntity,
];

/** Every migration, oldest first. A migration once released is never edited: a schema change is a new migration. */
export const DATABASE_MIGRATIONS = [CreateLegacyImport1795150000000, CreateWebHistory1795150145081, CreateSettings1795160000000, CreateAgentSettings1795170000000, CreateSquads1795180000000, CreateArtifacts1795190000000, CreateSessions1795200000000, CreateOpenWork1795210000000, AddOpenWorkUpdates1795220000000, AddAgentSessionPromptHash1795230000000, AddArtifactProjects1795240000000, KeyFeatureSessionsToRoot1795250000000];
