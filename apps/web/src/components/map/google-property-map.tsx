'use client';

import { cn } from '@havenhub/ui';
import { useEffect, useRef, useState } from 'react';

import {
  GOOGLE_MAPS_KEY,
  GOOGLE_MAPS_MAP_ID,
  NIGERIA_CENTER,
  NIGERIA_ZOOM,
  googleEmbedUrl,
  loadGoogleMaps,
} from './google-maps';

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

type Props = {
  markers: MapMarker[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onMoveEnd?: (bounds: Bounds) => void;
  className?: string;
};

/**
 * The results map on Google Maps. With NEXT_PUBLIC_GOOGLE_MAPS_API_KEY it is
 * interactive: markers mirror the result list, the active one is
 * highlighted, and only user pans/zooms report bounds. Without a key
 * (development only) it is a keyless Google embed of the active result.
 */
export function GooglePropertyMap(props: Props) {
  return GOOGLE_MAPS_KEY ? <InteractiveMap {...props} /> : <EmbedMap {...props} />;
}

function EmbedMap({ markers, activeId, className }: Props) {
  const focus = markers.find((m) => m.id === activeId) ?? markers[0];
  const src = focus
    ? googleEmbedUrl(focus.latitude, focus.longitude, 14)
    : googleEmbedUrl(NIGERIA_CENTER.lat, NIGERIA_CENTER.lng, NIGERIA_ZOOM + 1);
  return (
    <iframe
      title={focus ? `Map of ${focus.title}` : 'Map of results'}
      src={src}
      className={cn('size-full border-0', className)}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

function InteractiveMap({ markers, activeId, onSelect, onMoveEnd, className }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [failed, setFailed] = useState(false);
  const markerRefs = useRef(
    new Map<string, { marker: google.maps.marker.AdvancedMarkerElement; el: HTMLButtonElement }>(),
  );
  const onSelectRef = useRef(onSelect);
  const onMoveEndRef = useRef(onMoveEnd);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onMoveEndRef.current = onMoveEnd;
  });

  useEffect(() => {
    let active = true;
    let instance: google.maps.Map | null = null;
    // fitBounds also fires "idle"; only report moves the user made.
    let userMoved = false;
    loadGoogleMaps()
      .then((maps) => {
        if (!active || !container.current) return;
        instance = new maps.Map(container.current, {
          center: NIGERIA_CENTER,
          zoom: NIGERIA_ZOOM,
          mapId: GOOGLE_MAPS_MAP_ID,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        instance.addListener('dragstart', () => (userMoved = true));
        instance.addListener('zoom_changed', () => {
          // Wheel/pinch/buttons zooms happen with the pointer over the map.
          if (container.current?.matches(':hover, :focus-within')) userMoved = true;
        });
        instance.addListener('idle', () => {
          if (!userMoved || !instance) return;
          userMoved = false;
          const b = instance.getBounds();
          if (!b) return;
          const ne = b.getNorthEast();
          const sw = b.getSouthWest();
          onMoveEndRef.current?.({
            west: sw.lng(),
            south: sw.lat(),
            east: ne.lng(),
            north: ne.lat(),
          });
        });
        setMap(instance);
      })
      .catch(() => active && setFailed(true));
    const refs = markerRefs.current;
    return () => {
      active = false;
      for (const { marker } of refs.values()) detach(marker);
      refs.clear();
      if (instance) google.maps.event.clearInstanceListeners(instance);
    };
  }, []);

  // Sync markers with results and frame them.
  useEffect(() => {
    if (!map) return;
    const refs = markerRefs.current;
    for (const [id, { marker }] of refs) {
      if (!markers.some((m) => m.id === id)) {
        detach(marker);
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
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: item.latitude, lng: item.longitude },
        content: el,
        title: item.title,
      });
      refs.set(item.id, { marker, el });
    }
    if (markers.length) {
      const bounds = new google.maps.LatLngBounds();
      for (const m of markers) bounds.extend({ lat: m.latitude, lng: m.longitude });
      map.fitBounds(bounds, 64);
      if (markers.length === 1) map.setZoom(13);
    }
  }, [map, markers]);

  useEffect(() => {
    for (const [id, { marker, el }] of markerRefs.current) {
      const active = id === activeId;
      el.setAttribute('data-active', String(active));
      setZIndex(marker, active ? 10 : null);
    }
  }, [activeId, markers, map]);

  if (failed) {
    return (
      <div className="grid size-full place-items-center bg-surface-secondary p-6 text-center text-sm text-text-secondary">
        The map couldn’t load. Results are still listed.
      </div>
    );
  }
  return (
    <div
      ref={container}
      className={cn('size-full', className)}
      role="region"
      aria-label="Map of results"
    />
  );
}

// Google's marker API is property assignment; kept outside the component so
// React's lint doesn't read it as mutating component state.
function detach(marker: google.maps.marker.AdvancedMarkerElement) {
  marker.map = null;
}

function setZIndex(marker: google.maps.marker.AdvancedMarkerElement, zIndex: number | null) {
  marker.zIndex = zIndex;
}
