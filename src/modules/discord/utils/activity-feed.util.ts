const TRUNCATION_MARKER = '…';

export interface ActivityFeedOptions {
  maxEntries?: number;
  maxLength?: number;
}

export class ActivityFeed {
  private readonly entries = new Map<string, string>();
  private readonly maxEntries: number;
  private readonly maxLength: number;

  constructor(options?: ActivityFeedOptions) {
    this.maxEntries = options?.maxEntries ?? 8;
    this.maxLength = options?.maxLength ?? 2000;
  }

  upsert(key: string, content: string): void {
    this.entries.set(key, content);
  }

  remove(key: string): void {
    this.entries.delete(key);
  }

  render(header: string): string {
    const budget = this.maxLength - header.length;
    const visible: string[] = [];
    let length = 0;

    for (const entry of Array.from(this.entries.values()).reverse()) {
      if (visible.length === this.maxEntries) {
        break;
      }
      const separator = visible.length > 0 ? 1 : 0;
      const remaining = budget - length - separator;
      if (entry.length <= remaining) {
        visible.unshift(entry);
        length += entry.length + separator;
        continue;
      }
      if (visible.length === 0) {
        visible.unshift(TRUNCATION_MARKER + entry.slice(entry.length - remaining + TRUNCATION_MARKER.length));
      }
      break;
    }

    return header + visible.join('\n');
  }
}
