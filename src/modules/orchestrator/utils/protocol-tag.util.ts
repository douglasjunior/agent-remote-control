export type TagAttributes = ReadonlyMap<string, string>;

export type TagBody = { readonly content: string; readonly end: number };

const ATTRIBUTE = /([A-Za-z][\w-]*)=(?:"([^"]*)"|'([^']*)')/g;

export function parseTagAttributes(rawTag: string, rawAttributes: string, allowed: readonly string[]): TagAttributes | string {
  const attributes = new Map<string, string>();
  for (const [, name, doubleQuoted, singleQuoted] of rawAttributes.matchAll(ATTRIBUTE)) {
    const key = name!.toLowerCase();
    if (!allowed.includes(key)) {
      const allowedList = allowed.map(attribute => `"${attribute}"`).join(', ');
      return allowed.length > 0
        ? `Unknown attribute "${name}" in ${rawTag}. Use only ${allowedList}.`
        : `Unknown attribute "${name}" in ${rawTag}. This tag takes no attributes.`;
    }
    attributes.set(key, (doubleQuoted ?? singleQuoted)!.trim());
  }
  if (rawAttributes.replace(ATTRIBUTE, '').trim()) {
    return `Malformed tag ${rawTag}. Write each attribute as name="value".`;
  }
  return attributes;
}

/** Tags of the same name never nest, so the first closing tag ends the body. */
export function readTagBody(text: string, name: string, contentStart: number): TagBody | string {
  const closingTag = `</${name}>`;
  const close = text.toLowerCase().indexOf(closingTag, contentStart);
  const content = close < 0 ? '' : text.slice(contentStart, close);
  if (close < 0 || new RegExp(String.raw`<${name}\b`, 'i').test(content)) {
    return `Every <${name}> must be closed with ${closingTag} before the next <${name}> starts.`;
  }
  return { content, end: close + closingTag.length };
}

export function escapeTagAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\s+/g, ' ').trim();
}
