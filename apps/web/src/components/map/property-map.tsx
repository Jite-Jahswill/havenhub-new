'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import './maplibre-setup';

import { cn } from '@havenhub/ui';
import { LngLatBounds, Map as MapLibre, Marker, NavigationControl } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import { NIGERIA_CENTER, NIGERIA_ZOOM, mapStyle } from './map-config';
import { useIsDark } from './use-dark';

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  title: string;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Interactive results map. Markers mirror the visible result list; the
 * active marker is highlighted, and selecting a marker reports its id.
 */
export function PropertyMap({
  markers,
  activeId,
  onSelect,
  onMoveEnd,
  className,
}: {
  markers: MapMarker[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onMoveEnd?: (bounds: Bounds) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const markerRefs = useRef(new Map<string, { marker: Marker; el: HTMLButtonElement }>());
  const dark = useIsDark();
  const onSelectRef = useRef(onSelect);
  const onMoveEndRef = useRef(onMoveEnd);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onMoveEndRef.current = onMoveEnd;
  });

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibre({
      container: container.current,
      style: mapStyle(dark),
      center: NIGERIA_CENTER,
      zoom: NIGERIA_ZOOM,
      attributionControl: { compact: true },
      cooperativeGestures: false,
    });
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    instance.on('moveend', (event: { originalEvent?: unknown }) => {
      if (!event.originalEvent) return; // ignore programmatic fits
      const b = instance.getBounds();
      onMoveEndRef.current?.({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
    });
    map.current = instance;
    const refs = markerRefs.current;
    return () => {
      refs.clear();
      instance.remove();
      map.current = null;
    };
    // The map is created once; theme changes swap the style below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setStyle(mapStyle(dark));
  }, [dark]);

  // Sync markers with results and frame them.
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const refs = markerRefs.current;
    for (const [id, { marker }] of refs) {
      if (!markers.some((m) => m.id === id)) {
        marker.remove();
        refs.delete(id);
      }
    }
    for (const item of markers) {
      if (refs.has(item.id)) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'hh-map-pin';
      el.textContent = item.label;
      el.setAttribute('aria-label', `${item.title}, ${item.label}`);
      el.addEventListener('click', (event) => {
        event.stopPropagation();
        onSelectRef.current(item.id);
      });
      const marker = new Marker({ element: el })
        .setLngLat([item.longitude, item.latitude])
        .addTo(instance);
      refs.set(item.id, { marker, el });
    }
    if (markers.length) {
      const bounds = new LngLatBounds();
      for (const m of markers) bounds.extend([m.longitude, m.latitude]);
      instance.fitBounds(bounds, { padding: 64, maxZoom: 13, duration: 0 });
    }
  }, [markers]);

  useEffect(() => {
    for (const [id, { el }] of markerRefs.current) {
      const active = id === activeId;
      el.setAttribute('data-active', String(active));
      el.style.setProperty('z-index', active ? '10' : '');
    }
  }, [activeId, markers]);

  return (
    <div
      ref={container}
      className={cn('size-full', className)}
      role="region"
      aria-label="Map of results"
    />
  );
}
