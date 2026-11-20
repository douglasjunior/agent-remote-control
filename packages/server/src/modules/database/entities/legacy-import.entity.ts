import { Column, Entity, PrimaryColumn } from 'typeorm';


/** An importer of legacy JSON files whose import was committed; it never runs again. */
@Entity('legacy_import')
export class LegacyImportEntity {
  @PrimaryColumn({ type: 'text' })
  importer: string;

  @Column({ name: 'imported_at', type: 'text' })
  importedAt: string;

  @Column({ type: 'simple-json' })
  counts: Record<string, number>;
}
