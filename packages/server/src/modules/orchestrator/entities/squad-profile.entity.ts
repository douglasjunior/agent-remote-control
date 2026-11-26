import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { SquadEntity } from './squad.entity.js';


/** The agent, model and effort a squad gives one role. */
@Entity('squad_profile')
export class SquadProfileEntity {
  @PrimaryColumn({ name: 'squad_id', type: 'text' })
  squadId: string;

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

  @ManyToOne(() => SquadEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'squad_id', foreignKeyConstraintName: 'FK_squad_profile_squad' })
  squad?: SquadEntity;
}
