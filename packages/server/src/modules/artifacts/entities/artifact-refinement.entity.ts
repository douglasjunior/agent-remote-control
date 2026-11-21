import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { ArtifactEntity } from './artifact.entity.js';


/** Whether one kind of refinement of an artifact is still owed; a kind without a row is owed. */
@Entity('artifact_refinement')
export class ArtifactRefinementEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ name: 'artifact_id', type: 'text' })
  artifactId: string;

  @PrimaryColumn({ type: 'text' })
  kind: string;

  @Column({ type: 'text' })
  state: string;

  @ManyToOne(() => ArtifactEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId', foreignKeyConstraintName: 'FK_artifact_refinement_artifact' },
    { name: 'artifact_id', referencedColumnName: 'id' },
  ])
  artifact?: ArtifactEntity;
}
