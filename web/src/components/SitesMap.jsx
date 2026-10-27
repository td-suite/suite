// Mappa delle sedi (Leaflet + OpenStreetMap). Marker colorati per tipo, popup con indirizzo e orari, zoom su tutte le sedi.
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const COLORS = { HEADQUARTER: '#01212C', LABORATORIO: '#1C505E', CENTRO_DIAGNOSTICO: '#71B1BD', POLIAMBULATORIO: '#71B1BD', CENTRO_MEDICO: '#71B1BD', PUNTO_PRELIEVI: '#2a9d8f', SERVICE: '#9b7bb8', ALTRO: '#5B6B70' };
const pin = (color) => L.divIcon({ className: 'site-pin', html: `<span style="background:${color}"></span>`, iconSize: [18, 18], iconAnchor: [9, 18], popupAnchor: [0, -16] });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default function SitesMap({ sites, kinds, onSelect, focusId, height = 420 }) {
  const el = useRef(null); const map = useRef(null); const layer = useRef(null);
  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { scrollWheelZoom: false, zoomControl: true }).setView([43.5, 11.0], 8);
    // Tile Esri World Topo Map (mappa fisica con rilievo, strade e toponimi): senza chiave, consentite alle applicazioni con attribuzione (OSM volontari e CARTO le rifiutano)
    // Se i tile Esri non arrivano, si passa a OpenStreetMap inviando il referer (la loro policy blocca le richieste anonime)
    const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors' }).addTo(map.current);
    let errors = 0;
    esri.on('tileerror', () => { if (++errors < 4 || !map.current) return; esri.off('tileerror'); map.current.removeLayer(esri);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map.current); });
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    const pts = [];
    for (const s of sites) {
      if (s.lat == null || s.lng == null) continue;
      const m = L.marker([s.lat, s.lng], { icon: pin(COLORS[s.kind] || COLORS.ALTRO), title: s.name }).addTo(layer.current);
      m.bindPopup(`<div class="site-pop"><b>${esc(s.name)}</b><div class="k">${esc(s.code)} · ${esc(kinds?.[s.kind] || s.kind)}</div>${s.address ? `<div>${esc(s.address)}${s.zip || s.city ? `, ${esc([s.zip, s.city].filter(Boolean).join(' '))}` : ''}</div>` : ''}${s.phone ? `<div>Tel. ${esc(s.phone)}</div>` : ''}${s.opening_hours ? `<div class="k">${esc(s.opening_hours)}</div>` : ''}${s.organization_name && s.kind === 'SERVICE' ? `<div class="k">${esc(s.organization_name)}</div>` : ''}</div>`);
      if (onSelect) m.on('popupopen', () => onSelect(s));
      pts.push([s.lat, s.lng]);
      if (focusId && s.id === focusId) setTimeout(() => m.openPopup(), 50);
    }
    if (pts.length) map.current.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 13 });
  }, [sites, focusId]);
  return <div ref={el} className="sites-map" style={{ height }} />;
}
