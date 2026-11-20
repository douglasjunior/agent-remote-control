import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { ConversationEntity } from './conversation.entity.js';


/** One entry of a conversation history; `payload` is the whole entry as JSON. */
@Entity('conversation_entry')
@Index('IDX_conversation_entry_position', ['conversationId', 'position'], { unique: true })
export class ConversationEntryEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ name: 'entry_id', type: 'text' })
  entryId: string;

  /** The place of the entry in the history, from 0, kept for good once the entry is first written. */
  @Column({ type: 'integer' })
  position: number;

  @Column({ type: 'text' })
  at: string;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'text' })
  payload: string;

  @ManyToOne(() => ConversationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id', foreignKeyConstraintName: 'FK_conversation_entry_conversation' })
  conversation?: ConversationEntity;
}
