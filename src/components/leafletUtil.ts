import L from 'leaflet';

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

/**
 * OpenStreetMap 타일 레이어 + 실패 감지.
 * 6초 안에 타일이 하나도 안 뜨고 오류만 나면(오프라인·차단) onFail.
 */
export function addTiles(map: L.Map, onFail: () => void): L.TileLayer {
  const layer = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTR, crossOrigin: true });
  let loaded = 0;
  let errors = 0;
  layer.on('tileload', () => loaded++);
  layer.on('tileerror', () => errors++);
  layer.addTo(map);
  const t = setTimeout(() => {
    if (loaded === 0) onFail();
  }, 6000);
  map.on('unload', () => clearTimeout(t));
  void errors;
  return layer;
}
