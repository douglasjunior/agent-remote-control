import type { EntityManager } from 'typeorm';


/** Rows per insert, well under the limit of bound parameters of a SQLite statement. */
const INSERT_BATCH = 500;

export async function insertInBatches<T extends object>(manager: EntityManager, entity: new () => T, rows: readonly T[]): Promise<void> {
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    await manager.insert(entity, rows.slice(start, start + INSERT_BATCH));
  }
}
