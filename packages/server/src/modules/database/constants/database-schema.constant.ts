import { ConversationEntryEntity } from '../../web/entities/conversation-entry.entity.js';
import { ConversationEntity } from '../../web/entities/conversation.entity.js';
import { PromptHistoryEntity } from '../../web/entities/prompt-history.entity.js';
import { LegacyImportEntity } from '../entities/legacy-import.entity.js';
import { CreateLegacyImport1795150000000 } from '../migrations/1795150000000-create-legacy-import.migration.js';
import { CreateWebHistory1795150145081 } from '../migrations/1795150145081-create-web-history.migration.js';


/** Every entity of the database, whichever module owns it. */
export const DATABASE_ENTITIES = [LegacyImportEntity, ConversationEntity, ConversationEntryEntity, PromptHistoryEntity];

/** Every migration, oldest first. A migration once released is never edited: a schema change is a new migration. */
export const DATABASE_MIGRATIONS = [CreateLegacyImport1795150000000, CreateWebHistory1795150145081];
