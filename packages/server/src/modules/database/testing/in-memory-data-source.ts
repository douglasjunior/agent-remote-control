import { DataSource } from 'typeorm';

import { DATABASE_ENTITIES, DATABASE_MIGRATIONS } from '../constants/database-schema.constant.js';


/** A database in memory with every migration run, as the application opens its file. */
export function createInMemoryDataSource(): Promise<DataSource> {
  return new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: DATABASE_ENTITIES,
    migrations: DATABASE_MIGRATIONS,
    migrationsRun: true,
  }).initialize();
}
