import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { ArtifactEntity } from './artifact.entity.js';


/** One project folder linked to a feature, at its place in the list. */
@Entity('artifact_project')
export class ArtifactProjectEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ name: 'artifact_id', type: 'text' })
  artifactId: string;

  @PrimaryColumn({ type: 'integer' })
  position: number;

  @Column({ name: 'project_name', type: 'text' })
  projectName: string;

  @ManyToOne(() => ArtifactEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId', foreignKeyConstraintName: 'FK_artifact_project_artifact' },
    { name: 'artifact_id', referencedColumnName: 'id' },
  ])
  artifact?: ArtifactEntity;
}
