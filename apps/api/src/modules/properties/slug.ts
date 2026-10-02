import { randomBytes } from 'node:crypto';

/** "3-Bedroom Flat in Lekki Phase 1!" → "3-bedroom-flat-in-lekki-phase-1-a1b2c3" */
export function propertySlug(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return `${base || 'property'}-${randomBytes(3).toString('hex')}`;
}

export function amenitySlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
