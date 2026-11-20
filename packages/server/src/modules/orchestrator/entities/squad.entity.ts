import { Column, Entity, PrimaryColumn } from 'typeorm';


/** A saved set of role profiles; its profiles are the rows of `squad_profile`. */
@Entity('squad')
export class SquadEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_default', type: 'boolean' })
  isDefault: boolean;

  @Column({ name: 'created_at', type: 'text' })
  createdAt: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt: string;
}
