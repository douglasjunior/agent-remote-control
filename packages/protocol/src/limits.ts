export const MAX_MESSAGE_LENGTH = 20_000;
export const MAX_PROMPT_HISTORY = 100;
export const MAX_MENTION_RESULTS = 50;
export const MAX_MENTION_QUERY_LENGTH = 200;
export const BYTES_PER_MB = 1024 * 1024;
/** The most `WEB_UPLOAD_MAX_MB` takes: an agent inspects an attachment with its own tools, which handle files up to this size. */
export const MAX_UPLOAD_MB = 100;
/** Raw bytes per `upload.chunk`; the base64 frame stays well under the 64 KiB a DataChannel message should carry. */
export const UPLOAD_CHUNK_BYTES = 32 * 1024;
/** The most `WEB_MAX_ATTACHMENTS` takes. */
export const MAX_ATTACHMENTS = 50;
export const MAX_ATTACHMENT_PATH_LENGTH = 500;
export const MAX_ATTACHMENT_NAME_LENGTH = 255;
export const MAX_ARTIFACT_TITLE_LENGTH = 200;
export const MAX_CONVERSATION_TITLE_LENGTH = 120;
export const MAX_ARTIFACT_SECTION_LENGTH = 20_000;
export const MAX_SQUAD_NAME_LENGTH = 60;
export const MAX_SQUAD_DESCRIPTION_LENGTH = 500;
