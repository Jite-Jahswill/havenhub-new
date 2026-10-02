import { setWorkerUrl } from 'maplibre-gl';

/** See scripts/copy-map-worker.mjs. Imported only by client-only map components. */
setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');
