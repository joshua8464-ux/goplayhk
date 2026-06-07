import React, { useEffect, useRef, useState } from 'react';

const ExplorePage = ({
    sport,
    search,
    venueId = '',
    autoRoute = false,
    matchId = '',
    routeSource = '',
    openGuidance = false,
    onNavigate,
    state,
    dispatch,
    revealedVenueImageIds,
    revealVenueImage,
    theme,
    showToast,
    Header,
    getLeafletTileLayerConfig
}) => {
    const formatNumber = (value) => new Intl.NumberFormat('en-HK', { maximumFractionDigits: 1 }).format(value || 0);

    const formatPaceLabel = (secondsPerKm) => {
        if (!secondsPerKm) {
            return 'No pace yet';
        }

        const minutes = Math.floor(secondsPerKm / 60);
        const seconds = secondsPerKm % 60;
        return `${minutes}:${String(seconds).padStart(2, '0')}/km`;
    };

    const formatSyncLabel = (value) => {
        if (!value) {
            return 'No sync yet';
        }

        return new Date(value).toLocaleString('en-HK', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    };

    const formatDurationLabel = (durationMinutes) => {
        if (!durationMinutes) {
            return 'Open externally';
        }

        if (durationMinutes < 60) {
            return `${durationMinutes} min`;
        }

        const hours = Math.floor(durationMinutes / 60);
        const minutes = durationMinutes % 60;
        return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
    };

    const formatArrivalLabel = (durationMinutes) => {
        if (!durationMinutes) {
            return 'Check live';
        }

        const arrivalDate = new Date(Date.now() + (durationMinutes * 60 * 1000));
        return arrivalDate.toLocaleTimeString('en-HK', {
            hour: 'numeric',
            minute: '2-digit'
        });
    };

    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const markersLayerRef = useRef(null);
    const routeLayerRef = useRef(null);
    const userMarkerRef = useRef(null);
    const tileLayerRef = useRef(null);
    const leafletRef = useRef(null);
    const hasAutoRoutedRef = useRef(false);
    const [searchQuery, setSearchQuery] = useState(search || '');
    const [selectedSport, setSelectedSport] = useState(sport || '');
    const [selectedVenueId, setSelectedVenueId] = useState(venueId || state.venues[0]?.id || '');
    const [userLocation, setUserLocation] = useState(null);
    const [routeLoading, setRouteLoading] = useState(false);
    const [routeError, setRouteError] = useState('');
    const [routeOptions, setRouteOptions] = useState([]);
    const [activeRouteMode, setActiveRouteMode] = useState('walking');
    const [guidanceActive, setGuidanceActive] = useState(Boolean(openGuidance));
    const [leafletReady, setLeafletReady] = useState(false);
    const [bluetoothAvailable, setBluetoothAvailable] = useState(false);
    const [watchActionBusy, setWatchActionBusy] = useState(false);
    const sportOptions = ['All Sports', ...new Set(state.venues.map((venue) => venue.sport))];
    const currentUser = state.currentUser || {};
    const activityMetrics = {
        primarySport: currentUser.sports?.[0] || 'Running',
        totalDistanceKm: 0,
        activeMinutes: 0,
        sessionsCompleted: 0,
        weeklyStreak: 0,
        weeklyDistanceKm: 0,
        averagePaceSecPerKm: 0,
        caloriesBurned: 0,
        elevationGainM: 0,
        lastSyncedAt: '',
        syncCount: 0,
        ...(currentUser.activityMetrics || {})
    };
    const watchSync = {
        provider: 'Samsung Health',
        linked: false,
        model: '',
        status: 'disconnected',
        batteryLevel: null,
        lastSyncedAt: '',
        latestRunDistanceKm: 0,
        latestRunPaceSecPerKm: 0,
        syncCount: 0,
        fallbackMode: true,
        supportedModels: ['Galaxy Watch Ultra', 'Galaxy Watch7', 'Galaxy Watch6 Classic', 'Galaxy Watch5 Pro'],
        ...(currentUser.watchSync || {})
    };
    const joinedClubs = (state.clubs || []).filter((club) => (currentUser.joinedClubIds || []).includes(club.id));
    const clubContributionCards = joinedClubs.slice(0, 3).map((club, index) => {
        const shareMultiplier = club.sport === 'Running' || club.sport === 'Athletics'
            ? 0.62
            : (0.22 + (index * 0.08));
        const contributionDistanceKm = Number((activityMetrics.weeklyDistanceKm * shareMultiplier).toFixed(1));

        return {
            id: club.id,
            name: club.name,
            sport: club.sport,
            contributionDistanceKm,
            readiness: watchSync.linked
                ? 'Auto-updated from your linked Samsung activity stream.'
                : 'Link a Samsung watch or demo sync to push live contribution data here.'
        };
    });

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        setBluetoothAvailable(Boolean(window.isSecureContext && navigator.bluetooth?.requestDevice));
    }, []);

    useEffect(() => {
        let cancelled = false;

        Promise.all([
            import('leaflet'),
            import('leaflet/dist/leaflet.css')
        ]).then(([leafletModule]) => {
            if (cancelled) {
                return;
            }

            leafletRef.current = leafletModule.default;
            setLeafletReady(true);
        }).catch(() => {
            if (!cancelled) {
                setRouteError('Map tools are temporarily unavailable.');
            }
        });

        return () => {
            cancelled = true;
        };
    }, []);

    const venuesToShow = state.venues
        .filter((venue) => !selectedSport || venue.sport === selectedSport)
        .filter((venue) => {
            const normalizedQuery = searchQuery.trim().toLowerCase();

            if (!normalizedQuery) {
                return true;
            }

            return [venue.name, venue.location, venue.sport, venue.description]
                .filter(Boolean)
                .some((value) => value.toLowerCase().includes(normalizedQuery));
        })
        .sort((firstVenue, secondVenue) => secondVenue.rating - firstVenue.rating);

    const selectedVenue = venuesToShow.find((venue) => venue.id === selectedVenueId)
        || state.venues.find((venue) => venue.id === selectedVenueId)
        || venuesToShow[0]
        || state.venues[0]
        || null;
    const activeRoute = routeOptions.find((option) => option.mode === activeRouteMode) || routeOptions[0] || null;

    const getVenueDisplayImage = (venue) => {
        if (!venue) {
            return '';
        }

        return revealedVenueImageIds?.has(venue.id) ? venue.img : venue.placeholderImg;
    };

    const openVenueDetail = (venue) => {
        if (!venue) {
            return;
        }

        revealVenueImage?.(venue.id);
        onNavigate({ page: 'venueDetail', params: { venueId: venue.id } });
    };

    const createVenueIcon = (isActive) => leafletRef.current?.divIcon({
        className: 'custom-map-marker-shell',
        html: `<div class="custom-map-marker ${isActive ? 'active' : ''}"><span></span></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    const formatRouteStep = (step) => {
        const maneuverType = step?.maneuver?.type || 'Continue';
        const modifier = step?.maneuver?.modifier ? ` ${step.maneuver.modifier}` : '';
        const roadName = step?.name ? ` onto ${step.name}` : '';
        return `${maneuverType}${modifier}${roadName}`;
    };

    const clearActiveRoute = () => {
        setRouteOptions([]);
        setRouteError('');
        setGuidanceActive(false);
        if (routeLayerRef.current && mapRef.current) {
            mapRef.current.removeLayer(routeLayerRef.current);
            routeLayerRef.current = null;
        }
    };

    useEffect(() => {
        if (venueId) {
            setSelectedVenueId(venueId);
        }
    }, [venueId]);

    useEffect(() => {
        if (!venuesToShow.some((venue) => venue.id === selectedVenueId)) {
            setSelectedVenueId(venuesToShow[0]?.id || state.venues[0]?.id || '');
        }
    }, [selectedVenueId, state.venues, venuesToShow]);

    useEffect(() => {
        const leaflet = leafletRef.current;

        if (!leafletReady || !leaflet || !mapContainerRef.current || mapRef.current) {
            return undefined;
        }

        const map = leaflet.map(mapContainerRef.current, {
            zoomControl: false,
            attributionControl: true
        }).setView([22.3, 114.2], 11);

        leaflet.control.zoom({ position: 'bottomright' }).addTo(map);
        mapRef.current = map;
        markersLayerRef.current = leaflet.layerGroup().addTo(map);

        return () => {
            map.remove();
            mapRef.current = null;
            markersLayerRef.current = null;
            routeLayerRef.current = null;
            userMarkerRef.current = null;
            tileLayerRef.current = null;
        };
    }, [leafletReady]);

    useEffect(() => {
        const leaflet = leafletRef.current;

        if (!leafletReady || !leaflet || !mapRef.current) {
            return;
        }

        if (tileLayerRef.current) {
            mapRef.current.removeLayer(tileLayerRef.current);
        }

        const { url, options } = getLeafletTileLayerConfig(theme);
        tileLayerRef.current = leaflet.tileLayer(url, options).addTo(mapRef.current);
    }, [getLeafletTileLayerConfig, leafletReady, theme]);

    useEffect(() => {
        const leaflet = leafletRef.current;

        if (!leafletReady || !leaflet || !mapRef.current || !markersLayerRef.current) {
            return;
        }

        markersLayerRef.current.clearLayers();

        venuesToShow.forEach((venue) => {
            const marker = leaflet.marker([venue.lat, venue.lng], {
                icon: createVenueIcon(venue.id === selectedVenueId)
            }).addTo(markersLayerRef.current);

            marker.bindPopup(`<div class="map-popup-shell"><strong>${venue.name}</strong><br/>${venue.location}<br/>${venue.sport}</div>`);
            marker.on('click', () => setSelectedVenueId(venue.id));
        });
    }, [leafletReady, selectedVenueId, venuesToShow]);

    useEffect(() => {
        if (!mapRef.current || !selectedVenue) {
            return;
        }

        mapRef.current.flyTo([selectedVenue.lat, selectedVenue.lng], 12, { duration: 0.8 });
        clearActiveRoute();
    }, [selectedVenue]);

    useEffect(() => {
        const leaflet = leafletRef.current;

        if (!leafletReady || !leaflet || !mapRef.current) {
            return;
        }

        if (!userLocation) {
            if (userMarkerRef.current) {
                mapRef.current.removeLayer(userMarkerRef.current);
                userMarkerRef.current = null;
            }
            return;
        }

        if (userMarkerRef.current) {
            mapRef.current.removeLayer(userMarkerRef.current);
        }

        userMarkerRef.current = leaflet.circleMarker([userLocation.lat, userLocation.lng], {
            radius: 8,
            color: '#4af0d8',
            weight: 2,
            fillColor: '#9ec3ff',
            fillOpacity: 0.95
        }).addTo(mapRef.current);
    }, [leafletReady, userLocation]);

    useEffect(() => {
        const leaflet = leafletRef.current;

        if (!leafletReady || !leaflet || !mapRef.current) {
            return;
        }

        if (routeLayerRef.current) {
            mapRef.current.removeLayer(routeLayerRef.current);
            routeLayerRef.current = null;
        }

        if (!activeRoute?.coordinates?.length) {
            return;
        }

        routeLayerRef.current = leaflet.polyline(activeRoute.coordinates, {
            color: activeRoute.color,
            weight: activeRoute.mode === 'walking' ? 4 : 5,
            opacity: 0.9,
            dashArray: activeRoute.mode === 'walking' ? '8 10' : undefined
        }).addTo(mapRef.current);

        mapRef.current.fitBounds(routeLayerRef.current.getBounds(), { padding: [28, 28] });
    }, [activeRoute, leafletReady]);

    const buildRouteVariant = async (origin, profile, mode, color, fallbackSummary) => {
        const response = await fetch(`https://router.project-osrm.org/route/v1/${profile}/${origin.lng},${origin.lat};${selectedVenue.lng},${selectedVenue.lat}?overview=full&geometries=geojson&steps=true`);
        const data = await response.json();
        const route = data.routes?.[0];

        if (!route) {
            throw new Error(`No ${mode} route found`);
        }

        const durationMin = Math.max(1, Math.ceil(route.duration / 60));

        return {
            mode,
            title: mode === 'walking' ? 'Walking' : 'Driving',
            summary: fallbackSummary,
            distanceKm: (route.distance / 1000).toFixed(1),
            durationMin,
            durationLabel: formatDurationLabel(durationMin),
            arrivalLabel: formatArrivalLabel(durationMin),
            color,
            coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
            steps: (route.legs?.[0]?.steps || []).map((step) => ({
                instruction: formatRouteStep(step),
                distance: Math.round(step.distance),
                durationMin: Math.max(1, Math.ceil(step.duration / 60))
            }))
        };
    };

    const buildTransitOption = (walkingOption, drivingOption) => {
        return {
            mode: 'transit',
            title: 'Transit',
            summary: 'Open public transport routing in your maps app for a live MTR and bus ETA.',
            distanceKm: walkingOption?.distanceKm || drivingOption?.distanceKm || 'n/a',
            durationMin: null,
            durationLabel: 'Check live',
            arrivalLabel: 'Maps app',
            color: '#fc9905',
            coordinates: [],
            steps: [],
            note: 'Transit timing is opened externally so the ETA stays based on live network conditions.'
        };
    };

    const handleLocateUser = (onResolved) => {
        if (!navigator.geolocation) {
            showToast('Geolocation is not supported on this device.');
            setRouteError('Your device cannot share location for route building.');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const nextLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                setUserLocation(nextLocation);
                showToast('Current location locked in.');
                onResolved?.(nextLocation);
            },
            () => {
                showToast('Location access denied.');
                setRouteError('Location access is needed for live route guidance.');
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    };

    const handleFindRoutes = (originOverride) => {
        const origin = originOverride || userLocation;

        if (!selectedVenue) {
            return;
        }

        if (!origin) {
            handleLocateUser((nextLocation) => {
                handleFindRoutes(nextLocation);
            });
            return;
        }

        setRouteLoading(true);
        setRouteError('');
        Promise.allSettled([
            buildRouteVariant(origin, 'walking', 'walking', '#4af0d8', 'Best for detailed step-by-step guidance.'),
            buildRouteVariant(origin, 'driving', 'driving', '#9ec3ff', 'Fastest private vehicle route from your current location.')
        ]).then((results) => {
            const walkingOption = results[0].status === 'fulfilled' ? results[0].value : null;
            const drivingOption = results[1].status === 'fulfilled' ? results[1].value : null;
            const nextOptions = [walkingOption, drivingOption, buildTransitOption(walkingOption, drivingOption)].filter(Boolean);

            if (!walkingOption && !drivingOption) {
                setRouteError('Live route guidance is unavailable right now. You can still open external directions below.');
            }

            setRouteOptions(nextOptions);
            setActiveRouteMode(walkingOption ? 'walking' : drivingOption ? 'driving' : 'transit');
            setGuidanceActive(true);
        }).catch(() => {
            setRouteError('Live route guidance is unavailable right now.');
        }).finally(() => {
            setRouteLoading(false);
        });
    };

    useEffect(() => {
        if (!autoRoute || !selectedVenue || hasAutoRoutedRef.current) {
            return;
        }

        hasAutoRoutedRef.current = true;
        handleFindRoutes();
    }, [autoRoute, selectedVenue]);

    const openExternalRoute = (mode = 'walking') => {
        if (!selectedVenue) {
            return;
        }

        const destination = `${selectedVenue.lat},${selectedVenue.lng}`;
        const url = userLocation
            ? `https://www.google.com/maps/dir/?api=1&origin=${userLocation.lat},${userLocation.lng}&destination=${destination}&travelmode=${mode}`
            : `https://www.google.com/maps/search/?api=1&query=${destination}`;

        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const handleEnableDemoSync = () => {
        if (!dispatch || !currentUser.id) {
            return;
        }

        const now = new Date().toISOString();
        dispatch({
            type: 'SYNC_WATCH_CONNECTION',
            payload: {
                userId: currentUser.id,
                watchSync: {
                    linked: true,
                    model: 'Samsung Health demo stream',
                    status: 'ready',
                    lastSyncedAt: watchSync.lastSyncedAt || now,
                    batteryLevel: 100,
                    fallbackMode: true
                }
            }
        });
        showToast('Demo Samsung sync enabled. You can now simulate activity updates.');
    };

    const handleConnectSamsungWatch = async () => {
        if (!dispatch || !currentUser.id) {
            return;
        }

        if (!bluetoothAvailable) {
            showToast('Browser Bluetooth is unavailable here. Use demo sync instead.');
            return;
        }

        setWatchActionBusy(true);

        try {
            const device = await navigator.bluetooth.requestDevice({
                filters: [
                    { namePrefix: 'Galaxy Watch' },
                    { namePrefix: 'Samsung' }
                ],
                optionalServices: ['battery_service', 'device_information']
            });
            const now = new Date().toISOString();

            dispatch({
                type: 'SYNC_WATCH_CONNECTION',
                payload: {
                    userId: currentUser.id,
                    watchSync: {
                        linked: true,
                        model: device?.name || 'Samsung Galaxy Watch',
                        status: 'ready',
                        batteryLevel: watchSync.batteryLevel ?? 84,
                        lastSyncedAt: watchSync.lastSyncedAt || now,
                        fallbackMode: false
                    }
                }
            });
            showToast(`Connected ${device?.name || 'your Samsung watch'}.`);
        } catch (error) {
            if (error?.name === 'NotFoundError') {
                showToast('Samsung watch connection cancelled.');
            } else {
                showToast('Bluetooth connection could not be completed. Demo sync is still available.');
            }
        } finally {
            setWatchActionBusy(false);
        }
    };

    const handleSyncLatestRun = async () => {
        if (!dispatch || !currentUser.id) {
            return;
        }

        if (!watchSync.linked) {
            showToast('Link a Samsung watch or enable demo sync first.');
            return;
        }

        setWatchActionBusy(true);

        try {
            await new Promise((resolve) => window.setTimeout(resolve, 680));
            const nextRunDistanceKm = Number((Math.max(4.8, activityMetrics.weeklyDistanceKm / 2) + ((activityMetrics.sessionsCompleted + watchSync.syncCount) % 3) * 1.1).toFixed(1));
            const nextPaceSecPerKm = Math.max(278, (activityMetrics.averagePaceSecPerKm || 332) - (watchSync.fallbackMode ? 2 : 6));
            const nextDurationMinutes = Math.max(24, Math.round((nextRunDistanceKm * nextPaceSecPerKm) / 60));
            const nextSyncCount = (watchSync.syncCount || 0) + 1;
            const now = new Date().toISOString();

            dispatch({
                type: 'SYNC_WATCH_ACTIVITY',
                payload: {
                    userId: currentUser.id,
                    activityMetrics: {
                        totalDistanceKm: Number((activityMetrics.totalDistanceKm + nextRunDistanceKm).toFixed(1)),
                        activeMinutes: activityMetrics.activeMinutes + nextDurationMinutes,
                        sessionsCompleted: activityMetrics.sessionsCompleted + 1,
                        weeklyStreak: Math.min(activityMetrics.weeklyStreak + 1, 14),
                        weeklyDistanceKm: Number((activityMetrics.weeklyDistanceKm + nextRunDistanceKm).toFixed(1)),
                        averagePaceSecPerKm: Math.round(((activityMetrics.averagePaceSecPerKm * Math.max(activityMetrics.sessionsCompleted, 1)) + nextPaceSecPerKm) / (Math.max(activityMetrics.sessionsCompleted, 1) + 1)),
                        caloriesBurned: activityMetrics.caloriesBurned + Math.round(nextRunDistanceKm * 62),
                        elevationGainM: activityMetrics.elevationGainM + Math.round(nextRunDistanceKm * (watchSync.fallbackMode ? 7 : 11)),
                        lastSyncedAt: now,
                        syncCount: nextSyncCount
                    },
                    watchSync: {
                        linked: true,
                        status: 'ready',
                        model: watchSync.model || 'Samsung Health demo stream',
                        lastSyncedAt: now,
                        latestRunDistanceKm: nextRunDistanceKm,
                        latestRunPaceSecPerKm: nextPaceSecPerKm,
                        batteryLevel: watchSync.fallbackMode ? 100 : Math.max((watchSync.batteryLevel ?? 84) - 2, 28),
                        syncCount: nextSyncCount,
                        fallbackMode: Boolean(watchSync.fallbackMode)
                    }
                }
            });
            showToast('Latest run synced into your Explore profile and club activity.');
        } finally {
            setWatchActionBusy(false);
        }
    };

    const handleDisconnectWatch = () => {
        if (!dispatch || !currentUser.id) {
            return;
        }

        dispatch({
            type: 'DISCONNECT_WATCH',
            payload: {
                userId: currentUser.id,
                watchSync: {
                    model: watchSync.model,
                    lastSyncedAt: watchSync.lastSyncedAt,
                    latestRunDistanceKm: watchSync.latestRunDistanceKm,
                    latestRunPaceSecPerKm: watchSync.latestRunPaceSecPerKm,
                    syncCount: watchSync.syncCount
                }
            }
        });
        showToast('Samsung watch disconnected. Existing activity totals stay in place.');
    };

    return (
        <div className="page-content tech-page explore-page-shell map-page-shell">
            <Header title="Explore" onNavigate={onNavigate} />
            <section className="hero-panel map-hero-panel fade-in surface-tier-3">
                <span className="section-kicker">Sport radar</span>
                <h2 className="section-title">Explore venues, live activity, and Samsung sync from one page</h2>
                <p>Track your current sports output, sync the latest running data from a Samsung watch, and still route straight into the right venue without leaving Explore.</p>
                <div className="signal-badge-row top-gap-sm">
                    <span className="signal-badge"><i className="fas fa-location-crosshairs" aria-hidden="true"></i>{venuesToShow.length} venue matches</span>
                    <span className="signal-badge"><i className="fas fa-wave-square" aria-hidden="true"></i>{watchSync.linked ? `${watchSync.provider} linked` : 'Samsung sync ready'}</span>
                    <span className="signal-badge"><i className="fas fa-route" aria-hidden="true"></i>Integrated route planning</span>
                    {routeSource === 'booking' && <span className="signal-badge"><i className="fas fa-check-circle" aria-hidden="true"></i>Booking confirmed</span>}
                </div>
            </section>

            <section className="dashboard-grid fade-in explore-performance-grid">
                <div className="signal-card metric-card surface-tier-1 explore-activity-card">
                    <span className="metric-icon"><i className="fas fa-person-running" aria-hidden="true"></i></span>
                    <span className="metric-value">{formatNumber(activityMetrics.totalDistanceKm)} km</span>
                    <span className="metric-label">Total distance tracked</span>
                </div>
                <div className="signal-card metric-card surface-tier-1 explore-activity-card">
                    <span className="metric-icon"><i className="fas fa-stopwatch" aria-hidden="true"></i></span>
                    <span className="metric-value">{formatNumber(activityMetrics.activeMinutes)}</span>
                    <span className="metric-label">Active minutes logged</span>
                </div>
                <div className="signal-card metric-card surface-tier-1 explore-activity-card">
                    <span className="metric-icon"><i className="fas fa-fire" aria-hidden="true"></i></span>
                    <span className="metric-value">{activityMetrics.weeklyStreak} days</span>
                    <span className="metric-label">Current training streak</span>
                </div>
                <div className="signal-card metric-card surface-tier-1 explore-activity-card">
                    <span className="metric-icon"><i className="fas fa-gauge-high" aria-hidden="true"></i></span>
                    <span className="metric-value">{formatPaceLabel(activityMetrics.averagePaceSecPerKm)}</span>
                    <span className="metric-label">Average pace</span>
                </div>
            </section>

            <section className="explore-sync-grid fade-in">
                <div className="card surface-tier-2 explore-watch-panel">
                    <div className="section-heading-row compact-heading-row">
                        <div>
                            <span className="section-kicker">Samsung watch link</span>
                            <h3 className="section-title">Sync running data into your clubs and Explore profile</h3>
                        </div>
                        <span className={`signal-badge explore-sync-status ${watchSync.linked ? 'connected' : 'waiting'}`}>
                            <i className={`fas ${watchSync.linked ? 'fa-circle-check' : 'fa-bluetooth-b'}`} aria-hidden="true"></i>
                            {watchSync.linked ? 'Linked' : 'Not linked'}
                        </span>
                    </div>
                    <p className="route-summary-line">Supported models: {watchSync.supportedModels.join(', ')}. Use browser Bluetooth on supported Chromium-based devices, or switch to demo sync when the browser cannot access Bluetooth directly.</p>
                    <div className="explore-watch-summary top-gap-md">
                        <div className="explore-watch-stat">
                            <span>Device</span>
                            <strong>{watchSync.model || 'No Samsung watch linked yet'}</strong>
                        </div>
                        <div className="explore-watch-stat">
                            <span>Last sync</span>
                            <strong>{formatSyncLabel(watchSync.lastSyncedAt || activityMetrics.lastSyncedAt)}</strong>
                        </div>
                        <div className="explore-watch-stat">
                            <span>Latest run</span>
                            <strong>{watchSync.latestRunDistanceKm ? `${watchSync.latestRunDistanceKm} km • ${formatPaceLabel(watchSync.latestRunPaceSecPerKm)}` : 'Ready for first sync'}</strong>
                        </div>
                        <div className="explore-watch-stat">
                            <span>Battery</span>
                            <strong>{watchSync.batteryLevel == null ? 'Unknown' : `${watchSync.batteryLevel}%`}</strong>
                        </div>
                    </div>
                    <div className="explore-watch-actions top-gap-md">
                        <button type="button" className="btn-primary" onClick={handleConnectSamsungWatch} disabled={watchActionBusy || !bluetoothAvailable || watchSync.linked}>
                            {watchActionBusy ? 'Connecting...' : 'Connect via Bluetooth'}
                        </button>
                        <button type="button" className="btn-secondary" onClick={handleEnableDemoSync} disabled={watchActionBusy || (watchSync.linked && watchSync.fallbackMode)}>
                            Enable Demo Sync
                        </button>
                        <button type="button" className="btn-secondary" onClick={handleSyncLatestRun} disabled={watchActionBusy || !watchSync.linked}>
                            {watchActionBusy ? 'Syncing...' : 'Sync Latest Run'}
                        </button>
                        <button type="button" className="btn-secondary" onClick={handleDisconnectWatch} disabled={watchActionBusy || !watchSync.linked}>
                            Disconnect
                        </button>
                    </div>
                    {!bluetoothAvailable ? (
                        <p className="quick-guide-note top-gap-md">Bluetooth is unavailable in this browser or context, so demo sync is the supported fallback here.</p>
                    ) : null}
                </div>

                <div className="card surface-tier-1 explore-club-sync-panel">
                    <div className="section-heading-row compact-heading-row">
                        <div>
                            <span className="section-kicker">Club impact</span>
                            <h3 className="section-title">Your synced activity flowing into clubs</h3>
                        </div>
                    </div>
                    <div className="explore-club-contributions top-gap-sm">
                        {clubContributionCards.length > 0 ? clubContributionCards.map((club) => (
                            <div key={club.id} className="explore-club-contribution-card">
                                <div>
                                    <strong>{club.name}</strong>
                                    <p>{club.readiness}</p>
                                </div>
                                <div className="explore-club-contribution-value">
                                    <span>{club.sport}</span>
                                    <strong>+{club.contributionDistanceKm} km</strong>
                                </div>
                            </div>
                        )) : (
                            <div className="explore-club-contribution-card empty">
                                <div>
                                    <strong>No joined clubs yet</strong>
                                    <p>Join a club to see your synced running and activity totals feed into club readiness cards.</p>
                                </div>
                                <button type="button" className="btn-secondary" onClick={() => onNavigate({ page: 'clubs', params: {} })}>Open Clubs</button>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {routeSource === 'booking' && selectedVenue && (
                <section className="card surface-tier-2 fade-in explore-route-focus">
                    <div>
                        <span className="section-kicker">Next step after booking</span>
                        <h3 className="section-title">Route to {selectedVenue.name} before you open the session lobby</h3>
                        <p className="route-summary-line">Your booking is locked in. Review route options now, then continue into the lobby when you are ready.</p>
                    </div>
                    {matchId && <button type="button" className="btn-secondary" onClick={() => onNavigate({ page: 'matchDetail', params: { matchId } })}>Skip to Session Lobby</button>}
                </section>
            )}

            <section className="map-control-grid fade-in">
                <div className="card map-route-panel surface-tier-2">
                    <div className="section-heading-row compact-heading-row">
                        <div>
                            <span className="section-kicker">Discovery</span>
                            <h3 className="section-title">Filter venues, then focus the right destination</h3>
                        </div>
                    </div>
                    <div className="search-bar tech-search-bar">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search venues, districts, or sports..."
                            className="input-field"
                        />
                        <i className="fas fa-search" aria-hidden="true"></i>
                    </div>
                    <div className="booking-filter-grid booking-filter-grid-compact top-gap-md">
                        <div className="input-group">
                            <label>Sport filter</label>
                            <select className="input-field venue-select-control" value={selectedSport} onChange={(event) => setSelectedSport(event.target.value)}>
                                <option value="">All Sports</option>
                                {sportOptions.filter((sportOption) => sportOption !== 'All Sports').map((sportOption) => (
                                    <option key={sportOption} value={sportOption}>{sportOption}</option>
                                ))}
                            </select>
                        </div>
                        <div className="input-group">
                            <label>Venue list</label>
                            <select className="input-field venue-select-control" value={selectedVenueId} onChange={(event) => setSelectedVenueId(event.target.value)}>
                                {venuesToShow.map((venue) => (
                                    <option key={venue.id} value={venue.id}>{venue.name} • {venue.location} • {venue.sport}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="route-summary-card surface-tier-1 top-gap-md">
                        <p className="route-summary-line">Use the dropdown to focus one venue at a time instead of scrolling through a long repeated venue wall.</p>
                    </div>
                    <div className="booking-map-shell booking-map-shell-expanded top-gap-md">
                        <div ref={mapContainerRef} id="map" className="booking-selection-map booking-selection-map-expanded"></div>
                    </div>
                    {selectedVenue && (
                        <div className="booking-selection-drawer top-gap-md">
                            <img key={getVenueDisplayImage(selectedVenue)} src={getVenueDisplayImage(selectedVenue)} alt={selectedVenue.name} className="booking-selection-thumb venue-image-fade" />
                            <div className="booking-selection-copy">
                                <span className="section-kicker">Selected venue</span>
                                <h3>{selectedVenue.name}</h3>
                                <p>{selectedVenue.location} • {selectedVenue.sport} • HKD {selectedVenue.price}/hr</p>
                                <div className="signal-badge-row top-gap-sm">
                                    <span className="signal-badge"><i className="fas fa-star" aria-hidden="true"></i>{selectedVenue.rating}</span>
                                    <span className="signal-badge"><i className="fas fa-bolt" aria-hidden="true"></i>{selectedVenue.availability}</span>
                                </div>
                            </div>
                            <div className="explore-cta-row">
                                <button type="button" className="btn-primary" onClick={() => onNavigate({ page: 'createMatch', params: { venueId: selectedVenue.id } })}>Reserve Venue</button>
                                <button type="button" className="btn-secondary" onClick={() => openVenueDetail(selectedVenue)}>Open Venue Detail</button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="card map-route-panel surface-tier-1">
                    <div className="section-heading-row compact-heading-row">
                        <div>
                            <span className="section-kicker">Route planner</span>
                            <h3 className="section-title">Multi-route guide for {selectedVenue?.name || 'your selected venue'}</h3>
                        </div>
                    </div>
                    <div className="route-summary-card surface-tier-1">
                        <p className="route-summary-line"><strong>Destination:</strong> {selectedVenue?.location || 'Choose a venue first'}</p>
                        {routeLoading && <p className="route-summary-line">Building walking, driving, and transit options...</p>}
                        {activeRoute && !routeLoading && <p className="route-summary-line">Active option: {activeRoute.title} • {activeRoute.durationMin ? `${activeRoute.durationMin} min` : 'External guidance'}{activeRoute.distanceKm ? ` • ${activeRoute.distanceKm} km` : ''}</p>}
                        {routeError && <p className="route-summary-line route-warning">{routeError}</p>}
                        {!routeLoading && !activeRoute && !routeError && <p className="route-summary-line">Lock your current location to compare route options and guide details.</p>}
                    </div>
                    <button type="button" className="btn-primary map-route-trigger" onClick={() => handleFindRoutes()} disabled={!selectedVenue}>Find Route Options</button>
                    {routeOptions.length > 0 && (
                        <div className="route-option-grid top-gap-md">
                            {routeOptions.map((option) => (
                                <button key={option.mode} type="button" className={`route-option-card ${activeRouteMode === option.mode ? 'active' : ''}`} onClick={() => setActiveRouteMode(option.mode)}>
                                    <div className="section-heading-row compact-heading-row">
                                        <div>
                                            <span className="section-kicker">{option.title}</span>
                                            <h4>{option.durationLabel || 'Open externally'}</h4>
                                        </div>
                                        <span className="signal-badge">{option.distanceKm ? `${option.distanceKm} km` : 'n/a'}</span>
                                    </div>
                                    <p>{option.summary}</p>
                                    <p className="route-summary-line">ETA: {option.arrivalLabel || 'Check live'}</p>
                                </button>
                            ))}
                        </div>
                    )}
                    {activeRoute && (
                        <div className="map-route-options surface-tier-1 top-gap-md">
                            <div className="map-action-row">
                                <button type="button" className="btn-secondary" onClick={() => setGuidanceActive((current) => !current)}>{guidanceActive ? 'Hide Guidance' : 'Show Guidance'}</button>
                                <button type="button" className="btn-secondary" onClick={() => openExternalRoute(activeRoute.mode === 'transit' ? 'transit' : activeRoute.mode)}>Open in Maps</button>
                                {matchId ? (
                                    <button type="button" className="btn-secondary" onClick={() => onNavigate({ page: 'matchDetail', params: { matchId } })}>Session Lobby</button>
                                ) : (
                                    <button type="button" className="btn-secondary" onClick={() => onNavigate({ page: 'booking', params: {} })}>Book This Venue</button>
                                )}
                            </div>
                            <p className="route-mode-note">{activeRoute.note || `Estimated arrival around ${activeRoute.arrivalLabel}. Switch route cards to compare timing, distance, and guide depth before you commit.`}</p>
                        </div>
                    )}
                    {guidanceActive && activeRoute?.steps?.length > 0 && (
                        <div className="route-steps-list surface-tier-1 top-gap-md">
                            {activeRoute.steps.slice(0, 8).map((step, index) => (
                                <div key={`${activeRoute.mode}-${step.instruction}-${index}`} className="route-step-item">
                                    <span className="route-step-index">{index + 1}</span>
                                    <div>
                                        <p>{step.instruction}</p>
                                        <span className="route-step-meta">{step.distance} m • {step.durationMin} min</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </section>

        </div>
    );
};

export default ExplorePage;
