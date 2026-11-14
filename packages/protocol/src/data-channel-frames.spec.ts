import { FrameAssembler, toFrames } from './data-channel-frames.js';


function assemble(frames: string[], assembler = new FrameAssembler(1_000, 4)) {
  return frames.map(frame => assembler.push(frame));
}

describe('data-channel-frames', () => {
  it('should send a short message as a single frame', () => {
    expect(toFrames('{"a":1}')).toEqual(['0/1\n{"a":1}']);
  });

  it('should send an empty message as a single empty frame', () => {
    expect(toFrames('')).toEqual(['0/1\n']);
  });

  it('should split a long message and join it back', () => {
    const frames = toFrames('abcdefghij', 4);

    expect(frames).toEqual(['0/3\nabcd', '1/3\nefgh', '2/3\nij']);
    expect(assemble(frames)).toEqual([{ kind: 'partial' }, { kind: 'partial' }, { kind: 'message', text: 'abcdefghij' }]);
  });

  it('should keep a surrogate pair in one frame', () => {
    const frames = toFrames('abc😀d', 4);

    expect(frames).toEqual(['0/2\nabc', '1/2\n😀d']);
    expect(assemble(frames).at(-1)).toEqual({ kind: 'message', text: 'abc😀d' });
  });

  it('should join consecutive messages', () => {
    const assembler = new FrameAssembler(1_000, 4);

    expect(assemble([...toFrames('one', 4), ...toFrames('second', 4)], assembler)).toEqual([
      { kind: 'message', text: 'one' },
      { kind: 'partial' },
      { kind: 'message', text: 'second' },
    ]);
  });

  it.each([
    ['a frame without a header', ['plain'], 'a frame without a header'],
    ['a frame out of order', ['1/2\nab'], 'frame 1/2 out of order'],
    ['a frame whose count changes', ['0/3\nab', '1/2\ncd'], 'frame 1/2 out of order'],
    ['a message of no frames', ['0/0\n'], 'a message of 0 frames'],
    ['a message of too many frames', ['0/999\nab'], 'a message of 999 frames'],
  ])('should refuse %s', (_name, frames, reason) => {
    expect(assemble(frames).at(-1)).toEqual({ kind: 'invalid', reason });
  });

  it('should refuse a message longer than the limit and accept the next one', () => {
    const assembler = new FrameAssembler(6, 4);

    expect(assemble(toFrames('abcdefgh', 4), assembler)).toEqual([
      { kind: 'partial' },
      { kind: 'invalid', reason: 'a message longer than 6' },
    ]);
    expect(assemble(toFrames('ok', 4), assembler)).toEqual([{ kind: 'message', text: 'ok' }]);
  });
});
