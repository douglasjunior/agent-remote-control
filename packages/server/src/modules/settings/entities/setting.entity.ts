import { Column, Entity, PrimaryColumn } from 'typeorm';


/** A setting saved from the web interface, which takes precedence over its environment variable. */
@Entity('setting')
export class SettingEntity {
  /** The name of the environment variable the setting overrides. */
  @PrimaryColumn({ type: 'text' })
  key: string;

  /** The value as JSON. */
  @Column({ type: 'text' })
  value: string;

  @Column({ name: 'updated_at', type: 'text' })
  updatedAt: string;
}
