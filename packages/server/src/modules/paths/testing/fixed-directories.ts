import type { DataDirectoryService } from '../services/data-directory.service.js';
import type { WorkspaceDirectoryService } from '../services/workspace-directory.service.js';


export const dataDirectoryAt = (path: string): DataDirectoryService => ({ resolve: () => path });

export const workspaceDirectoryAt = (path: string): WorkspaceDirectoryService => ({ resolve: () => path });
