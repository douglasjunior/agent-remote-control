import { Entity, PrimaryColumn } from 'typeorm';


/** A conversation whose agent sessions are stored, even while it has none; they are the rows of `agent_session`. */
@Entity('session')
export class SessionEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;
}
