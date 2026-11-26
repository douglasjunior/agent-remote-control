import { Column, Entity, Index, PrimaryColumn } from 'typeorm';


/** The agent settings of one conversation; its profiles are the rows of `agent_profile`. */
@Entity('agent_settings')
@Index('IDX_agent_settings_updated_at', ['updatedAt'])
export class AgentSettingsEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  /** The squad whose profiles were last copied in, kept after the squad is deleted. */
  @Column({ name: 'applied_squad_id', type: 'text', nullable: true })
  appliedSquadId: string | null;

  @Column({ name: 'applied_squad_name', type: 'text', nullable: true })
  appliedSquadName: string | null;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt: string;
}
