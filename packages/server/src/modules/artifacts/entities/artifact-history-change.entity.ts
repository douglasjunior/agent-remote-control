import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { ArtifactHistoryEntity } from './artifact-history.entity.js';


/** One field a history event changed, at its place in the event. */
@Entity('artifact_history_change')
export class ArtifactHistoryChangeEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ name: 'artifact_id', type: 'text' })
  artifactId: string;

  @PrimaryColumn({ name: 'event_position', type: 'integer' })
  eventPosition: number;

  @PrimaryColumn({ type: 'integer' })
  position: number;

  @Column({ type: 'text' })
  field: string;

  @Column({ name: 'from_value', type: 'text', nullable: true })
  fromValue: string | null;

  @Column({ name: 'to_value', type: 'text', nullable: true })
  toValue: string | null;

  @ManyToOne(() => ArtifactHistoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId', foreignKeyConstraintName: 'FK_artifact_history_change_artifact_history' },
    { name: 'artifact_id', referencedColumnName: 'artifactId' },
    { name: 'event_position', referencedColumnName: 'position' },
  ])
  event?: ArtifactHistoryEntity;
}
