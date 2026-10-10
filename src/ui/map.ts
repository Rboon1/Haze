import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Place } from '../lib/places';

export interface MapMarker {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  /** Label inside the marker: the AQI, or a dash when unavailable. */
  readonly label: string;
  readonly color: string;
  readonly textColor: string;
}

/**
 * Leaflet map of spots with AQI-coloured markers.
 * Tiles: OpenStreetMap standard tiles (attribution required, fair-use policy applies; use a keyed
 * tile provider for real traffic). The spot list is the accessible equivalent of this map.
 */
export class SpotMap {
  private readonly map: L.Map;
  private readonly markers = L.layerGroup();
  private readonly custom = L.layerGroup();
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, private readonly onSelect: (id: string) => void) {
    this.map = L.map(container, { zoomControl: true, scrollWheelZoom: false }).setView([4.2, 108], 5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.map);
    this.markers.addTo(this.map);
    this.custom.addTo(this.map);
    this.resizeObserver = new ResizeObserver(() => this.map.invalidateSize());
    this.resizeObserver.observe(container);
  }

  setMarkers(items: readonly MapMarker[], selectedId: string | null): void {
    this.markers.clearLayers();
    for (const item of items) {
      const dot = document.createElement('div');
      dot.className = `aqi-dot${item.id === selectedId ? ' selected' : ''}`;
      dot.style.background = item.color;
      dot.style.color = item.textColor;
      dot.textContent = item.label;
      const marker = L.marker([item.lat, item.lon], {
        icon: L.divIcon({ html: dot, className: 'aqi-dot-wrap', iconSize: [38, 38], iconAnchor: [19, 19] }),
        title: `${item.name}, US AQI ${item.label}`,
        alt: `${item.name}, US AQI ${item.label}`,
        keyboard: true,
        zIndexOffset: item.id === selectedId ? 1000 : 0,
      });
      marker.on('click', () => this.onSelect(item.id));
      marker.addTo(this.markers);
    }
  }

  /** Show a pin for a searched or detected place that is not one of the spots. */
  setCustomPlace(place: Place | null): void {
    this.custom.clearLayers();
    if (!place) return;
    const pin = document.createElement('div');
    pin.className = 'place-pin';
    L.marker([place.lat, place.lon], {
      icon: L.divIcon({ html: pin, className: 'aqi-dot-wrap', iconSize: [20, 20], iconAnchor: [10, 10] }),
      title: place.name,
      alt: place.name,
    }).addTo(this.custom);
  }

  focus(lat: number, lon: number): void {
    this.map.flyTo([lat, lon], Math.max(this.map.getZoom(), 11), { duration: 0.8 });
  }

  fit(points: readonly { lat: number; lon: number }[]): void {
    if (points.length === 0) return;
    this.map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number])), {
      padding: [30, 30],
      maxZoom: 11,
    });
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.map.remove();
  }
}
