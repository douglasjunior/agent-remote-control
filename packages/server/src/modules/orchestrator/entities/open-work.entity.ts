import { Column, Entity, PrimaryColumn } from 'typeorm';


/** An agent's work in progress in a conversation, at its place in the conversation's list. */
@Entity('open_work')
export class OpenWorkEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'integer' })
  position: number;

  @Column({ type: 'text' })
  role: string;

  @Column({ name: 'role_name', type: 'text' })
  roleName: string;

  @Column({ name: 'project_name', type: 'text', nullable: true })
  projectName: string | null;

  @Column({ name: 'artifact_id', type: 'text', nullable: true })
  artifactId: string | null;

  @Column({ type: 'text' })
  summary: string;

  @Column({ name: 'task_spec', type: 'text' })
  taskSpec: string;

  @Column({ type: 'text' })
  cwd: string;

  @Column({ type: 'integer' })
  round: number;

  @Column({ type: 'boolean' })
  root: boolean;

  /** The questions asked and the answers so far, as JSON. */
  @Column({ type: 'text', nullable: true })
  questions: string | null;
}
