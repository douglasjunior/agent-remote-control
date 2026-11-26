import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { ArtifactEntity } from './artifact.entity.js';


/** One sibling an artifact depends on, at its place in the list. */
@Entity('artifact_dependency')
@Index('IDX_artifact_dependency_depends_on', ['conversationId', 'dependsOnId'])
export class ArtifactDependencyEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ name: 'artifact_id', type: 'text' })
  artifactId: string;

  @PrimaryColumn({ type: 'integer' })
  position: number;

  /** Not a foreign key: the board's rules, not the schema, keep dependencies pointing at artifacts that exist. */
  @Column({ name: 'depends_on_id', type: 'text' })
  dependsOnId: string;

  @ManyToOne(() => ArtifactEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId', foreignKeyConstraintName: 'FK_artifact_dependency_artifact' },
    { name: 'artifact_id', referencedColumnName: 'id' },
  ])
  artifact?: ArtifactEntity;
}
