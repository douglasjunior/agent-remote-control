import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { AgentSettingsEntity } from './agent-settings.entity.js';


/** The agent, model and effort one role uses in a conversation. */
@Entity('agent_profile')
export class AgentProfileEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ type: 'text' })
  role: string;

  @Column({ name: 'agent_id', type: 'text' })
  agentId: string;

  @Column({ name: 'agent_name', type: 'text' })
  agentName: string;

  @Column({ name: 'model_id', type: 'text', nullable: true })
  modelId: string | null;

  @Column({ name: 'model_name', type: 'text', nullable: true })
  modelName: string | null;

  @Column({ name: 'effort_id', type: 'text', nullable: true })
  effortId: string | null;

  @Column({ name: 'effort_name', type: 'text', nullable: true })
  effortName: string | null;

  @ManyToOne(() => AgentSettingsEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id', foreignKeyConstraintName: 'FK_agent_profile_agent_settings' })
  settings?: AgentSettingsEntity;
}
