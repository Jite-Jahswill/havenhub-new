/// <reference types="google.maps" />

/**
 * Google Maps. Single-location maps use the Maps Embed iframe, which works
 * without a key (the keyed Embed API is used when one is set). The
 * interactive results map needs the Maps JavaScript API and therefore
 * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; without it, search falls back to MapLibre.
 */
export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || undefined;

/** Advanced markers need a map ID; Google's DEMO_MAP_ID is fine until one is created. */
export const GOOGLE_MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';

export function googleEmbedUrl(latitude: number, longitude: number, zoom = 15): string {
  const q = `${latitude},${longitude}`;
  return GOOGLE_MAPS_KEY
    ? `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_KEY}&q=${q}&zoom=${zoom}`
    : `https://maps.google.com/maps?q=${q}&z=${zoom}&output=embed`;
}

export function googleMapsLink(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

let loading: Promise<typeof google.maps> | null = null;

/** Loads the Maps JavaScript API once per page. */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (!GOOGLE_MAPS_KEY)
    return Promise.reject(new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set'));
  loading ??= new Promise((resolve, reject) => {
    const callback = '__havenhubGoogleMapsReady';
    (window as unknown as Record<string, () => void>)[callback] = () => resolve(google.maps);
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&loading=async&libraries=marker&callback=${callback}`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error('Google Maps failed to load'));
    };
    document.head.append(script);
  });
  return loading;
}
