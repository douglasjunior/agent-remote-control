import { Logger } from '@nestjs/common';


const DIGITS = /^\d+$/;
const logger = new Logger('EnvNumber');

/** A non-negative integer written in digits only; `fallback` when the variable is unset or is not one. */
export function readNonNegativeInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  if (!DIGITS.test(raw)) {
    logger.warn(`${name}="${raw}" is not a non-negative integer; using ${fallback}`);
    return fallback;
  }
  return Number(raw);
}
