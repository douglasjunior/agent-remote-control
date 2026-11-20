import { Column, Entity, Index, PrimaryColumn } from 'typeorm';


@Entity('conversation')
@Index('IDX_conversation_updated_at', ['updatedAt'])
export class ConversationEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ name: 'created_at', type: 'text' })
  createdAt: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt: string;

  @Column({ name: 'archived_at', type: 'text', nullable: true })
  archivedAt: string | null;
}
