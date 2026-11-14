export const MAX_MESSAGE_LENGTH = 20_000;
export const MAX_PROMPT_HISTORY = 100;
export const MAX_MENTION_RESULTS = 50;
export const MAX_MENTION_QUERY_LENGTH = 200;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Raw bytes per `upload.chunk`; the base64 frame stays well under the 64 KiB a DataChannel message should carry. */
export const UPLOAD_CHUNK_BYTES = 32 * 1024;
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_PATH_LENGTH = 500;
export const MAX_ATTACHMENT_NAME_LENGTH = 255;
export const MAX_ARTIFACT_TITLE_LENGTH = 200;
export const MAX_CONVERSATION_TITLE_LENGTH = 120;
export const MAX_ARTIFACT_SECTION_LENGTH = 20_000;
