import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    SPORT_BOOKING_PRESETS,
    buildBookingBoardModel,
    ensureBookingPresetCatalog,
    ensureLiveSlotWindow,
    reserveLiveBookingSession,
    subscribeToDistrictLiveSlots,
    subscribeToWeeklyDistrictLeaderboard
} from '../../data/liveBookings';
import { rankLivePlayerOptions } from '../../data/assistantAi';

const BookingPage = ({
    onNavigate,
    state,
    dispatch,
    socialState,
    theme,
    Header,
    formatHourLabel,
    getNextSevenDayOptions,
    getLeafletTileLayerConfig,
    showToast = () => {}
}) => {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const markersLayerRef = useRef(null);
    const tileLayerRef = useRef(null);
    const leafletRef = useRef(null);
    const lastFocusedVenueRef = useRef('');
    const hostedLobbies = state.matches.filter((match) => match.creatorId === state.currentUser.id && match.booking && match.status !== 'cancelled');
    const participatingMatches = state.matches.filter((match) => match.participants.includes(state.currentUser.id));
    const nextHostedLobby = hostedLobbies[0];
    const nextHostedVenue = nextHostedLobby ? state.venues.find((item) => item.id === nextHostedLobby.venueId) : null;
    const dateOptions = getNextSevenDayOptions();
    const sportOptions = ['All Sports', ...new Set(state.venues.map((venue) => venue.sport))];
    const districtOptions = ['All Districts', ...new Set(state.venues.map((venue) => venue.location))];
    const hourOptionsByWindow = {
        morning: ['07:00', '08:00', '09:00', '10:00', '11:00'],
        lunch: ['11:00', '12:00', '13:00', '14:00'],
        evening: ['17:00', '18:00', '19:00', '20:00'],
        late: ['20:00', '21:00', '22:00']
    };
    const defaultDate = dateOptions[0]?.value || '';
    const [sport, setSport] = useState('');
    const [district, setDistrict] = useState('');
    const [date, setDate] = useState(defaultDate);
    const [timeWindow, setTimeWindow] = useState('evening');
    const [time, setTime] = useState('18:00');
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const filteredVenues = state.venues
        .filter((venue) => !sport || venue.sport === sport)
        .filter((venue) => !district || venue.location === district)
        .sort((firstVenue, secondVenue) => secondVenue.rating - firstVenue.rating);
    const [selectedVenueId, setSelectedVenueId] = useState(filteredVenues[0]?.id || state.venues[0]?.id || '');
    const hourOptions = hourOptionsByWindow[timeWindow] || hourOptionsByWindow.evening;
    const selectedVenue = filteredVenues.find((venue) => venue.id === selectedVenueId) || filteredVenues[0] || null;
    const selectedDateLabel = dateOptions.find((dateOption) => dateOption.value === date)?.dateLabel || 'Flexible date';
    const [bookingStage, setBookingStage] = useState('new');
    const [leafletReady, setLeafletReady] = useState(false);
    const [liveSlots, setLiveSlots] = useState([]);
    const [weeklyLeaderboard, setWeeklyLeaderboard] = useState(null);
    const [isSubmittingReservation, setIsSubmittingReservation] = useState(false);
    const [selectedLivePlayerIds, setSelectedLivePlayerIds] = useState([]);
    const [mapStatus, setMapStatus] = useState('loading');
    const hasActiveAdvancedFilters = date !== defaultDate || timeWindow !== 'evening' || time !== '18:00';
    const liveDistrict = district || selectedVenue?.location || state.currentUser?.district || '';
    const bookingCurrentUser = socialState?.currentUser || state.currentUser;
    const usersById = useMemo(() => ({
        ...state.users,
        ...(socialState?.users || {})
    }), [socialState?.users, state.users]);
    const bookingSport = sport || selectedVenue?.sport || '';
    const inviteCapacity = Math.max((SPORT_BOOKING_PRESETS[bookingSport]?.targetGroupSize || 4) - 1, 0);
    const rankedLivePlayerOptions = useMemo(() => rankLivePlayerOptions({
        currentUser: bookingCurrentUser,
        users: socialState?.users || usersById,
        preferredSport: bookingSport,
        district: liveDistrict,
        includeOffline: false,
        limit: 8
    }), [bookingCurrentUser, bookingSport, liveDistrict, socialState?.users, usersById]);
    const livePlayerOptions = useMemo(() => {
        const friendIds = new Set(bookingCurrentUser?.friends || state.currentUser?.friends || []);
        const liveFriends = [];
        const liveOthers = [];

        rankedLivePlayerOptions.forEach((player) => {
            if (friendIds.has(player.id)) {
                liveFriends.push({ ...player, isFriend: true });
                return;
            }

            liveOthers.push({ ...player, isFriend: false });
        });

        return [...liveFriends, ...liveOthers].slice(0, 8);
    }, [bookingCurrentUser?.friends, rankedLivePlayerOptions, state.currentUser?.friends]);
    const bookingBoard = useMemo(() => buildBookingBoardModel({
        rawSlots: liveSlots,
        venues: state.venues,
        currentUser: bookingCurrentUser,
        usersById,
        selectedVenueId,
        selectedDistrict: liveDistrict,
        selectedSport: bookingSport,
        selectedDate: date,
        selectedTime: time,
        weeklyLeaderboard
    }), [bookingCurrentUser, bookingSport, date, liveDistrict, liveSlots, selectedVenueId, state.venues, time, usersById, weeklyLeaderboard]);
    const leadingLowDemandWindow = bookingBoard.lowDemandEntries[0] || null;
    const stagedLivePlayerLabel = selectedLivePlayerIds.length
        ? selectedLivePlayerIds.map((playerId) => usersById[playerId]?.name || 'Player').join(', ')
        : 'No live players staged yet.';
    const bookingCommandMetrics = [
        {
            label: 'Best fill signal',
            value: bookingBoard.bestImmediateSlot ? `${bookingBoard.bestImmediateSlot.probabilityScore}%` : 'Syncing',
            detail: bookingBoard.bestImmediateSlot ? bookingBoard.bestImmediateSlot.courtLabel : 'Waiting for venue fit'
        },
        {
            label: 'District pressure',
            value: `${bookingBoard.districtLivePressure || 0}%`,
            detail: liveDistrict || 'Choose a district'
        },
        {
            label: 'Live roster staged',
            value: `${selectedLivePlayerIds.length}/${inviteCapacity}`,
            detail: selectedLivePlayerIds.length ? 'Players selected now' : 'No live invites yet'
        }
    ];

    useEffect(() => {
        setSelectedLivePlayerIds((currentPlayerIds) => currentPlayerIds.slice(0, inviteCapacity));
    }, [inviteCapacity]);

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
            window.requestAnimationFrame(() => {
                if (!cancelled) {
                    setMapStatus('ready');
                    setLeafletReady(true);
                }
            });
        }).catch(() => {
            if (!cancelled) {
                setMapStatus('error');
                setLeafletReady(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        ensureBookingPresetCatalog().catch(() => {});
    }, []);

    useEffect(() => {
        const unsubscribe = subscribeToDistrictLiveSlots({ district: liveDistrict }, setLiveSlots, () => setLiveSlots([]));

        return () => {
            unsubscribe();
        };
    }, [liveDistrict]);

    useEffect(() => {
        const unsubscribe = subscribeToWeeklyDistrictLeaderboard({
            district: state.currentUser?.district || liveDistrict,
            date
        }, setWeeklyLeaderboard, () => setWeeklyLeaderboard(null));

        return () => {
            unsubscribe();
        };
    }, [date, liveDistrict, state.currentUser?.district]);

    useEffect(() => {
        if (!hourOptions.includes(time)) {
            setTime(hourOptions[0]);
        }
    }, [hourOptions, time]);

    useEffect(() => {
        if (!selectedVenue || !date || !time) {
            return;
        }

        ensureLiveSlotWindow({ venue: selectedVenue, date, time }).catch(() => {});
    }, [date, selectedVenue, time]);

    useEffect(() => {
        if (!filteredVenues.some((venue) => venue.id === selectedVenueId)) {
            setSelectedVenueId(filteredVenues[0]?.id || '');
        }
    }, [filteredVenues, selectedVenueId]);

    const createVenueIcon = (isActive) => leafletRef.current?.divIcon({
        className: 'custom-map-marker-shell',
        html: `<div class="custom-map-marker ${isActive ? 'active' : ''}"><span></span></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    useEffect(() => {
        const leaflet = leafletRef.current;

        if (bookingStage === 'chooser') {
            return undefined;
        }

        if (!leafletReady || !leaflet || !mapContainerRef.current || mapRef.current) {
            return undefined;
        }

        const map = leaflet.map(mapContainerRef.current, {
            zoomControl: false,
            attributionControl: true
        }).setView([22.3, 114.18], 11);

        map.whenReady(() => {
            window.requestAnimationFrame(() => {
                map.invalidateSize(false);
            });
            window.setTimeout(() => {
                map.invalidateSize(true);
            }, 120);
        });

        leaflet.control.zoom({ position: 'bottomright' }).addTo(map);
        markersLayerRef.current = leaflet.layerGroup().addTo(map);
        mapRef.current = map;

        return () => {
            map.remove();
            mapRef.current = null;
            markersLayerRef.current = null;
            tileLayerRef.current = null;
        };
    }, [bookingStage, leafletReady]);

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

        filteredVenues.forEach((venue) => {
            const marker = leaflet.marker([venue.lat, venue.lng], {
                icon: createVenueIcon(venue.id === selectedVenueId)
            }).addTo(markersLayerRef.current);

            marker.bindPopup(`<div class="map-popup-shell"><strong>${venue.name}</strong><br/>${venue.location}<br/>HKD ${venue.price}/hr</div>`);
            marker.on('click', () => {
                setSelectedVenueId(venue.id);
                marker.openPopup();
            });

            if (venue.id === selectedVenueId) {
                marker.openPopup();
            }
        });

        if (selectedVenue && lastFocusedVenueRef.current !== selectedVenue.id) {
            lastFocusedVenueRef.current = selectedVenue.id;
            mapRef.current.flyTo([selectedVenue.lat, selectedVenue.lng], 12, { duration: 0.6 });
        }
    }, [filteredVenues, leafletReady, selectedVenueId, selectedVenue]);

    useEffect(() => {
        if (bookingStage === 'chooser' || !mapRef.current) {
            return undefined;
        }

        let frameId = 0;
        let readyTimeoutId = 0;
        let resizeObserver = null;

        const syncMapSize = () => {
            window.cancelAnimationFrame(frameId);

            frameId = window.requestAnimationFrame(() => {
            const mapContainer = mapContainerRef.current;
            const map = mapRef.current;

            if (!mapContainer || !map) {
                return;
            }

            const { height, width } = mapContainer.getBoundingClientRect();

            if (height <= 0 || width <= 0) {
                return;
            }

            map.invalidateSize(false);

            if (selectedVenue && lastFocusedVenueRef.current !== selectedVenue.id) {
                lastFocusedVenueRef.current = selectedVenue.id;
                map.flyTo([selectedVenue.lat, selectedVenue.lng], 12, { duration: 0.4 });
            }
        });

        };

        syncMapSize();
        readyTimeoutId = window.setTimeout(syncMapSize, 180);
        window.setTimeout(syncMapSize, 420);

        if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
            resizeObserver = new ResizeObserver(syncMapSize);
            resizeObserver.observe(mapContainerRef.current);
        }

        window.addEventListener('resize', syncMapSize);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.clearTimeout(readyTimeoutId);
            window.removeEventListener('resize', syncMapSize);
            resizeObserver?.disconnect();
        };
    }, [bookingStage, selectedVenue, selectedVenueId, theme]);

    const handleContinueReservation = () => {
        if (!selectedVenue) {
            return;
        }

        onNavigate({
            page: 'createMatch',
            params: {
                presetSport: sport,
                venueId: selectedVenue.id,
                presetDate: date,
                presetTime: time,
                presetDistrict: district || selectedVenue.location
            }
        });
    };

    const handleReserveVenue = async ({ venue = selectedVenue, reservationDate = date, reservationTime = time, strategy = 'smart' } = {}) => {
        if (!venue || isSubmittingReservation) {
            return;
        }

        setIsSubmittingReservation(true);

        try {
            const allocation = await reserveLiveBookingSession({
                venue,
                date: reservationDate,
                time: reservationTime,
                currentUser: bookingCurrentUser,
                usersById,
                selectedPlayerIds: selectedLivePlayerIds,
                venues: state.venues,
                strategy
            });
            const liveBookingId = allocation.slotId;
            const trackedParticipantIds = allocation?.slot?.participantIds?.length
                ? allocation.slot.participantIds
                : Array.from(new Set([bookingCurrentUser.id, ...selectedLivePlayerIds]));
            const targetGroupSize = allocation?.slot?.targetGroupSize || SPORT_BOOKING_PRESETS[venue.sport]?.targetGroupSize || 4;

            if (dispatch && !state.matches.some((match) => match.booking?.liveBookingId === liveBookingId)) {
                dispatch({
                    type: 'CREATE_MATCH',
                    payload: {
                        newMatch: {
                            id: `live-${liveBookingId}`,
                            sport: venue.sport,
                            venueId: venue.id,
                            date: reservationDate,
                            time: reservationTime,
                            skill: bookingCurrentUser.playStyle || 'Balanced',
                            totalSlots: targetGroupSize,
                            participants: trackedParticipantIds,
                            creatorId: bookingCurrentUser.id,
                            status: 'upcoming',
                            isLeague: false,
                            isPrivate: false,
                            cost: venue.price || 0,
                            comments: [],
                            feedback: [],
                            result: null,
                            booking: {
                                status: allocation.status === 'waitlisted' ? 'waitlisted' : 'venue confirmed',
                                reservedAt: 'Now',
                                paymentStatus: (venue.price || 0) > 0
                                    ? `split ready • HKD ${Math.ceil((venue.price || 0) / Math.max(targetGroupSize, 1))}/player`
                                    : 'free venue',
                                venueLocked: true,
                                liveBookingId,
                                liveBookingStatus: allocation.status || 'reserved'
                            },
                            matchmaking: {
                                enabled: selectedLivePlayerIds.length > 0,
                                status: selectedLivePlayerIds.length > 0 ? 'searching' : 'manual',
                                confidence: 0,
                                fitSummary: selectedLivePlayerIds.length > 0
                                    ? 'Friend invitations are attached to this booking.'
                                    : 'Manual lobby created from the live booking board.',
                                inviteWave: 1,
                                openSlots: Math.max(targetGroupSize - trackedParticipantIds.length, 0),
                                preferences: {
                                    playStyle: bookingCurrentUser.playStyle || 'Balanced',
                                    inclusionFocus: 'Friends first'
                                },
                                suggestions: []
                            }
                        }
                    }
                });
            }

            if (allocation.status === 'waitlisted') {
                showToast('That court is full, so you were placed into the live waitlist.');
            } else {
                showToast('Live slot secured and synced to the booking board.');
            }

            onNavigate({ page: 'bookingLobbies', params: { highlightSlotId: allocation.slotId } });
        } catch (error) {
            showToast(error?.message || 'Live booking could not be completed right now.');
        } finally {
            setIsSubmittingReservation(false);
        }
    };

    const handleToggleLivePlayer = (playerId) => {
        setSelectedLivePlayerIds((currentPlayerIds) => {
            if (currentPlayerIds.includes(playerId)) {
                return currentPlayerIds.filter((entry) => entry !== playerId);
            }

            if (currentPlayerIds.length >= inviteCapacity) {
                return currentPlayerIds;
            }

            return [...currentPlayerIds, playerId];
        });
    };

    if (bookingStage === 'chooser') {
        return (
            <div className="page-content bookings-page tech-page">
                <Header title="Bookings" onNavigate={onNavigate} />
                <section className="hero-panel bookings-hero fade-in surface-tier-3">
                    <span className="section-kicker">Booking control</span>
                    <h2 className="section-title">Choose the task you want to complete first</h2>
                    <p>Start a new venue reservation or jump straight into your live booking management tools without mixing both tasks together.</p>
                    <div className="signal-badge-row top-gap-sm">
                        <span className="signal-badge"><i className="fas fa-building-circle-check" aria-hidden="true"></i>{hostedLobbies.length} active lobbies</span>
                        <span className="signal-badge"><i className="fas fa-users" aria-hidden="true"></i>{participatingMatches.length} total sessions</span>
                    </div>
                </section>
                <section className="booking-entry-grid fade-in">
                    <button type="button" className="booking-entry-card surface-tier-2" onClick={() => setBookingStage('new')}>
                        <span className="metric-icon"><i className="fas fa-map-location-dot" aria-hidden="true"></i></span>
                        <span className="section-kicker">Page 1</span>
                        <h3>Book a New Venue</h3>
                        <p>Choose a court, tune the session details, and move into route planning right after confirmation.</p>
                    </button>
                    <button type="button" className="booking-entry-card surface-tier-2" onClick={() => onNavigate({ page: 'bookingLobbies', params: {} })}>
                        <span className="metric-icon"><i className="fas fa-display" aria-hidden="true"></i></span>
                        <span className="section-kicker">Page 2</span>
                        <h3>Manage My Bookings</h3>
                        <p>Review booked venues, AI fill progress, player status, and lobby readiness in one place.</p>
                    </button>
                </section>
            </div>
        );
    }

    return (
        <div className="page-content bookings-page tech-page">
            <Header title="Bookings" onNavigate={onNavigate} />
            <section className="hero-panel bookings-hero fade-in surface-tier-3">
                <span className="section-kicker">Reservation desk</span>
                <h2 className="section-title">Build a new venue reservation</h2>
                <p>Pick a venue, tune the session details, then continue into route planning as soon as the booking is confirmed.</p>
                <div className="signal-badge-row top-gap-sm">
                    <span className="signal-badge"><i className="fas fa-building-circle-check" aria-hidden="true"></i>{hostedLobbies.length} active lobbies</span>
                    <span className="signal-badge"><i className="fas fa-users" aria-hidden="true"></i>{participatingMatches.length} total sessions</span>
                </div>
                <button type="button" className="btn-secondary top-gap-md" onClick={() => setBookingStage('chooser')}>Back to Booking Menu</button>
            </section>

            <section className="booking-command-grid fade-in">
                <div className="booking-command-card surface-tier-2">
                    <div className="section-heading-row compact-heading-row">
                        <div>
                            <span className="section-kicker">Command deck</span>
                            <h3 className="section-title">Keep the booking decision readable</h3>
                        </div>
                        <span className="signal-badge"><i className="fas fa-sliders" aria-hidden="true"></i>{hasActiveAdvancedFilters ? 'Custom timing' : 'Default timing'}</span>
                    </div>

                    <div className="booking-command-metrics">
                        {bookingCommandMetrics.map((metric) => (
                            <div key={metric.label} className="booking-command-metric surface-tier-1">
                                <span>{metric.label}</span>
                                <strong>{metric.value}</strong>
                                <small>{metric.detail}</small>
                            </div>
                        ))}
                    </div>

                    <div className="booking-command-timeline">
                        <div className="booking-command-line">
                            <span>Session frame</span>
                            <strong>{selectedDateLabel} • {formatHourLabel(time)}</strong>
                        </div>
                        <div className="booking-command-line">
                            <span>Venue target</span>
                            <strong>{selectedVenue ? `${selectedVenue.name} • ${selectedVenue.location}` : 'Choose a venue pin'}</strong>
                        </div>
                        <div className="booking-command-line">
                            <span>Live shortlist</span>
                            <strong>{stagedLivePlayerLabel}</strong>
                        </div>
                    </div>

                    <div className="booking-command-actions">
                        <button type="button" className="btn-primary" onClick={() => selectedVenue ? handleContinueReservation() : setShowAdvancedFilters(true)}>
                            {selectedVenue ? 'Continue Session Builder' : 'Set Booking Filters'}
                        </button>
                        <button type="button" className="btn-secondary" onClick={() => onNavigate({ page: 'bookingLobbies', params: {} })}>
                            Open Lobby Management
                        </button>
                        {selectedVenue ? (
                            <button type="button" className="btn-secondary" onClick={() => onNavigate({ page: 'explore', params: { venueId: selectedVenue.id, sport, search: selectedVenue.name } })}>
                                Compare Route Options
                            </button>
                        ) : null}
                    </div>
                </div>

                <div className="booking-command-card booking-market-card surface-tier-2">
                    <div className="section-heading-row compact-heading-row">
                        <div>
                            <span className="section-kicker">Market signal</span>
                            <h3 className="section-title">What the live board is telling you</h3>
                        </div>
                    </div>

                    {bookingBoard.bestImmediateSlot ? (
                        <div className="booking-market-highlight surface-tier-1">
                            <span className="section-kicker">Top current slot</span>
                            <h4>{bookingBoard.bestImmediateSlot.venueName} • {bookingBoard.bestImmediateSlot.courtLabel}</h4>
                            <p>{bookingBoard.bestImmediateSlot.currentParticipantCount}/{bookingBoard.bestImmediateSlot.targetGroupSize} players • {bookingBoard.bestImmediateSlot.probabilityLabel}</p>
                            <div className="signal-badge-row top-gap-sm">
                                {bookingBoard.bestImmediateSlot.reasons.slice(0, 3).map((reason) => (
                                    <span key={reason} className="signal-badge">{reason}</span>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="booking-market-highlight surface-tier-1">
                            <span className="section-kicker">Top current slot</span>
                            <h4>Waiting for a venue target</h4>
                            <p>Choose a venue and time to generate a live slot recommendation for this reservation.</p>
                        </div>
                    )}

                    <div className="booking-market-list">
                        <div className="booking-market-row">
                            <span>Best off-peak escape</span>
                            <strong>{leadingLowDemandWindow ? `${leadingLowDemandWindow.venueName} • ${formatHourLabel(leadingLowDemandWindow.time)}` : 'Not enough district data yet'}</strong>
                        </div>
                        <div className="booking-market-row">
                            <span>Join-random openings</span>
                            <strong>{bookingBoard.joinRandomOptions.length} playable slot{bookingBoard.joinRandomOptions.length === 1 ? '' : 's'}</strong>
                        </div>
                        <div className="booking-market-row">
                            <span>Alternative venues</span>
                            <strong>{bookingBoard.alternativeSlots.length} nearby fallback option{bookingBoard.alternativeSlots.length === 1 ? '' : 's'}</strong>
                        </div>
                    </div>
                </div>
            </section>

            <section className="map-control-grid fade-in">
                <div className="card map-route-panel surface-tier-2 booking-map-experience">
                    <div className="section-heading-row compact-heading-row">
                        <div>
                            <span className="section-kicker">Page 1 of 2</span>
                            <h3 className="section-title">Tap a venue pin to book from the map</h3>
                        </div>
                        <span className="signal-badge"><i className="fas fa-location-dot" aria-hidden="true"></i>{filteredVenues.length} visible venues</span>
                    </div>
                    <div className="input-group top-gap-sm">
                        <label>Matching venue</label>
                        <select
                            className="input-field booking-select-control"
                            value={selectedVenueId}
                            onChange={(event) => setSelectedVenueId(event.target.value)}
                            disabled={filteredVenues.length === 0}
                        >
                            {filteredVenues.length === 0 ? (
                                <option value="">No venues match the current filters</option>
                            ) : (
                                filteredVenues.map((venue) => (
                                    <option key={venue.id} value={venue.id}>{venue.name} • {venue.location} • HKD {venue.price}</option>
                                ))
                            )}
                        </select>
                    </div>
                    <div className="booking-map-shell booking-map-shell-expanded">
                        <div className={`booking-map-status ${leafletReady ? 'is-hidden' : ''}`} role="status" aria-live="polite">
                            <i className={`fas ${mapStatus === 'error' ? 'fa-circle-exclamation' : 'fa-map-location-dot'}`} aria-hidden="true"></i>
                            <span>{mapStatus === 'error' ? 'The live venue map could not be loaded right now.' : 'Loading the live venue map...'}</span>
                        </div>
                        <div ref={mapContainerRef} id="map" className="booking-selection-map booking-selection-map-expanded"></div>
                    </div>
                    <button type="button" className="map-inline-link" onClick={() => onNavigate({ page: 'explore', params: { venueId: selectedVenueId, sport, search: selectedVenue?.name || '' } })}>
                        Need live routing before you commit? Open Explore and compare route options.
                    </button>
                </div>

                <div className="card map-route-panel surface-tier-1 booking-control-panel">
                    <div className="section-heading-row compact-heading-row">
                        <div>
                            <span className="section-kicker">Session builder</span>
                            <h3 className="section-title">Fine-tune the booking around your selected venue</h3>
                        </div>
                    </div>

                    <div className="booking-filter-grid booking-filter-grid-compact">
                        <div className="input-group booking-filter-group">
                            <label>Sport filter</label>
                            <select className="input-field booking-select-control" value={sport} onChange={(event) => setSport(event.target.value)}>
                                <option value="">All Sports</option>
                                {sportOptions.filter((sportOption) => sportOption !== 'All Sports').map((sportOption) => (
                                    <option key={sportOption} value={sportOption}>{sportOption}</option>
                                ))}
                            </select>
                        </div>

                        <div className="input-group booking-filter-group">
                            <label>District filter</label>
                            <select className="input-field booking-select-control" value={district} onChange={(event) => setDistrict(event.target.value)}>
                                <option value="">All Districts</option>
                                {districtOptions.filter((districtOption) => districtOption !== 'All Districts').map((districtOption) => (
                                    <option key={districtOption} value={districtOption}>{districtOption}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <button type="button" className={`booking-advanced-toggle top-gap-md ${showAdvancedFilters ? 'open' : ''}`} onClick={() => setShowAdvancedFilters((current) => !current)}>
                        <span>
                            <strong>Advanced Filters</strong>
                            <small>{hasActiveAdvancedFilters ? 'Custom timing active' : 'Date and time controls'}</small>
                        </span>
                        <i className={`fas ${showAdvancedFilters ? 'fa-chevron-up' : 'fa-chevron-down'}`} aria-hidden="true"></i>
                    </button>

                    {showAdvancedFilters && (
                        <div className="booking-advanced-panel top-gap-md">
                            <div className="booking-filter-grid booking-filter-grid-compact">
                                <div className="input-group booking-filter-group">
                                    <label>Session date</label>
                                    <select className="input-field booking-select-control" value={date} onChange={(event) => setDate(event.target.value)}>
                                        {dateOptions.map((dateOption) => (
                                            <option key={dateOption.value} value={dateOption.value}>{dateOption.dayLabel} • {dateOption.dateLabel}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="input-group booking-filter-group">
                                    <label>Time window</label>
                                    <select className="input-field booking-select-control" value={timeWindow} onChange={(event) => setTimeWindow(event.target.value)}>
                                        <option value="morning">Morning</option>
                                        <option value="lunch">Lunch</option>
                                        <option value="evening">Evening</option>
                                        <option value="late">Late Night</option>
                                    </select>
                                </div>
                            </div>

                            <div className="input-group booking-filter-group top-gap-md">
                                <label>Preferred start time</label>
                                <select className="input-field booking-select-control" value={time} onChange={(event) => setTime(event.target.value)}>
                                    {hourOptions.map((hour) => (
                                        <option key={hour} value={hour}>{formatHourLabel(hour)}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    {selectedVenue ? (
                        <div className="booking-selection-drawer top-gap-md">
                            <img src={selectedVenue.img} alt={selectedVenue.name} className="booking-selection-thumb" />
                            <div className="booking-selection-copy">
                                <span className="section-kicker">Selected venue</span>
                                <h3>{selectedVenue.name}</h3>
                                <p>{selectedVenue.location} • {selectedDateLabel} • {formatHourLabel(time)}</p>
                                <div className="signal-badge-row top-gap-sm">
                                    <span className="signal-badge"><i className="fas fa-dollar-sign" aria-hidden="true"></i>HKD {selectedVenue.price}/hr</span>
                                    <span className="signal-badge"><i className="fas fa-bolt" aria-hidden="true"></i>{selectedVenue.availability}</span>
                                    <span className="signal-badge"><i className="fas fa-check-circle" aria-hidden="true"></i>{selectedVenue.facilities.length} facilities</span>
                                    <span className="signal-badge"><i className="fas fa-brain" aria-hidden="true"></i>{bookingBoard.bestImmediateSlot?.probabilityLabel || 'Live model syncing'}</span>
                                </div>
                                {bookingBoard.bestImmediateSlot && (
                                    <p className="route-summary-line top-gap-sm">
                                        Best live option: {bookingBoard.bestImmediateSlot.courtLabel} • {bookingBoard.bestImmediateSlot.currentParticipantCount}/{bookingBoard.bestImmediateSlot.targetGroupSize} players • {bookingBoard.bestImmediateSlot.probabilityScore}% fill probability.
                                    </p>
                                )}
                            </div>
                            <div className="booking-selection-actions">
                                <button type="button" className="btn-primary booking-selection-cta" onClick={() => handleReserveVenue({ strategy: 'smart' })} disabled={isSubmittingReservation}>
                                    {isSubmittingReservation ? 'Reserving...' : 'Reserve Best Live Slot'}
                                </button>
                                <button type="button" className="btn-secondary booking-selection-cta" onClick={handleContinueReservation}>
                                    Continue Session Builder
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="route-summary-card surface-tier-1 top-gap-md">
                            <p className="route-summary-line">No venues match this filter combination yet. Widen the district or sport to keep the map populated.</p>
                        </div>
                    )}

                    {selectedVenue ? (
                        <div className="card surface-tier-1 top-gap-md">
                            <div className="section-heading-row compact-heading-row">
                                <div>
                                    <span className="section-kicker">Live teammates</span>
                                    <h3 className="section-title">Add real players already online</h3>
                                </div>
                                <span className="signal-badge"><i className="fas fa-users" aria-hidden="true"></i>{selectedLivePlayerIds.length}/{inviteCapacity} selected</span>
                            </div>
                            <p className="route-summary-line top-gap-sm">These players are online now and ranked for this sport, district, and availability window.</p>
                            {livePlayerOptions.length > 0 ? (
                                <div className="friend-select-grid top-gap-md">
                                    {livePlayerOptions.map((player) => {
                                        const isSelected = selectedLivePlayerIds.includes(player.id);

                                        return (
                                            <button
                                                key={player.id}
                                                type="button"
                                                className={`friend-select-card ${isSelected ? 'active' : ''}`}
                                                onClick={() => handleToggleLivePlayer(player.id)}
                                                disabled={!isSelected && selectedLivePlayerIds.length >= inviteCapacity}
                                            >
                                                <img src={player.avatar} alt={player.name} className="friend-signal-avatar" />
                                                <strong>{player.name}</strong>
                                                <p>{player.district} • {player.liveStatus}{player.isFriend ? ' • Friend' : ''}</p>
                                                <p>{player.fitScore}% fit • {player.reasons.join(' • ')}</p>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="route-summary-card surface-tier-1 top-gap-md">
                                    <p className="route-summary-line">No matching live players are online right now. Reserve the slot solo or continue to session builder.</p>
                                </div>
                            )}
                        </div>
                    ) : null}

                </div>
            </section>

            <div className="booking-tablet-summary-grid">
                <section className="booking-hub-grid fade-in">
                    <button type="button" className="booking-hub-card" onClick={() => onNavigate({ page: 'bookingLobbies', params: {} })}>
                        <span className="metric-icon"><i className="fas fa-display" aria-hidden="true"></i></span>
                        <div className="signal-card-copy">
                            <span className="section-kicker">Management shortcut</span>
                            <h3>Open my booking management page</h3>
                            <p>Jump into live lobbies, payment readiness, and player confirmation without restarting the booking flow.</p>
                        </div>
                    </button>
                </section>

                {selectedVenue && bookingBoard.bestImmediateSlot && (
                    <section className="card surface-tier-2 fade-in booking-spotlight-card">
                        <div className="section-heading-row compact-heading-row">
                            <div>
                                <span className="section-kicker">Predictive allocator</span>
                                <h3 className="section-title">Best slot right now is {bookingBoard.bestImmediateSlot.courtLabel}</h3>
                            </div>
                            <span className="signal-badge"><i className="fas fa-wave-square" aria-hidden="true"></i>{bookingBoard.bestImmediateSlot.probabilityScore}%</span>
                        </div>
                        <p className="route-summary-line">{bookingBoard.bestImmediateSlot.currentParticipantCount}/{bookingBoard.bestImmediateSlot.targetGroupSize} players confirmed • District live pressure {bookingBoard.districtLivePressure}%.</p>
                        <div className="signal-badge-row top-gap-sm">
                            {bookingBoard.bestImmediateSlot.reasons.map((reason) => (
                                <span key={reason} className="signal-badge">{reason}</span>
                            ))}
                        </div>
                    </section>
                )}

                {nextHostedLobby && (
                    <section className="card surface-tier-2 fade-in booking-spotlight-card">
                        <div className="section-heading-row compact-heading-row">
                            <div>
                                <span className="section-kicker">Next live lobby</span>
                                <h3 className="section-title">{nextHostedLobby.sport} at {nextHostedVenue?.name}</h3>
                            </div>
                            <span className="signal-badge"><i className="fas fa-users" aria-hidden="true"></i>{nextHostedLobby.participants.length}/{nextHostedLobby.totalSlots}</span>
                        </div>
                        <p className="route-summary-line">{nextHostedLobby.date} at {formatHourLabel(nextHostedLobby.time)} • {nextHostedVenue?.location}</p>
                        <button type="button" className="btn-secondary top-gap-md" onClick={() => onNavigate({ page: 'bookingLobbies', params: {} })}>Open Lobby Management</button>
                    </section>
                )}
            </div>

            {bookingBoard.joinRandomOptions.length > 0 && (
                <section className="panel-stack fade-in mt-4">
                    <div className="section-heading-row compact-heading-row">
                        <div>
                            <span className="section-kicker">Join random first</span>
                            <h3 className="section-title">Partial groups closest to completion</h3>
                        </div>
                    </div>
                    <div className="bookings-list">
                        {bookingBoard.joinRandomOptions.slice(0, 3).map((slot) => (
                            <div key={slot.id} className="card booking-lobby-card surface-tier-2">
                                <div className="section-heading-row compact-heading-row">
                                    <div>
                                        <span className="section-kicker">{slot.courtLabel}</span>
                                        <h3 className="section-title">{slot.currentParticipantCount}/{slot.targetGroupSize} players</h3>
                                    </div>
                                    <span className="signal-badge"><i className="fas fa-brain" aria-hidden="true"></i>{slot.probabilityScore}%</span>
                                </div>
                                <p className="route-summary-line">{selectedVenue.name} • {formatHourLabel(slot.time)} • {slot.probabilityLabel}</p>
                                <div className="signal-badge-row top-gap-sm">
                                    {slot.reasons.map((reason) => (
                                        <span key={reason} className="signal-badge">{reason}</span>
                                    ))}
                                </div>
                                <button type="button" className="btn-primary top-gap-md" onClick={() => handleReserveVenue({ strategy: 'join-random' })} disabled={isSubmittingReservation}>
                                    Join Random Selection
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {bookingBoard.alternativeSlots.length > 0 && (
                <section className="panel-stack fade-in mt-4">
                    <div className="section-heading-row compact-heading-row">
                        <div>
                            <span className="section-kicker">Same-district fallback</span>
                            <h3 className="section-title">Nearest higher-probability alternatives</h3>
                        </div>
                    </div>
                    <div className="bookings-list">
                        {bookingBoard.alternativeSlots.map((slot) => (
                            <div key={slot.id} className="card booking-lobby-card surface-tier-1">
                                <div className="section-heading-row compact-heading-row">
                                    <div>
                                        <span className="section-kicker">{slot.venueName}</span>
                                        <h3 className="section-title">{slot.courtLabel} • {slot.sport}</h3>
                                    </div>
                                    <span className="signal-badge"><i className="fas fa-chart-line" aria-hidden="true"></i>{slot.probabilityScore}%</span>
                                </div>
                                <p className="route-summary-line">{slot.date} • {formatHourLabel(slot.time)} • {slot.currentParticipantCount}/{slot.targetGroupSize} players</p>
                                <button type="button" className="btn-secondary top-gap-md" onClick={() => handleReserveVenue({ venue: slot.venue, reservationDate: slot.date, reservationTime: slot.time, strategy: 'smart' })} disabled={isSubmittingReservation}>
                                    Reserve Alternative
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {bookingBoard.lowDemandEntries.length > 0 && (
                <section className="panel-stack fade-in mt-4">
                    <div className="section-heading-row compact-heading-row">
                        <div>
                            <span className="section-kicker">Weekly district board</span>
                            <h3 className="section-title">Top 10 lowest-demand periods in {state.currentUser?.district || liveDistrict}</h3>
                        </div>
                    </div>
                    <div className="bookings-list">
                        {bookingBoard.lowDemandEntries.slice(0, 10).map((entry, index) => (
                            <div key={entry.slotId} className="booking-item tech-booking-item surface-tier-1">
                                <div className="booking-details">
                                    <h4>#{index + 1} {entry.venueName} • {entry.courtLabel}</h4>
                                    <p>{entry.date} • {formatHourLabel(entry.time)} • HKD {entry.price || 0}</p>
                                </div>
                                <span className="signal-badge">{entry.offPeakOpportunityScore}% low demand</span>
                            </div>
                        ))}
                    </div>
                </section>
            )}

        </div>
    );
};

export default BookingPage;
