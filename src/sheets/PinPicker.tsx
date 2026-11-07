import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { addTiles } from '../components/leafletUtil';
import { Sheet } from '../components/ui';

/** 지도를 움직여 가운데 핀을 맞추거나, 원하는 곳을 눌러 위치 지정 */
export default function PinPicker({ initial, onPick, onClose }: { initial: { lat: number; lng: number } | null; onPick: (p: { lat: number; lng: number }) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [failed, setFailed] = useState(false);
  const [center, setCenter] = useState(initial ?? { lat: 36.0671, lng: 120.3826 });

  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lng], initial ? 16 : 12);
    mapRef.current = map;
    addTiles(map, () => setFailed(true));
    map.on('move', () => {
      const c = map.getCenter();
      setCenter({ lat: c.lat, lng: c.lng });
    });
    map.on('click', (e: L.LeafletMouseEvent) => map.panTo(e.latlng));
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Sheet onClose={onClose} label="위치 지정" wide>
      <h3>지도에서 위치 지정</h3>
      <div className="pin-map">
        <div ref={ref} style={{ width: '100%', height: '100%' }} />
        {!failed && <div className="pin-center" aria-hidden="true">📍</div>}
        {failed && (
          <div className="center-msg" style={{ position: 'absolute', inset: 0, zIndex: 600, background: 'var(--surface-2)' }}>
            지도를 불러올 수 없어요 (오프라인이거나 지도 서버 접속이 막혀 있어요).<br />이름으로 찾거나 좌표를 직접 입력해 주세요.
          </div>
        )}
      </div>
      <p className="hint num">지도를 움직여 📍를 맞추거나 원하는 곳을 누르세요 · {center.lat.toFixed(5)}, {center.lng.toFixed(5)}</p>
      <div className="actions">
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={failed} onClick={() => onPick(center)} data-testid="pin-ok">이 위치로</button>
      </div>
    </Sheet>
  );
}
