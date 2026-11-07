import { isUploadPathOf, uploadDirectory } from './upload-path.util.js';


describe('upload paths', () => {
  it('keeps the uploads of a conversation under a hidden directory of the workspace', () => {
    expect(uploadDirectory('web-1')).toBe('.arc-uploads/web-1');
  });

  it.each([
    ['.arc-uploads/web-1/a.png', true],
    ['.arc-uploads/web-1/sub/a.png', true],
    ['.arc-uploads/web-2/a.png', false],
    ['.arc-uploads/web-1', false],
    ['.arc-uploads/web-1/../web-2/a.png', false],
    ['.arc-uploads/web-1/../../secret', false],
    ['/etc/passwd', false],
    ['app/a.png', false],
  ])('judges %s as %s', (path, expected) => {
    expect(isUploadPathOf('web-1', path)).toBe(expected);
  });
});
