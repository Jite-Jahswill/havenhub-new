import type { StyleSpecification } from 'maplibre-gl';

/**
 * Map tiles are provider-agnostic: MapLibre GL renders raster tiles from
 * Mapbox when NEXT_PUBLIC_MAPBOX_TOKEN is set (production), and from
 * OpenStreetMap otherwise (development only — OSM's tile policy forbids
 * heavy production use). Swapping providers only changes this file.
 */
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export function mapStyle(dark: boolean): StyleSpecification {
  const source = MAPBOX_TOKEN
    ? {
        tiles: [
          `https://api.mapbox.com/styles/v1/mapbox/${dark ? 'dark-v11' : 'light-v11'}/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
        ],
        attribution: '© Mapbox © OpenStreetMap',
      }
    : {
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        attribution: '© OpenStreetMap contributors',
      };
  return {
    version: 8,
    sources: { base: { type: 'raster', tileSize: 256, maxzoom: 19, ...source } },
    layers: [
      {
        id: 'base',
        type: 'raster',
        source: 'base',
        // Without Mapbox's dark style, soften OSM tiles in dark mode.
        paint:
          !MAPBOX_TOKEN && dark ? { 'raster-brightness-max': 0.7, 'raster-saturation': -0.4 } : {},
      },
    ],
  };
}

/** Roughly frames Nigeria. */
export const NIGERIA_CENTER: [number, number] = [8.6753, 9.082];
export const NIGERIA_ZOOM = 5.2;
