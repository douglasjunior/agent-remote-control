import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { ArtifactEntity } from './artifact.entity.js';


/** One event of an artifact's history, at its place in it; its field changes are the rows of `artifact_history_change`. */
@Entity('artifact_history')
export class ArtifactHistoryEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ name: 'artifact_id', type: 'text' })
  artifactId: string;

  @PrimaryColumn({ type: 'integer' })
  position: number;

  @Column({ name: 'event_id', type: 'text' })
  eventId: string;

  @Column({ type: 'text' })
  at: string;

  /** `role` and `role_name` are set for an agent, `channel` for a user. */
  @Column({ name: 'actor_kind', type: 'text' })
  actorKind: string;

  @Column({ name: 'actor_role', type: 'text', nullable: true })
  actorRole: string | null;

  @Column({ name: 'actor_role_name', type: 'text', nullable: true })
  actorRoleName: string | null;

  @Column({ name: 'actor_channel', type: 'text', nullable: true })
  actorChannel: string | null;

  @Column({ type: 'text' })
  kind: string;

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'text', nullable: true })
  text: string | null;

  @ManyToOne(() => ArtifactEntity, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'conversation_id', referencedColumnName: 'conversationId', foreignKeyConstraintName: 'FK_artifact_history_artifact' },
    { name: 'artifact_id', referencedColumnName: 'id' },
  ])
  artifact?: ArtifactEntity;
}
