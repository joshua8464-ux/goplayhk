import React, { useEffect, useMemo, useState } from 'react';
import { subscribeToDistrictLiveSlots } from '../../data/liveBookings';
import { buildCompatibility } from '../../data/matchmaking';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getSportIcon = (sport) => {
    switch (sport.toLowerCase()) {
        case 'tennis':
            return 'table-tennis-paddle-ball';
        case 'basketball':
            return 'basketball';
        case 'badminton':
            return 'feather';
        case 'football':
        case 'rugby':
            return 'futbol';
        case 'swimming':
            return 'swimmer';
        case 'volleyball':
            return 'volleyball-ball';
        case 'athletics':
            return 'stopwatch';
        case 'horse racing':
            return 'horse';
        case 'multi-sport':
            return 'dumbbell';
        case 'running':
            return 'running';
        case 'hiking':
            return 'hiking';
        case 'cycling':
            return 'bicycle';
        default:
            return 'question';
    }
};

const buildLiveSlotProbability = (slot) => {
    const participants = (slot.participantIds || []).length;
    const targetGroupSize = slot.targetGroupSize || 4;
    const occupancyRatio = participants / Math.max(targetGroupSize, 1);

    return Math.round(clamp((((slot.presetDemandScore || 0.5) * 0.55) + (occupancyRatio * 0.45)) * 100, 18, 97));
};

