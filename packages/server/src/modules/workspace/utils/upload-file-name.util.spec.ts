import { sanitizeUploadFileName } from './upload-file-name.util.js';


describe('sanitizeUploadFileName', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['my photo (1).png', 'my photo (1).png'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\a.txt', 'a.txt'],
    ['.env', 'env'],
    ['..hidden.txt', 'hidden.txt'],
    ['a<b>:"c|d?e*.txt', 'a_b___c_d_e_.txt'],
    ['tab\there.txt', 'tab_here.txt'],
    ['   ', 'file'],
    ['', 'file'],
    ['folder/', 'file'],
  ])('turns %j into %j', (input, expected) => {
    expect(sanitizeUploadFileName(input)).toBe(expected);
  });

  it('shortens a long name and keeps the extension', () => {
    const result = sanitizeUploadFileName(`${'a'.repeat(200)}.png`);

    expect(result).toHaveLength(120);
    expect(result.endsWith('.png')).toBe(true);
  });

  it('shortens a long name that has no usable extension', () => {
    expect(sanitizeUploadFileName('a'.repeat(200))).toHaveLength(120);
    expect(sanitizeUploadFileName(`${'a'.repeat(200)}.${'b'.repeat(30)}`)).toHaveLength(120);
  });
});
