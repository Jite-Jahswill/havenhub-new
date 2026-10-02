import type { VideoProvider } from '../enums/property.js';

export interface ParsedVideo {
  provider: VideoProvider;
  externalId: string;
}

/**
 * Accepts YouTube and Vimeo links and returns a canonical provider/id pair.
 * Only the id is stored; embed URLs are rebuilt from it, so arbitrary URLs
 * never reach an iframe.
 */
export function parseVideoUrl(input: string): ParsedVideo | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');

  if (host === 'youtu.be') return youtube(url.pathname.slice(1));
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') return youtube(url.searchParams.get('v') ?? '');
    const match = /^\/(embed|shorts|live)\/([^/?#]+)/.exec(url.pathname);
    return match ? youtube(match[2]!) : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const match = /\/(\d{6,12})(?:$|[/?#])/.exec(url.pathname);
    return match ? { provider: 'VIMEO', externalId: match[1]! } : null;
  }
  return null;
}

function youtube(id: string): ParsedVideo | null {
  return /^[A-Za-z0-9_-]{11}$/.test(id) ? { provider: 'YOUTUBE', externalId: id } : null;
}

export function videoEmbedUrl(video: ParsedVideo): string {
  return video.provider === 'YOUTUBE'
    ? `https://www.youtube-nocookie.com/embed/${video.externalId}`
    : `https://player.vimeo.com/video/${video.externalId}`;
}
