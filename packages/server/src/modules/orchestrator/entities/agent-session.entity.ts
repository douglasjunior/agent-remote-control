import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { SessionEntity } from './session.entity.js';


/** The ACP session one role keeps in an agent, project and artifact of a conversation, at its place in the list. */
@Entity('agent_session')
export class AgentSessionEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ type: 'integer' })
  position: number;

  @Column({ type: 'text' })
  role: string;

  @Column({ name: 'agent_id', type: 'text' })
  agentId: string;

  @Column({ name: 'session_id', type: 'text' })
  sessionId: string;

  @Column({ name: 'project_name', type: 'text', nullable: true })
  projectName: string | null;

  @Column({ name: 'artifact_id', type: 'text', nullable: true })
  artifactId: string | null;

  @Column({ name: 'work_ended_at', type: 'text', nullable: true })
  workEndedAt: string | null;

  /** Set only while the agent has not started answering the prompt that created the session. */
  @Column({ type: 'boolean', nullable: true })
  unanswered: boolean | null;

  @ManyToOne(() => SessionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id', foreignKeyConstraintName: 'FK_agent_session_session' })
  session?: SessionEntity;
}
