import React, { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeToUserLiveBookings, subscribeToWeeklyDistrictLeaderboard } from '../../app/data/liveBookings';
import { fetchVenueWeather } from '../../app/data/venueWeather';

export const BookingLobbiesPage = ({ state, onBack, onNavigate, Header, formatHourLabel, highlightSlotId = '' }) => {
    const hostedLobbies = state.matches.filter(match => match.creatorId === state.currentUser.id && match.booking && match.status !== 'cancelled');
    const participatingMatches = state.matches.filter(match => match.participants.includes(state.currentUser.id));
    const [liveReservations, setLiveReservations] = useState([]);
    const [weeklyLeaderboard, setWeeklyLeaderboard] = useState(null);
    const venuesById = useMemo(() => state.venues.reduce((accumulator, venue) => ({
        ...accumulator,
        [venue.id]: venue
    }), {}), [state.venues]);

    useEffect(() => {
        const unsubscribeReservations = subscribeToUserLiveBookings(state.currentUser.id, setLiveReservations, () => setLiveReservations([]));
        const unsubscribeLeaderboard = subscribeToWeeklyDistrictLeaderboard({ district: state.currentUser?.district }, setWeeklyLeaderboard, () => setWeeklyLeaderboard(null));

        return () => {
            unsubscribeReservations();
            unsubscribeLeaderboard();
        };
    }, [state.currentUser.id, state.currentUser?.district]);

    const sortedLiveReservations = useMemo(() => liveReservations.slice().sort((firstReservation, secondReservation) => {
        if (firstReservation.id === highlightSlotId) {
            return -1;
        }

        if (secondReservation.id === highlightSlotId) {
            return 1;
        }

        return `${firstReservation.date}${firstReservation.time}`.localeCompare(`${secondReservation.date}${secondReservation.time}`);
    }), [highlightSlotId, liveReservations]);

    return (
        <div className="page-content bookings-page tech-page">
            <Header title="Session Lobbies" onBack={onBack} onNavigate={onNavigate} />
            <section className="hero-panel bookings-hero fade-in surface-tier-3">
                <span className="section-kicker">Post-booking</span>
                <h2 className="section-title">Manage live session lobbies</h2>
                <p>Track venue confirmation, AI fill progress, and player readiness here without crowding the booking start page.</p>
                <button
                    className="btn-secondary"
                    onClick={() => onNavigate({ page: 'booking', params: {} })}
                >
                    Back to Booking Home
                </button>
            </section>
            <section className="panel-stack fade-in mt-4">
                <div className="section-heading-row">
                    <div>
                        <span className="section-kicker">Live database</span>
                        <h3 className="section-title">Realtime reservations and queues</h3>
                    </div>
                </div>
                {sortedLiveReservations.length === 0 ? (
                    <div className="card surface-tier-1">
                        <p className="text-sm">No live reservations are synced yet for your account. Reserve a live slot from the booking page to populate this board.</p>
                    </div>
                ) : (
                    sortedLiveReservations.map((reservation) => {
                        const venue = venuesById[reservation.venueId];
                        const fillRate = Math.round(((reservation.participantIds || []).length / Math.max(reservation.targetGroupSize || 1, 1)) * 100);

                        return (
                            <div
                                key={reservation.id}
                                className={`card booking-lobby-card surface-tier-2 ${reservation.id === highlightSlotId ? 'live-booking-highlight' : ''}`}
                            >
                                <div className="section-heading-row compact-heading-row">
                                    <div>
                                        <span className="section-kicker">{reservation.courtLabel}</span>
                                        <h3 className="section-title">{reservation.sport} at {reservation.venueName}</h3>
                                    </div>
                                    <span className="signal-badge"><i className="fas fa-users"></i>{(reservation.participantIds || []).length}/{reservation.targetGroupSize}</span>
                                </div>
                                <p className="route-summary-line">{reservation.date} at {formatHourLabel(reservation.time)} • {venue?.location || reservation.district}</p>
                                <p className="route-summary-line">Status: {reservation.status || 'open'} • Waitlist {(reservation.waitlistIds || []).length}</p>
                                <div className="booking-progress-track mt-3">
                                    <div className="booking-progress-fill" style={{ width: `${fillRate}%` }}></div>
                                </div>
                                <div className="signal-badge-row mt-3">
                                    <span className="signal-badge"><i className="fas fa-wave-square"></i>{Math.round((reservation.presetDemandScore || 0) * 100)}% preset demand</span>
                                    <span className="signal-badge"><i className="fas fa-list"></i>{(reservation.waitlistIds || []).length} queued</span>
                                </div>
                            </div>
                        );
                    })
                )}
            </section>
            <section className="panel-stack fade-in mt-4">
                <div className="section-heading-row">
                    <div>
                        <span className="section-kicker">District efficiency</span>
                        <h3 className="section-title">Top 10 low-demand windows this week</h3>
                    </div>
                </div>
                {weeklyLeaderboard?.entries?.length ? (
                    <div className="bookings-list">
                        {weeklyLeaderboard.entries.map((entry, index) => (
                            <div key={entry.slotId} className="booking-item tech-booking-item surface-tier-1">
                                <div className="booking-details">
                                    <h4>#{index + 1} {entry.venueName} • {entry.courtLabel}</h4>
                                    <p>{entry.date} • {formatHourLabel(entry.time)} • {entry.currentParticipantCount}/{entry.targetGroupSize} players</p>
                                </div>
                                <span className="signal-badge">{entry.offPeakOpportunityScore}% low demand</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="card surface-tier-1">
                        <p className="text-sm">The district leaderboard will populate as live slots and weekly metrics build up.</p>
                    </div>
                )}
            </section>
            <section className="panel-stack fade-in mt-4">
                <div className="section-heading-row">
                    <div>
                        <span className="section-kicker">Hosted by you</span>
                        <h3 className="section-title">Active session lobbies</h3>
                    </div>
                </div>
                {hostedLobbies.length === 0 ? (
                    <div className="card surface-tier-1">
                        <p className="text-sm">You do not have any active booked venues yet. Reserve a venue to start an AI-assisted session lobby.</p>
                    </div>
                ) : (
                    hostedLobbies.map(match => {
                        const venue = state.venues.find(item => item.id === match.venueId);
                        const nextCandidate = match.matchmaking?.suggestions?.find(candidate => candidate.status === 'invited' || candidate.status === 'queued');
                        const fillRate = Math.round((match.participants.length / match.totalSlots) * 100);

                        return (
                            <button
                                key={match.id}
                                type="button"
                                className="card booking-lobby-card surface-tier-2 interactive-card"
                                onClick={() => onNavigate({ page: 'matchDetail', params: { matchId: match.id } })}
                            >
                                <div className="section-heading-row compact-heading-row">
                                    <div>
                                        <span className="section-kicker">{match.booking.status}</span>
                                        <h3 className="section-title">{match.sport} at {venue?.name}</h3>
                                    </div>
                                    <span className="signal-badge"><i className="fas fa-users"></i>{match.participants.length}/{match.totalSlots}</span>
                                </div>
                                <p className="route-summary-line">{match.date} at {formatHourLabel(match.time)} • {venue?.location}</p>
                                <p className="route-summary-line">AI status: {match.matchmaking?.status || 'manual'} • Confidence {match.matchmaking?.confidence || 0}%</p>
                                <div className="booking-progress-track mt-3">
                                    <div className="booking-progress-fill" style={{ width: `${fillRate}%` }}></div>
                                </div>
                                <div className="signal-badge-row mt-3">
                                    <span className="signal-badge"><i className="fas fa-credit-card"></i>{match.booking.paymentStatus}</span>
                                    <span className="signal-badge"><i className="fas fa-user-plus"></i>{match.matchmaking?.openSlots || 0} slots open</span>
                                </div>
                                {nextCandidate && (
                                    <div className="matchmaking-candidate-row mt-3">
                                        <span className="font-semibold">Next best fit:</span>
                                        <span>{state.users[nextCandidate.userId]?.name} • {nextCandidate.score}%</span>
                                    </div>
                                )}
                            </button>
                        );
                    })
                )}
            </section>
            <section className="panel-stack fade-in mt-4">
                <div className="section-heading-row">
                    <div>
                        <span className="section-kicker">All sessions</span>
                        <h3 className="section-title">Your participation list</h3>
                    </div>
                </div>
                <div className="bookings-list">
                    {participatingMatches.length === 0 ? (
                        <p className="text-sm text-gray-500">No bookings yet. Reserve a venue to get started.</p>
                    ) : (
                        participatingMatches.map(match => (
                            <button
                                key={match.id}
                                type="button"
                                className="booking-item tech-booking-item interactive-card booking-item-button"
                                onClick={() => onNavigate({ page: 'matchDetail', params: { matchId: match.id } })}
                            >
                                <div className="booking-details">
                                    <h4>{match.sport} - {match.date}</h4>
                                    <p>Status: {match.status} • {match.participants.length}/{match.totalSlots} confirmed</p>
                                </div>
                                <span className={`status-badge status-${match.status.toLowerCase()}`}>
                                    {match.status.charAt(0).toUpperCase() + match.status.slice(1)}
                                </span>
                            </button>
                        ))
                    )}
                </div>
            </section>
        </div>
    );
};

export const VenueDetailPage = ({
    venueId,
    onBack,
    onNavigate,
    state,
    dispatch,
    showToast,
    Header,
    Modal,
    FeedbackModal,
    speak
}) => {
    const venue = state.venues.find(v => v.id === venueId);
    const hasVenue = Boolean(venueId && venue);
    const [modal, setModal] = useState(null);
    const [weather, setWeather] = useState({ status: 'idle', data: null, error: '' });
    const [checkInCode, setCheckInCode] = useState('');
    const weatherRequestKeyRef = useRef('');
    const lastCheckIn = state.lastCheckIn;

    useEffect(() => {
        if (!hasVenue) {
            showToast('Error: Venue not found');
        }
    }, [hasVenue, showToast]);

    const venueMetrics = useMemo(() => {
        if (!hasVenue) {
            return { freeCourts: 0, venueFitScore: 0 };
        }

        const seedSource = `${venue.id}:${venue.rating}:${venue.price}:${venue.availability}`;
        const seed = Array.from(seedSource).reduce((total, character, index) => (
            total + (character.charCodeAt(0) * (index + 3))
        ), 0);
        const availabilityBias = venue.availability === 'Open' ? 2 : 0;
        const freeCourts = Math.max(1, Math.min(6, ((seed % 5) + 1 + availabilityBias)));
        const fitBase = Math.round((venue.rating * 18) + (freeCourts * 3) + Math.min(venue.price / 20, 4));

        return {
            freeCourts,
            venueFitScore: Math.max(62, Math.min(98, fitBase))
        };
    }, [hasVenue, venue?.availability, venue?.id, venue?.price, venue?.rating]);

    useEffect(() => {
        if (!hasVenue) {
            return undefined;
        }

        const requestKey = `${venue.id}:${venue.lat}:${venue.lng}`;

        if (weatherRequestKeyRef.current === requestKey) {
            return undefined;
        }

        weatherRequestKeyRef.current = requestKey;
        setWeather({ status: 'loading', data: null, error: '' });

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 7000);

        const fetchWeather = async () => {
            try {
                const data = await fetchVenueWeather({ venueId: venue.id, lat: venue.lat, lng: venue.lng });
                if (controller.signal.aborted) {
                    return;
                }

                setWeather({
                    status: 'ready',
                    data: {
                        description: data.description || 'Current weather unavailable',
                        temp: data.temp,
                        feelsLike: data.feelsLike
                    },
                    error: ''
                });
            } catch (error) {
                if (error.name === 'AbortError') {
                    setWeather({ status: 'error', data: null, error: 'Weather unavailable right now.' });
                    return;
                }

                setWeather({ status: 'error', data: null, error: 'Weather unavailable right now.' });
                showToast('Live weather is unavailable for this venue right now.');
            } finally {
                window.clearTimeout(timeoutId);
            }
        };

        fetchWeather();

        return () => {
            window.clearTimeout(timeoutId);
            controller.abort();
        };
    }, [hasVenue, showToast, venue?.id, venue?.lat, venue?.lng]);

    if (!hasVenue) {
        return <div className="page-content"><p>Loading error. Go back and try again.</p></div>;
    }

    const handleSubmitReview = (rating, text) => {
        dispatch({ type: 'ADD_VENUE_REVIEW', payload: { venueId, rating, text } });
        showToast('Review submitted!');
        speak('Thank you for your feedback!');
    };

    const handleCheckIn = (code) => {
        if (code === venue.checkInCode) {
            dispatch({ type: 'CHECK_IN', payload: { venueId: venue.id, time: Date.now() } });
            showToast('Checked in successfully!');
            speak('Checked in successfully!');
            setCheckInCode('');
            setModal(null);
            return;
        }

        showToast('Invalid code. Try again.');
        speak('Invalid code. Try again.');
    };

    const handleCheckOut = () => {
        dispatch({ type: 'CHECK_OUT' });
        showToast('Checked out successfully!');
        speak('Checked out successfully!');
        setCheckInCode('');
        setModal(null);
    };

    const weatherDesc = weather.status === 'error'
        ? weather.error
        : (weather.data?.description || 'Loading current conditions...');
    const temp = weather.status === 'ready' ? weather.data?.temp : '';
    const feelsLike = weather.status === 'ready' ? weather.data?.feelsLike : null;
    const freeCourts = venueMetrics.freeCourts;
    const venueFitScore = venueMetrics.venueFitScore;

    return (
        <div className="page-content tech-page venue-page-shell">
            <Header title={venue.name} onBack={onBack} onNavigate={onNavigate} />
            <div className="fade-in">
                <section className="hero-panel venue-hero-panel">
                    <img src={venue.img} className="venue-hero-image" alt={venue.name} />
                    <span className="section-kicker">Venue dossier</span>
                    <h2 className="section-title">{venue.name}</h2>
                    <p className="text-sm mb-4">{venue.description}</p>
                    <div className="signal-badge-row">
                        <span className="signal-badge"><i className="fas fa-map-marker-alt"></i>{venue.location}</span>
                        <span className="signal-badge"><i className="fas fa-dollar-sign"></i>HKD ${venue.price}/hr</span>
                        <span className="signal-badge"><i className="fas fa-star"></i>{venue.rating}</span>
                        <span className="signal-badge"><i className="fas fa-clock"></i>{venue.availability}</span>
                        <span className="signal-badge"><i className="fas fa-table-cells"></i>{freeCourts} free courts</span>
                    </div>
                    <div className="glass-metric-grid venue-metric-grid mt-4">
                        <div className="glass-metric-card">
                            <span className="glass-metric-label">Rating</span>
                            <strong>{venue.rating}</strong>
                            <p>Community score</p>
                        </div>
                        <div className="glass-metric-card">
                            <span className="glass-metric-label">Price</span>
                            <strong>HKD {venue.price}</strong>
                            <p>Per hour</p>
                        </div>
                        <div className="glass-metric-card">
                            <span className="glass-metric-label">Open Slots</span>
                            <strong>{freeCourts}</strong>
                            <p>Courts free now</p>
                        </div>
                        <div className="glass-metric-card">
                            <span className="glass-metric-label">AI Fit</span>
                            <strong>{venueFitScore}%</strong>
                            <p>Strong for social play</p>
                        </div>
                    </div>
                    <div className="cta-button-row mt-4">
                        <button className="btn-primary" onClick={() => onNavigate({ page: 'createMatch', params: { venueId } })}>Reserve Venue</button>
                        <button className="btn-secondary" onClick={() => onNavigate({ page: 'explore', params: { venueId } })}>View in Explore</button>
                    </div>
                </section>
                <div className="weather-card mt-4">
                    <i className="fas fa-cloud-sun mr-4 text-3xl"></i>
                    <div>
                        <h4 className="font-semibold">Current Weather</h4>
                        <p>{weather.status === 'ready' ? `${weatherDesc} - ${temp}°C${typeof feelsLike === 'number' ? ` • feels like ${feelsLike}°C` : ''}` : weatherDesc}</p>
                    </div>
                </div>
                <section className="card surface-tier-2 mt-4 venue-overview-panel">
                    <div className="section-heading-row compact-heading-row">
                        <div>
                            <span className="section-kicker">Why this venue works</span>
                            <h3 className="section-title">Fast read before you reserve</h3>
                        </div>
                    </div>
                    <div className="signal-badge-row">
                        <span className="signal-badge"><i className="fas fa-bolt"></i>{venue.availability} booking state</span>
                        <span className="signal-badge"><i className="fas fa-people-group"></i>{venue.sport} community fit</span>
                        <span className="signal-badge"><i className="fas fa-shield-heart"></i>Inclusive access friendly</span>
                    </div>
                </section>
                <section className="command-section mt-4">
                    <h3 className="section-title">Facilities</h3>
                    <div className="signal-badge-row mt-3 mb-4">
                        {venue.facilities.map(f => <span key={f} className="signal-badge">{f}</span>)}
                    </div>
                </section>
                <section className="command-section">
                    <h3 className="section-title">Reviews</h3>
                    {venue.reviews.length === 0 ? (
                        <p className="text-sm text-gray-500">No reviews yet.</p>
                    ) : (
                        venue.reviews.map((r, i) => (
                            <div key={i} className="card mb-2">
                                <div className="flex justify-between">
                                    <span className="font-semibold text-sm">{state.users[r.userId].name}</span>
                                    <span className="text-xs text-gray-500">{r.time}</span>
                                </div>
                                <p className="text-sm">{'★'.repeat(r.rating)} {'☆'.repeat(5 - r.rating)}</p>
                                <p className="text-sm">{r.text}</p>
                            </div>
                        ))
                    )}
                </section>
                <div className="cta-button-row mt-4">
                    <button className="btn-secondary" onClick={() => setModal('feedback')}>Leave Feedback</button>
                    <button className="btn-primary" onClick={() => onNavigate({ page: 'createMatch', params: { venueId } })}>Start AI Session</button>
                </div>
                <button className="btn-secondary mt-2" onClick={() => setModal('safetyCheckIn')}>Safety Check-In</button>
            </div>
            {modal === 'feedback' && (
                <FeedbackModal
                    isOpen={true}
                    close={() => setModal(null)}
                    onSubmit={handleSubmitReview}
                    type="venue"
                    targetName={venue.name}
                />
            )}
            {modal === 'safetyCheckIn' && (
                <Modal isOpen={true} close={() => setModal(null)} title="Safety Check-In">
                    {lastCheckIn ? (
                        <>
                            <p className="text-sm mb-4">
                                Checked in at {new Date(lastCheckIn.time).toLocaleString()}.
                            </p>
                            <button className="btn-primary" onClick={handleCheckOut}>
                                Check Out
                            </button>
                        </>
                    ) : (
                        <>
                            <p className="text-sm mb-4">Enter venue check-in code:</p>
                            <div className="input-group">
                                <input
                                    type="text"
                                    placeholder="e.g., VP123"
                                    className="input-field"
                                    value={checkInCode}
                                    onChange={(event) => setCheckInCode(event.target.value)}
                                    onKeyDown={event => event.key === 'Enter' && handleCheckIn(checkInCode)}
                                />
                            </div>
                            <button
                                className="btn-primary"
                                onClick={() => handleCheckIn(checkInCode)}
                            >
                                Check In
                            </button>
                        </>
                    )}
                </Modal>
            )}
        </div>
    );
};