import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getLeafletTileLayerConfig } from '../../utils/pageHelpers';

// Small inline venue map for a single pickup game. Reuses the app's existing
// Leaflet dependency and theme-aware tile config — no new map library.
const PickupMap = ({ lat, lng, label = '', theme = 'light', height = '260px' }) => {
    const containerRef = useRef(null);
    const mapRef = useRef(null);

    useEffect(() => {
        if (!containerRef.current || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
            return undefined;
        }

        const tile = getLeafletTileLayerConfig(theme === 'dark' ? 'dark' : 'light');
        const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([Number(lat), Number(lng)], 15);
        L.tileLayer(tile.url, tile.options).addTo(map);

        const marker = L.marker([Number(lat), Number(lng)]).addTo(map);
        if (label) {
            marker.bindPopup(label);
        }

        mapRef.current = map;
        // Leaflet needs a size recalculation once the container is laid out.
        window.setTimeout(() => map.invalidateSize(), 120);

        return () => {
            map.remove();
            mapRef.current = null;
        };
    }, [lat, lng, label, theme]);

    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
        return (
            <div className="pickup-map pickup-map-empty">
                <span>No map location for this venue yet.</span>
            </div>
        );
    }

    return <div ref={containerRef} className="pickup-map" style={{ height }} />;
};

export default PickupMap;
