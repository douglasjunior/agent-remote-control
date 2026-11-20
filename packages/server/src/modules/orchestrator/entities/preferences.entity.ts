import { Column, Entity, PrimaryColumn } from 'typeorm';


/** The preferences of the instance, in its only row. */
@Entity('preferences')
export class PreferencesEntity {
  @PrimaryColumn({ type: 'integer' })
  id: number;

  @Column({ type: 'text', nullable: true })
  language: string | null;

  @Column({ name: 'updated_at', type: 'text', nullable: true })
  updatedAt: string | null;
}
