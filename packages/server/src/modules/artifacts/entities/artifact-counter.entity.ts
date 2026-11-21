import { Column, Entity, PrimaryColumn } from 'typeorm';


/** The last number given to an id prefix in a conversation, kept after its artifacts are deleted so ids are never reused. */
@Entity('artifact_counter')
export class ArtifactCounterEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ type: 'text' })
  prefix: string;

  @Column({ type: 'integer' })
  value: number;
}
