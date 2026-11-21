import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { ArtifactEntity } from './artifact.entity.js';


/** The Markdown of one section of an artifact. */
@Entity('artifact_section')
export class ArtifactSectionEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ name: 'artifact_id', type: 'text' })
  artifactId: string;

  @PrimaryColumn({ type: 'text' })
  section: string;

  @Column({ type: 'text' })
  content: string;

  @ManyToOne(() => ArtifactEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId', foreignKeyConstraintName: 'FK_artifact_section_artifact' },
    { name: 'artifact_id', referencedColumnName: 'id' },
  ])
  artifact?: ArtifactEntity;
}
