// Mappa a bolle dei comuni di provenienza (Profilo dei pazienti del laboratorio). Leaflet come la mappa delle sedi: bolle con raggio
// proporzionale alla radice delle accettazioni, solo per i comuni con coordinate già in cache (public.geo_comuni); sedi come punti scuri.
// Nessuna coordinata inventata: i comuni senza geocodifica restano nella tabella della pagina.
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default function MappaComuni({ comuni = [], sedi = [], height = 380 }) {
  const el = useRef(null); const map = useRef(null); const layer = useRef(null);
  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { scrollWheelZoom: false }).setView([43.6, 11.0], 8);
    const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors' }).addTo(map.current);
    let errors = 0;
    esri.on('tileerror', () => { if (++errors < 4 || !map.current) return; esri.off('tileerror'); map.current.removeLayer(esri);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '&copy; OpenStreetMap' }).addTo(map.current); });
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const max = Math.max(1, ...comuni.map((c) => c.n));
    const pts = [];
    for (const c of comuni) {
      const r = 5 + 25 * Math.sqrt(c.n / max);
      L.circleMarker([c.lat, c.lng], { radius: r, color: '#1C505E', weight: 1, fillColor: '#71B1BD', fillOpacity: 0.55 })
        .bindTooltip(`<b>${esc(c.comune)}</b>${c.provincia ? ` (${esc(c.provincia)})` : ''}<br>${c.n} accettazioni`).addTo(layer.current);
      pts.push([c.lat, c.lng]);
    }
    for (const s of sedi) {
      L.circleMarker([s.lat, s.lng], { radius: 6, color: '#01212C', weight: 2, fillColor: '#FFFAE3', fillOpacity: 1 }).bindTooltip(`Sede: <b>${esc(s.name)}</b>`).addTo(layer.current);
      pts.push([s.lat, s.lng]);
    }
    if (pts.length) map.current.fitBounds(L.latLngBounds(pts).pad(0.2), { maxZoom: 11 });
  }, [comuni, sedi]);
  return <div ref={el} style={{ height, borderRadius: 10, overflow: 'hidden' }} />;
}
