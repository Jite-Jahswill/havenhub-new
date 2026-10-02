import { ATTACHMENT_LIMITS, type AttachmentKind } from '@havenhub/shared';

/**
 * What an uploaded chat file really is, decided from its bytes. The client's
 * MIME type is never trusted; the file name only disambiguates containers
 * that are safe either way (WebM audio vs video, txt vs csv, which Office
 * format). Anything not positively identified here is refused — including
 * executables, scripts, HTML and SVG.
 */
export interface DetectedType {
  kind: AttachmentKind;
  /** Extension we store under (never the client's). */
  ext: string;
  contentType: string;
  /** Images are decoded and re-encoded before storage. */
  reencode: boolean;
}

const ascii = (b: Buffer, start: number, end: number) => b.subarray(start, end).toString('latin1');
const startsWith = (b: Buffer, bytes: number[]) => bytes.every((v, i) => b[i] === v);

const OOXML: Record<string, { dir: string; contentType: string }> = {
  docx: {
    dir: 'word/',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xlsx: {
    dir: 'xl/',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  pptx: {
    dir: 'ppt/',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
};

export function detectAttachmentType(
  buffer: Buffer,
  fileName: string,
  declaredMime: string | undefined,
): DetectedType | null {
  if (buffer.length < 4) return null;
  const nameExt = fileName.toLowerCase().split('.').pop() ?? '';
  const declaredAudio =
    (declaredMime ?? '').startsWith('audio/') || ['weba', 'ogg', 'opus'].includes(nameExt);

  // Images (re-encoded to WebP)
  if (startsWith(buffer, [0xff, 0xd8, 0xff]) || startsWith(buffer, [0x89, 0x50, 0x4e, 0x47])) {
    return image();
  }
  if (ascii(buffer, 0, 4) === 'GIF8') return image();
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') return image();

  // ISO base media (MP4, MOV, M4A, HEIF/AVIF)
  if (buffer.length >= 12 && ascii(buffer, 4, 8) === 'ftyp') {
    const brand = ascii(buffer, 8, 12);
    if (['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1'].includes(brand)) return image();
    if (brand === 'M4A ' || brand === 'M4B ')
      return { kind: 'AUDIO', ext: 'm4a', contentType: 'audio/mp4', reencode: false };
    if (brand === 'qt  ')
      return { kind: 'VIDEO', ext: 'mov', contentType: 'video/quicktime', reencode: false };
    if (/^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash|3gp[4-6]|3g2[a-c]|mmp4)$/.test(brand)) {
      return declaredAudio
        ? { kind: 'AUDIO', ext: 'm4a', contentType: 'audio/mp4', reencode: false }
        : { kind: 'VIDEO', ext: 'mp4', contentType: 'video/mp4', reencode: false };
    }
    return null;
  }

  // WebM / Matroska (EBML)
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    if (!buffer.subarray(0, 64).includes(Buffer.from('webm'))) return null;
    return declaredAudio
      ? { kind: 'AUDIO', ext: 'webm', contentType: 'audio/webm', reencode: false }
      : { kind: 'VIDEO', ext: 'webm', contentType: 'video/webm', reencode: false };
  }

  // Audio
  if (
    ascii(buffer, 0, 3) === 'ID3' ||
    (buffer[0] === 0xff &&
      (buffer[1]! & 0xe0) === 0xe0 &&
      [0xfb, 0xf3, 0xf2, 0xfa].includes(buffer[1]!))
  ) {
    return { kind: 'AUDIO', ext: 'mp3', contentType: 'audio/mpeg', reencode: false };
  }
  if (ascii(buffer, 0, 4) === 'OggS')
    return { kind: 'AUDIO', ext: 'ogg', contentType: 'audio/ogg', reencode: false };
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WAVE') {
    return { kind: 'AUDIO', ext: 'wav', contentType: 'audio/wav', reencode: false };
  }

  // Documents
  if (ascii(buffer, 0, 5) === '%PDF-')
    return { kind: 'FILE', ext: 'pdf', contentType: 'application/pdf', reencode: false };
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    const office = OOXML[nameExt];
    const text = buffer.toString('latin1');
    // Macro-enabled documents are refused outright.
    if (
      !office ||
      text.includes('vbaProject.bin') ||
      !text.includes('[Content_Types].xml') ||
      !text.includes(office.dir)
    ) {
      return null;
    }
    return { kind: 'FILE', ext: nameExt, contentType: office.contentType, reencode: false };
  }
  if (nameExt === 'txt' || nameExt === 'csv') {
    if (buffer.includes(0)) return null;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return null;
    }
    return {
      kind: 'FILE',
      ext: nameExt,
      contentType: nameExt === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
      reencode: false,
    };
  }
  return null;
}

const image = (): DetectedType => ({
  kind: 'IMAGE',
  ext: 'webp',
  contentType: 'image/webp',
  reencode: true,
});

export const maxBytesFor = (kind: AttachmentKind) => ATTACHMENT_LIMITS[kind].maxBytes;

/**
 * A display name safe to show and to put in Content-Disposition: no path,
 * no control or bidi characters, bounded length, and the extension we
 * actually stored.
 */
export function safeFileName(original: string, ext: string): string {
  const base = (original.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069"<>:|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
  const cleanStem = (stem || 'file').slice(0, 120).replace(/^\.+/, '') || 'file';
  return `${cleanStem}.${ext}`;
}
