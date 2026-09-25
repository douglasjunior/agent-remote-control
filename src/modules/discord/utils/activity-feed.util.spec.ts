import { describe, expect, it } from 'vitest';

import { ActivityFeed } from './activity-feed.util.js';


describe('ActivityFeed', () => {
  it('should render entries in insertion order below the header', () => {
    const feed = new ActivityFeed();
    feed.upsert('a', 'first');
    feed.upsert('b', 'second');

    expect(feed.render('H:\n')).toBe('H:\nfirst\nsecond');
  });

  it('should update an existing entry in place', () => {
    const feed = new ActivityFeed();
    feed.upsert('thought:1', 'Think');
    feed.upsert('tool:1', 'Running');
    feed.upsert('thought:1', 'Thinking harder');

    expect(feed.render('')).toBe('Thinking harder\nRunning');
  });

  it('should drop removed entries', () => {
    const feed = new ActivityFeed();
    feed.upsert('a', 'first');
    feed.upsert('b', 'second');
    feed.remove('a');

    expect(feed.render('')).toBe('second');
  });

  it('should show only the most recent entries up to maxEntries', () => {
    const feed = new ActivityFeed({ maxEntries: 2 });
    feed.upsert('a', 'one');
    feed.upsert('b', 'two');
    feed.upsert('c', 'three');

    expect(feed.render('')).toBe('two\nthree');
  });

  it('should drop older entries that do not fit in maxLength', () => {
    const feed = new ActivityFeed({ maxLength: 12 });
    feed.upsert('a', 'older');
    feed.upsert('b', 'newest');

    expect(feed.render('H:')).toBe('H:newest');
  });

  it('should keep the tail of a single entry larger than maxLength', () => {
    const feed = new ActivityFeed({ maxLength: 8 });
    feed.upsert('a', 'abcdefghij');

    const rendered = feed.render('H:');

    expect(rendered).toBe('H:…fghij');
    expect(rendered).toHaveLength(8);
  });
});
