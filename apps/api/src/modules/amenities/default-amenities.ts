import type { AmenityCategory } from '@havenhub/shared';

import type { PrismaClient } from '../../generated/prisma/client';
import { amenitySlug } from '../properties/slug';

/** Starter catalogue from the spec (§13, §15). Admins manage it from then on. */
const DEFAULTS: { name: string; category: AmenityCategory; icon: string }[] = [
  { name: 'Wi-Fi', category: 'ESSENTIALS', icon: 'wifi' },
  { name: 'Electricity', category: 'ESSENTIALS', icon: 'zap' },
  { name: 'Generator', category: 'ESSENTIALS', icon: 'battery-charging' },
  { name: 'Water supply', category: 'ESSENTIALS', icon: 'droplets' },
  { name: 'Kitchen', category: 'ESSENTIALS', icon: 'cooking-pot' },
  { name: 'Air conditioning', category: 'ESSENTIALS', icon: 'snowflake' },
  { name: 'Washing machine', category: 'ESSENTIALS', icon: 'washing-machine' },
  { name: 'TV', category: 'FEATURES', icon: 'tv' },
  { name: 'Workspace', category: 'FEATURES', icon: 'laptop' },
  { name: 'Parking', category: 'FEATURES', icon: 'car' },
  { name: 'Swimming pool', category: 'FEATURES', icon: 'waves' },
  { name: 'Gym', category: 'FEATURES', icon: 'dumbbell' },
  { name: 'Balcony', category: 'FEATURES', icon: 'sun' },
  { name: '24/7 security', category: 'SAFETY', icon: 'shield-check' },
  { name: 'CCTV', category: 'SAFETY', icon: 'cctv' },
  { name: 'Gated estate', category: 'SAFETY', icon: 'fence' },
  { name: 'Fire extinguisher', category: 'SAFETY', icon: 'fire-extinguisher' },
  { name: 'Breakfast', category: 'HOSPITALITY', icon: 'coffee' },
  { name: 'Full meals', category: 'HOSPITALITY', icon: 'utensils' },
  { name: 'Room service', category: 'HOSPITALITY', icon: 'concierge-bell' },
];

/** Creates any missing default amenities. Never overwrites admin edits. */
export async function seedDefaultAmenities(prisma: PrismaClient): Promise<number> {
  let created = 0;
  for (const [index, amenity] of DEFAULTS.entries()) {
    const result = await prisma.amenity.upsert({
      where: { slug: amenitySlug(amenity.name) },
      create: { ...amenity, slug: amenitySlug(amenity.name), sortOrder: index },
      update: {},
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) created++;
  }
  return created;
}
