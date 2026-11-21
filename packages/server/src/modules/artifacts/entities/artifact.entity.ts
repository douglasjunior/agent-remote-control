import { Column, Entity, Index, PrimaryColumn } from 'typeorm';


/** One artifact of a conversation board; its lists are the rows of the other `artifact_*` tables. */
@Entity('artifact')
@Index('IDX_artifact_status', ['conversationId', 'status'])
@Index('IDX_artifact_parent', ['conversationId', 'parentId'])
export class ArtifactEntity {
  @PrimaryColumn({ name: 'conversation_id', type: 'text' })
  conversationId: string;

  @PrimaryColumn({ type: 'text' })
  id: string;

  /** The order of the board: an artifact keeps the place it took when it was first saved. */
  @Column({ type: 'integer' })
  position: number;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  status: string;

  @Column({ name: 'parent_id', type: 'text', nullable: true })
  parentId: string | null;

  /** The project of a task; `NULL` for a feature, whose projects are the rows of `artifact_project`. */
  @Column({ name: 'project_name', type: 'text', nullable: true })
  projectName: string | null;

  /** The holder's columns are all set or all `NULL`. */
  @Column({ name: 'assignee_role', type: 'text', nullable: true })
  assigneeRole: string | null;

  @Column({ name: 'assignee_role_name', type: 'text', nullable: true })
  assigneeRoleName: string | null;

  @Column({ name: 'assignee_delegation_id', type: 'text', nullable: true })
  assigneeDelegationId: string | null;

  @Column({ name: 'assignee_since', type: 'text', nullable: true })
  assigneeSince: string | null;

  @Column({ type: 'text', nullable: true })
  branch: string | null;

  @Column({ name: 'created_at', type: 'text' })
  createdAt: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt: string;
}
