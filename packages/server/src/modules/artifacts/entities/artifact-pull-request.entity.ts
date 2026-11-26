import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { DEFAULT_PULL_REQUEST_REPOSITORY } from '../constants/artifact-catalog.constant.js';

import { ArtifactEntity } from './artifact.entity.js';


/** One pull request linked to an artifact, at its place in the list. */
@Entity('artifact_pull_request')
export class ArtifactPullRequestEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ name: 'artifact_id', type: 'text' })
  artifactId: string;

  @PrimaryColumn({ type: 'integer' })
  position: number;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'text', default: DEFAULT_PULL_REQUEST_REPOSITORY })
  repository: string;

  @Column({ type: 'text' })
  state: string;

  @Column({ name: 'added_at', type: 'text' })
  addedAt: string;

  @ManyToOne(() => ArtifactEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId', foreignKeyConstraintName: 'FK_artifact_pull_request_artifact' },
    { name: 'artifact_id', referencedColumnName: 'id' },
  ])
  artifact?: ArtifactEntity;
}
