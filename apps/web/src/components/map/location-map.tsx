'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import './maplibre-setup';

import { cn } from '@havenhub/ui';
import { Map as MapLibre, Marker, NavigationControl, type MapMouseEvent } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import { NIGERIA_CENTER, NIGERIA_ZOOM, mapStyle } from './map-config';
import { useIsDark } from './use-dark';

/**
 * Single-location map. Read-only by default; with `onPick`, clicking or
 * dragging the pin sets the location (used by the listing form).
 */
export function LocationMap({
  latitude,
  longitude,
  onPick,
  className,
  zoom = 14,
}: {
  latitude: number | null;
  longitude: number | null;
  onPick?: (latitude: number, longitude: number) => void;
  className?: string;
  zoom?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const marker = useRef<Marker | null>(null);
  const dark = useIsDark();
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  });

  useEffect(() => {
    if (!container.current) return;
    const hasPoint = latitude !== null && longitude !== null;
    const instance = new MapLibre({
      container: container.current,
      style: mapStyle(dark),
      center: hasPoint ? [longitude, latitude] : NIGERIA_CENTER,
      zoom: hasPoint ? zoom : NIGERIA_ZOOM,
      attributionControl: { compact: true },
      interactive: true,
      scrollZoom: Boolean(onPickRef.current),
    });
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    if (onPickRef.current) {
      instance.on('click', (event: MapMouseEvent) => {
        const { lat, lng } = event.lngLat;
        onPickRef.current?.(Number(lat.toFixed(6)), Number(lng.toFixed(6)));
      });
    }
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      marker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setStyle(mapStyle(dark));
  }, [dark]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (latitude === null || longitude === null) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = new Marker({ color: '#D82227', draggable: Boolean(onPickRef.current) })
        .setLngLat([longitude, latitude])
        .addTo(instance);
      const created = marker.current;
      created.on('dragend', () => {
        const { lat, lng } = created.getLngLat();
        onPickRef.current?.(Number(lat.toFixed(6)), Number(lng.toFixed(6)));
      });
      instance.jumpTo({ center: [longitude, latitude], zoom: Math.max(instance.getZoom(), zoom) });
    } else {
      marker.current.setLngLat([longitude, latitude]);
    }
  }, [latitude, longitude, zoom]);

  return (
    <div
      ref={container}
      className={cn('size-full', onPick && 'cursor-crosshair', className)}
      role="region"
      aria-label={onPick ? 'Map: click to set the property location' : 'Property location map'}
    />
  );
}