const HomePage = ({ state, onNavigate, Header }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [liveSlots, setLiveSlots] = useState([]);
    const upcomingMatches = state.matches.filter((match) => match.status === 'upcoming').slice(0, 3);
    const recommendedVenues = state.venues.slice(0, 3);
    const friendsOnline = state.currentUser.friends.map((friendId) => state.users[friendId]).filter(Boolean);
    const quickActions = [
        { label: 'Join A Group', icon: 'fa-users-line', page: 'booking' },
        { label: 'Fill My Team', icon: 'fa-wand-magic-sparkles', page: 'bookingLobbies' },
        { label: 'Find Players', icon: 'fa-user-group', page: 'friendsDiscover' },
        { label: 'Create Match', icon: 'fa-plus', page: 'createMatch' },
        { label: 'Venue Radar', icon: 'fa-map', page: 'explore' }
    ];

    const handleSearch = (event) => {
        setSearchQuery(event.target.value);
        if (event.target.value.trim()) {
            onNavigate({ page: 'explore', params: { search: event.target.value } });
        }
    };

    const featuredMatch = upcomingMatches[0] || null;
    const featuredVenue = featuredMatch
        ? state.venues.find((venue) => venue.id === featuredMatch.venueId) || null
        : null;
    const venueById = useMemo(() => state.venues.reduce((accumulator, venue) => ({
        ...accumulator,
        [venue.id]: venue
    }), {}), [state.venues]);

    useEffect(() => {
        const unsubscribe = subscribeToDistrictLiveSlots({ district: state.currentUser?.district || '' }, setLiveSlots, () => setLiveSlots([]));

        return () => {
            unsubscribe();
        };
    }, [state.currentUser?.district]);

    const joinableLiveSessions = useMemo(() => liveSlots
        .filter((slot) => slot.sport && ((slot.participantIds || []).length > 0) && ((slot.participantIds || []).length < (slot.targetGroupSize || 4)))
        .sort((firstSlot, secondSlot) => buildLiveSlotProbability(secondSlot) - buildLiveSlotProbability(firstSlot))
        .slice(0, 3), [liveSlots]);

    const hostedNeedsPlayers = useMemo(() => state.matches
        .filter((match) => match.creatorId === state.currentUser.id && match.status === 'upcoming' && match.participants.length < match.totalSlots)
        .sort((firstMatch, secondMatch) => (secondMatch.participants.length / secondMatch.totalSlots) - (firstMatch.participants.length / firstMatch.totalSlots))
        .slice(0, 3), [state.currentUser.id, state.matches]);

    const peopleToMeet = useMemo(() => Object.values(state.users)
        .filter((player) => player.id !== state.currentUser.id && !(state.currentUser.friends || []).includes(player.id))
        .map((player) => ({
            player,
            compatibility: buildCompatibility(state.currentUser, player, { matches: state.matches })
        }))
        .sort((firstEntry, secondEntry) => secondEntry.compatibility.score - firstEntry.compatibility.score)
        .slice(0, 3), [state.currentUser, state.users]);

    const primaryActions = [
        {
            kicker: 'Play now',
            title: 'Find a group',
            detail: joinableLiveSessions.length ? `${joinableLiveSessions.length} playable groups nearby.` : 'Open the fastest playable session nearby.',
            cta: 'Join now',
            page: 'booking'
        },
        {
            kicker: 'Host',
            title: 'Fill my team',
            detail: hostedNeedsPlayers.length ? `${hostedNeedsPlayers.length} sessions still need players.` : 'Start a session and fill it faster.',
            cta: 'Open lobbies',
            page: hostedNeedsPlayers.length ? 'bookingLobbies' : 'createMatch'
        },
        {
            kicker: 'Discover',
            title: 'Find players',
            detail: peopleToMeet.length ? `${peopleToMeet.length} strong nearby fits ready.` : 'Meet compatible players nearby.',
            cta: 'Open discovery',
            page: 'friendsDiscover'
        }
    ];

    return (
        <div className="page-content tech-page home-page-shell">
            <Header title="GoPlayHK" onNavigate={onNavigate} />
            <section className="hero-banner tech-hero fade-in">
                <div className="hero-grid"></div>
                <div className="hero-aurora hero-aurora-one"></div>
                <div className="hero-aurora hero-aurora-two"></div>
                <div className="hero-scanline"></div>
                <div className="hero-copy">
                    <span className="hero-chip">The Control Room</span>
                    <h2 className="hero-title">Link players, fill groups, keep Hong Kong playing.</h2>
                    <p className="hero-description">Build viable groups faster so nobody stops after one good game.</p>
                    <div className="hero-inline-stats">
                        <div className="hero-inline-stat">
                            <span className="hero-inline-value">{state.currentUser.mmr}</span>
                            <span className="hero-inline-label">Current MMR</span>
                        </div>
                        <div className="hero-inline-stat">
                            <span className="hero-inline-value">{friendsOnline.length}</span>
                            <span className="hero-inline-label">Active Friends</span>
                        </div>
                        <div className="hero-inline-stat">
                            <span className="hero-inline-value">{upcomingMatches.length}</span>
                            <span className="hero-inline-label">Upcoming Sessions</span>
                        </div>
                    </div>
                </div>
                <div className="hero-panel hero-next-match">
                    <span className="panel-kicker">Best next move</span>
                    {joinableLiveSessions[0] ? (
                        <>
                            <h3>Join {joinableLiveSessions[0].sport} at {joinableLiveSessions[0].venueName}</h3>
                            <div className="hero-next-match-meta-row">
                                <span className="hero-next-match-chip">{joinableLiveSessions[0].date}</span>
                                <span className="hero-next-match-chip">{joinableLiveSessions[0].time}</span>
                                <span className="hero-next-match-chip">{joinableLiveSessions[0].district}</span>
                            </div>
                            <div className="hero-next-match-stats">
                                <div className="hero-next-match-stat">
                                    <strong>{(joinableLiveSessions[0].participantIds || []).length}/{joinableLiveSessions[0].targetGroupSize}</strong>
                                    <span>players in slot</span>
                                </div>
                                <div className="hero-next-match-stat">
                                    <strong>{buildLiveSlotProbability(joinableLiveSessions[0])}%</strong>
                                    <span>fill confidence</span>
                                </div>
                            </div>
                            <button type="button" className="btn-primary hero-cta" onClick={() => onNavigate({ page: 'booking', params: {} })}>
                                Join A Playable Group
                            </button>
                        </>
                    ) : featuredMatch ? (
                        <>
                            <h3>{featuredMatch.sport} at {featuredVenue?.name}</h3>
                            <div className="hero-next-match-meta-row">
                                <span className="hero-next-match-chip">{featuredMatch.date}</span>
                                <span className="hero-next-match-chip">{featuredMatch.time}</span>
                                <span className="hero-next-match-chip">{featuredVenue?.location || 'Hong Kong'}</span>
                            </div>
                            <div className="hero-next-match-stats">
                                <div className="hero-next-match-stat">
                                    <strong>{featuredMatch.participants.length}/{featuredMatch.totalSlots}</strong>
                                    <span>players confirmed</span>
                                </div>
                                <div className="hero-next-match-stat">
                                    <strong>{featuredMatch.skill}</strong>
                                    <span>recommended level</span>
                                </div>
                            </div>
                            <button type="button" className="btn-primary hero-cta" onClick={() => onNavigate({ page: 'matchDetail', params: { matchId: featuredMatch.id } })}>
                                Open Match Hub
                            </button>
                        </>
                    ) : (
                        <>
                            <h3>No active match yet</h3>
                            <p>Create a new session or let the system recommend open matches nearby.</p>
                            <button type="button" className="btn-primary hero-cta" onClick={() => onNavigate({ page: 'createMatch', params: {} })}>
                                Create Session
                            </button>
                        </>
                    )}
                </div>
            </section>
            <section className="match-funnel-grid fade-in">
                {primaryActions.map((action) => (
                    <button key={action.title} type="button" className="signal-card match-funnel-card surface-tier-2" onClick={() => onNavigate({ page: action.page, params: {} })}>
                        <span className="section-kicker">{action.kicker}</span>
                        <h3>{action.title}</h3>
                        <p>{action.detail}</p>
                        <div className="match-funnel-card-footer">
                            <span className="match-funnel-card-line"></span>
                            <span className="section-link-button">{action.cta}</span>
                        </div>
                    </button>
                ))}
            </section>
            <section className="command-section fade-in home-command-actions-section">
                <div className="section-heading-row">
                    <div>
                        <span className="section-kicker">Command actions</span>
                        <h3 className="section-title">Move fast</h3>
                    </div>
                </div>
                <div className="quick-action-grid">
                    {quickActions.map((action) => (
                        <button key={action.label} type="button" className="quick-action-card surface-tier-2" onClick={() => onNavigate({ page: action.page, params: {} })}>
                            <i className={`fas ${action.icon}`} aria-hidden="true"></i>
                            <span>{action.label}</span>
                        </button>
                    ))}
                </div>
            </section>
            <div className="search-bar tech-search-bar">
                <input
                    type="text"
                    placeholder="Search venues, sports, or match opportunities..."
                    className="input-field"
                    value={searchQuery}
                    onChange={handleSearch}
                />
                <i className="fas fa-search" aria-hidden="true"></i>
            </div>
            <section className="command-section fade-in">
                <div className="section-heading-row">
                    <div>
                        <span className="section-kicker">Playable now</span>
                        <h3 className="section-title">Closest to happening</h3>
                    </div>
                </div>
                {joinableLiveSessions.length > 0 ? (
                    <div className="content-rail compact-card-rail">
                        {joinableLiveSessions.map((slot) => (
                            <button key={slot.id} type="button" className="signal-card venue-signal-card compact-signal-card surface-tier-2 interactive-card rail-card" onClick={() => onNavigate({ page: 'booking', params: {} })}>
                                <div className="signal-card-copy">
                                    <span className="section-kicker">{slot.courtLabel} • {slot.district}</span>
                                    <h4>{slot.sport} at {slot.venueName}</h4>
                                    <p>{slot.date} • {slot.time}</p>
                                    <div className="signal-badge-row">
                                        <span className="signal-badge"><i className="fas fa-users" aria-hidden="true"></i>{(slot.participantIds || []).length}/{slot.targetGroupSize}</span>
                                        <span className="signal-badge"><i className="fas fa-wave-square" aria-hidden="true"></i>{buildLiveSlotProbability(slot)}% likely</span>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="content-rail compact-card-rail">
                        {recommendedVenues.map((venue) => (
                            <button key={venue.id} type="button" className="signal-card venue-signal-card compact-signal-card surface-tier-2 interactive-card rail-card" onClick={() => onNavigate({ page: 'venueDetail', params: { venueId: venue.id } })}>
                                <img src={venue.img} className="signal-card-image" alt={venue.name} />
                                <div className="signal-card-copy">
                                    <h4>{venue.name}</h4>
                                    <p>{venue.location} • {venue.sport}</p>
                                    <div className="signal-badge-row">
                                        <span className="signal-badge"><i className="fas fa-star" aria-hidden="true"></i>{venue.rating}</span>
                                        <span className="signal-badge">{venue.availability}</span>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </section>
            <section className="dual-section-grid fade-in">
                <div className="panel-stack">
                    <div className="section-heading-row">
                        <div>
                            <span className="section-kicker">Fill my group</span>
                            <h3 className="section-title">Sessions still open</h3>
                        </div>
                        <button type="button" className="section-link-button" onClick={() => onNavigate({ page: 'bookingLobbies', params: {} })}>Open lobbies</button>
                    </div>
                    {hostedNeedsPlayers.length === 0 ? (
                        <div className="friends-empty-state surface-tier-1">
                            <h4>No sessions need filling</h4>
                            <p>Start a match and the system will help you attract the right players instead of leaving the group incomplete.</p>
                        </div>
                    ) : hostedNeedsPlayers.map((match) => (
                        <button key={match.id} type="button" className="signal-card venue-signal-card surface-tier-2 interactive-card" onClick={() => onNavigate({ page: 'matchDetail', params: { matchId: match.id } })}>
                            <div className="signal-card-copy">
                                <span className="section-kicker">{match.sport} • {venueById[match.venueId]?.location || 'District pending'}</span>
                                <h4>{venueById[match.venueId]?.name || 'Venue'} needs {Math.max(match.totalSlots - match.participants.length, 0)} more</h4>
                                <p>{match.date} • {match.time} • {match.participants.length}/{match.totalSlots} confirmed</p>
                                <div className="signal-badge-row">
                                    <span className="signal-badge">{match.matchmaking?.confidence || 0}% AI fit</span>
                                    <span className="signal-badge">{match.matchmaking?.status || 'manual'}</span>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
                <div className="panel-stack">
                    <div className="section-heading-row">
                        <div>
                            <span className="section-kicker">People you should meet</span>
                            <h3 className="section-title">High-fit players nearby</h3>
                        </div>
                        <button type="button" className="section-link-button" onClick={() => onNavigate({ page: 'friendsDiscover', params: {} })}>Open discovery</button>
                    </div>
                    {peopleToMeet.map(({ player, compatibility }) => (
                        <button key={player.id} type="button" className="signal-card friend-signal-card surface-tier-1 interactive-card" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: player.id } })}>
                            <img src={player.avatar} className="friend-signal-avatar" alt={player.name} />
                            <div className="signal-card-copy">
                                <h4>{player.name}</h4>
                                <p>{player.availability}</p>
                                <div className="signal-badge-row">
                                    <span className="signal-badge"><i className="fas fa-heart-pulse" aria-hidden="true"></i>{compatibility.score}% fit</span>
                                    {compatibility.reasons.map((reason) => (
                                        <span key={reason} className="signal-badge">{reason}</span>
                                    ))}
                                </div>
                            </div>
                            <span className="presence-pill">Potential teammate</span>
                        </button>
                    ))}
                </div>
            </section>
            <section className="command-section fade-in">
                <div className="section-heading-row">
                    <div>
                        <span className="section-kicker">Sports channels</span>
                        <h3 className="section-title">Browse by sport</h3>
                    </div>
                </div>
                <div className="home-sport-grid">
                    {['Tennis', 'Basketball', 'Badminton', 'Football', 'Swimming', 'Rugby', 'Volleyball', 'Athletics', 'Horse Racing', 'Multi-sport', 'Running', 'Hiking', 'Cycling'].map((sport) => (
                        <button
                            key={sport}
                            type="button"
                            className="sport-tile interactive-card"
                            onClick={() => onNavigate({ page: 'explore', params: { sport } })}
                        >
                            <span className="sport-icon-shell" aria-hidden="true">
                                <i className={`fas fa-${getSportIcon(sport)} sport-icon`} aria-hidden="true"></i>
                            </span>
                            <span className="sport-name">{sport}</span>
                            <span className="sport-tile-caption">Open hub</span>
                        </button>
                    ))}
                </div>
            </section>
            <section className="command-section fade-in">
                <div className="section-heading-row">
                    <div>
                        <span className="section-kicker">Convert play into community</span>
                        <h3 className="section-title">Do not stop at one game</h3>
                    </div>
                </div>
                <div className="match-funnel-grid">
                    <button type="button" className="signal-card match-funnel-card surface-tier-2" onClick={() => onNavigate({ page: 'friendsRecurring', params: {} })}>
                        <span className="section-kicker">Recurring squads</span>
                        <h3>Keep a repeat squad</h3>
                        <p>Save the group that worked and restart faster next week.</p>
                    </button>
                    <button type="button" className="signal-card match-funnel-card surface-tier-2" onClick={() => onNavigate({ page: 'friendsHub', params: {} })}>
                        <span className="section-kicker">Community graph</span>
                        <h3>Build your player network</h3>
                        <p>Turn one strong session into trusted teammates and future invites.</p>
                    </button>
                </div>
            </section>
            <section className="command-section fade-in">
                <div className="section-heading-row">
                    <div>
                        <span className="section-kicker">Match network</span>
                        <h3 className="section-title">Upcoming matches</h3>
                    </div>
                </div>
                <div className="content-rail compact-card-rail">
                {upcomingMatches.map((match) => {
                    const venue = venueById[match.venueId];

                    return (
                        <button
                            key={match.id}
                            type="button"
                            className="booking-item tech-booking-item compact-booking-card interactive-card booking-item-button rail-card booking-board-card"
                            onClick={() => onNavigate({ page: 'matchDetail', params: { matchId: match.id } })}
                        >
                            <div className="booking-details booking-board-details">
                                <div className="booking-card-heading">
                                    <span className="section-kicker booking-card-kicker">{match.sport}</span>
                                    <h4>{venue?.name || 'Venue pending'}</h4>
                                </div>
                                <div className="booking-card-meta-grid">
                                    <p className="match-meta-line">{match.date} • {match.time}</p>
                                    <p className="match-meta-line">{venue?.location || 'Hong Kong'} • {match.skill}</p>
                                </div>
                            </div>
                            <div className="booking-card-side">
                                <span className={`status-badge status-${match.status}`}>
                                    {match.status.charAt(0).toUpperCase() + match.status.slice(1)}
                                </span>
                                <span className="booking-card-count">{match.participants.length}/{match.totalSlots} players</span>
                            </div>
                        </button>
                    );
                })}
                </div>
            </section>
        </div>
    );
};

export default HomePage;
