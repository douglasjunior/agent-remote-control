import { Module } from '@nestjs/common';

import { PathsModule } from '../paths/paths.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { JsonArtifactStoreAdapter } from './adapters/json-artifact-store.adapter.js';
import { IArtifactStorePort } from './ports/artifact-store.port.js';
import { IArtifactsPort } from './ports/artifacts.port.js';
import { ArtifactEventsService } from './services/artifact-events.service.js';
import { ArtifactHistoryService } from './services/artifact-history.service.js';
import { ArtifactLimitsConfigService } from './services/artifact-limits-config.service.js';
import { ArtifactRulesService } from './services/artifact-rules.service.js';
import { ArtifactsService } from './services/artifacts.service.js';
import { AssignArtifactUseCase } from './use-cases/assign-artifact.use-case.js';
import { CommentOnArtifactUseCase } from './use-cases/comment-on-artifact.use-case.js';
import { CreateArtifactUseCase } from './use-cases/create-artifact.use-case.js';
import { DeleteArtifactUseCase } from './use-cases/delete-artifact.use-case.js';
import { ReleaseArtifactUseCase } from './use-cases/release-artifact.use-case.js';
import { ReleaseStaleAssignmentsUseCase } from './use-cases/release-stale-assignments.use-case.js';
import { UpdateArtifactUseCase } from './use-cases/update-artifact.use-case.js';


@Module({
  imports: [PathsModule, WorkspaceModule],
  providers: [
    { provide: IArtifactStorePort, useClass: JsonArtifactStoreAdapter },
    ArtifactEventsService,
    ArtifactHistoryService,
    ArtifactLimitsConfigService,
    ArtifactRulesService,
    CreateArtifactUseCase,
    UpdateArtifactUseCase,
    CommentOnArtifactUseCase,
    DeleteArtifactUseCase,
    AssignArtifactUseCase,
    ReleaseArtifactUseCase,
    ReleaseStaleAssignmentsUseCase,
    { provide: IArtifactsPort, useClass: ArtifactsService },
  ],
  exports: [IArtifactsPort],
})
export class ArtifactsModule {}
