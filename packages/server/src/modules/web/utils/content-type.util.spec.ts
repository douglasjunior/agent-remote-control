import { contentTypeOf } from './content-type.util.js';


describe('contentTypeOf', () => {
  it.each([
    ['shot.png', 'image/png'],
    ['PHOTO.JPG', 'image/jpeg'],
    ['voice.ogg', 'audio/ogg'],
    ['voice.m4a', 'audio/mp4'],
    ['recording.webm', 'audio/webm'],
    ['notes.md', 'text/markdown'],
    ['archive.xyz', 'application/octet-stream'],
    ['no-extension', 'application/octet-stream'],
  ])('maps %s to %s', (name, expected) => {
    expect(contentTypeOf(name)).toBe(expected);
  });
});
