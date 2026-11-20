import { AgentProfileEntity } from '../../orchestrator/entities/agent-profile.entity.js';
import { AgentSettingsEntity } from '../../orchestrator/entities/agent-settings.entity.js';
import { PreferencesEntity } from '../../orchestrator/entities/preferences.entity.js';
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


/** Every entity of the database, whichever module owns it. */
export const DATABASE_ENTITIES = [LegacyImportEntity, ConversationEntity, ConversationEntryEntity, PromptHistoryEntity, SettingEntity, PreferencesEntity, AgentSettingsEntity, AgentProfileEntity, SquadEntity, SquadProfileEntity];

/** Every migration, oldest first. A migration once released is never edited: a schema change is a new migration. */
export const DATABASE_MIGRATIONS = [CreateLegacyImport1795150000000, CreateWebHistory1795150145081, CreateSettings1795160000000, CreateAgentSettings1795170000000, CreateSquads1795180000000];
