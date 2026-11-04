const MAX_NAME_LENGTH = 120;
const FALLBACK_NAME = 'file';

/** Keeps the last path segment, drops control and reserved characters and leading dots, and bounds the length keeping the extension. */
export function sanitizeUploadFileName(name: string): string {
  const lastSegment = name.split(/[\\/]/).at(-1) ?? '';
  const cleaned = lastSegment
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .trim()
    .replace(/^\.+/, '');
  if (cleaned === '') {
    return FALLBACK_NAME;
  }
  if (cleaned.length <= MAX_NAME_LENGTH) {
    return cleaned;
  }
  const extensionStart = cleaned.lastIndexOf('.');
  const extension = extensionStart > 0 && cleaned.length - extensionStart <= 16 ? cleaned.slice(extensionStart) : '';
  return cleaned.slice(0, MAX_NAME_LENGTH - extension.length) + extension;
}
