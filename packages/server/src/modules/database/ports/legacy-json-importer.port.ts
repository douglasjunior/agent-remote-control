import type { EntityManager } from 'typeorm';


/** What an importer read from the legacy JSON files, ready to be written. */
export type LegacyJsonImport = {
  /** The files read, relative to `DATA_DIR`, moved to the backup once the import is committed. */
  readonly files: readonly string[];
  /** What the import holds, by kind, for the summary log and the `legacy_import` row. */
  readonly counts: Readonly<Record<string, number>>;
  /** Writes the rows, inside the transaction that records the import. */
  write(manager: EntityManager): Promise<void>;
};

/**
 * Imports the JSON files of one store of earlier versions into the database. It runs on boot until one of its imports
 * is committed, and never again.
 */
export interface ILegacyJsonImporterPort {
  /** Recorded in `legacy_import`; never renamed once released. */
  readonly name: string;
  /** Reads the files without changing them. A missing file holds nothing; a file that does not parse is left out of `files`. */
  read(): Promise<LegacyJsonImport>;
}

/** Every importer, in the order they run. */
export const ILegacyJsonImporterPort = Symbol('ILegacyJsonImporterPort');
