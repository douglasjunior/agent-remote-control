import { tmpdir } from 'node:os';
import { join } from 'node:path';


export const INTENT_DOCUMENTS_DIR = join(tmpdir(), 'agent-remote-control', 'intents');
