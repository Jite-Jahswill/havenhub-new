import { describe, expect, it } from 'vitest';

import { detectAttachmentType, safeFileName } from './attachment-types';

const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(
    parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))),
  );
const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc(64)]);

describe('detectAttachmentType', () => {
  it.each([
    ['jpeg', pad(bytes([0xff, 0xd8, 0xff, 0xe0])), 'x.jpg', 'IMAGE', 'webp'],
    ['png', pad(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'x.png', 'IMAGE', 'webp'],
    ['mp4', pad(bytes([0, 0, 0, 0x18], 'ftypisom')), 'clip.mp4', 'VIDEO', 'mp4'],
    ['mov', pad(bytes([0, 0, 0, 0x14], 'ftypqt  ')), 'clip.mov', 'VIDEO', 'mov'],
    ['m4a', pad(bytes([0, 0, 0, 0x1c], 'ftypM4A ')), 'note.m4a', 'AUDIO', 'm4a'],
    ['mp3', pad(bytes('ID3', [3, 0])), 'song.mp3', 'AUDIO', 'mp3'],
    ['ogg', pad(bytes('OggS')), 'voice.ogg', 'AUDIO', 'ogg'],
    ['wav', pad(bytes('RIFF', [0, 0, 0, 0], 'WAVE')), 'a.wav', 'AUDIO', 'wav'],
    ['pdf', pad(bytes('%PDF-1.7')), 'lease.pdf', 'FILE', 'pdf'],
    ['csv', Buffer.from('a,b\n1,2\n'), 'rent.csv', 'FILE', 'csv'],
  ])('%s', (_, buf, name, kind, ext) => {
    expect(detectAttachmentType(buf, name, undefined)).toMatchObject({ kind, ext });
  });

  it('identifies a real Word document and refuses macro-enabled or disguised zips', () => {
    const docx = bytes([0x50, 0x4b, 0x03, 0x04], '....[Content_Types].xml....word/document.xml');
    expect(detectAttachmentType(docx, 'lease.docx', undefined)).toMatchObject({ ext: 'docx' });
    const macro = bytes([0x50, 0x4b, 0x03, 0x04], '[Content_Types].xml word/ vbaProject.bin');
    expect(detectAttachmentType(macro, 'lease.docx', undefined)).toBeNull();
    expect(detectAttachmentType(docx, 'lease.zip', undefined)).toBeNull();
  });

  it.each([
    ['windows executable', bytes('MZ', [0x90, 0, 3, 0]), 'invoice.pdf'],
    ['html', Buffer.from('<html><script>alert(1)</script>'), 'page.html'],
    ['svg', Buffer.from('<svg onload="alert(1)"/>'), 'logo.svg'],
    ['shell script named .txt with a NUL byte', Buffer.from('#!/bin/sh\0rm -rf /'), 'notes.txt'],
    ['binary named .txt', Buffer.from([0xc3, 0x28, 0xa0, 0xa1]), 'notes.txt'],
    ['png named .exe is still only an image', pad(bytes([0x89, 0x50, 0x4e, 0x47])), 'x.exe'],
  ])('refuses %s (or reduces it to a safe type)', (label, buf, name) => {
    const result = detectAttachmentType(buf, name, 'application/pdf');
    if (label.startsWith('png')) expect(result).toMatchObject({ kind: 'IMAGE', ext: 'webp' });
    else expect(result).toBeNull();
  });
});

describe('safeFileName', () => {
  it('strips paths, control and bidi characters, and forces the stored extension', () => {
    expect(safeFileName('../../etc/passwd', 'txt')).toBe('passwd.txt');
    expect(safeFileName('C:\\Users\\me\\lease agreement.pdf', 'pdf')).toBe('lease agreement.pdf');
    expect(safeFileName('photo\u202Egpj.exe', 'webp')).toBe('photogpj.webp');
    expect(safeFileName('', 'pdf')).toBe('file.pdf');
    expect(safeFileName('x'.repeat(400) + '.pdf', 'pdf')).toHaveLength(124);
  });
});
