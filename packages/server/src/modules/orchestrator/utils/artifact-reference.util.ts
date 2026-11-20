const ARTIFACT_ID = /^[a-z]-\d+$/i;
const NONE = 'none';

/** Ids are written as `T-1`; any other value, such as the ref of an artifact created in the same response, keeps its spelling. */
export function normalizeArtifactId(value: string): string {
  return ARTIFACT_ID.test(value) ? value.toUpperCase() : value;
}

/** A parent or branch written as `none` or left empty clears the field. */
export function isNoneValue(value: string): boolean {
  return value === '' || value.toLowerCase() === NONE;
}

export function readArtifactReference(raw: string): string | null {
  return isNoneValue(raw) ? null : normalizeArtifactId(raw);
}
