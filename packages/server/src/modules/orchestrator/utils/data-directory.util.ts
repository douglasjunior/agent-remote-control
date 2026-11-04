import { resolve } from 'node:path';


export function resolveDataDirectory(custom?: string): string {
  if (custom) {
    return resolve(custom);
  }
  const fromEnv = process.env.DATA_DIR?.trim();
  if (fromEnv) {
    return resolve(fromEnv);
  }
  return resolve(process.cwd(), 'data');
}
