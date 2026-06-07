import React, { useEffect, useRef, useState } from 'react';
import { buildCompatibility, buildReliabilityScore } from '../../app/data/matchmaking';
import { getLanguageLabel, LANGUAGE_OPTIONS } from '../../app/utils/languagePreference';

const escapeAvatarSvgText = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const createDeterministicAvatar = (seed = 'player') => {
    const label = String(seed || 'player').trim() || 'player';
    const initials = label
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((segment) => segment[0]?.toUpperCase() || '')
        .join('') || label.slice(0, 2).toUpperCase();
    const safeLabel = escapeAvatarSvgText(label);
    const safeInitials = escapeAvatarSvgText(initials);
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="${safeLabel}">
            <defs>
                <linearGradient id="avatarGradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#0f4c81" />
                    <stop offset="52%" stop-color="#178a8a" />
                    <stop offset="100%" stop-color="#ffc94d" />
                </linearGradient>
            </defs>
            <rect width="160" height="160" rx="80" fill="url(#avatarGradient)" />
            <circle cx="122" cy="34" r="24" fill="#ffffff" fill-opacity="0.16" />
            <circle cx="38" cy="132" r="34" fill="#061321" fill-opacity="0.14" />
            <text x="80" y="96" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="52" font-weight="800" fill="#ffffff">${safeInitials}</text>
        </svg>`;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};
const resolveAvatar = (player = {}) => player?.avatar || createDeterministicAvatar(player?.handle || player?.name || player?.id || 'player');
const createClubMonogram = (name = 'Club') => String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment[0])
    .join('')
    .toUpperCase() || 'CL';
const escapeSvgText = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const createClubFallbackArtwork = (club = {}) => {
    const monogram = createClubMonogram(club.name || 'Club');
    const safeName = escapeSvgText(club.name || 'GoPlayHK Club');
    const safeSport = escapeSvgText((club.sport || 'Community').toUpperCase());
    const safeDistrict = escapeSvgText(club.district || 'Hong Kong');
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" role="img" aria-label="${safeName}">
            <defs>
                <linearGradient id="clubFallbackGradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#0f4c81" />
                    <stop offset="55%" stop-color="#178a8a" />
                    <stop offset="100%" stop-color="#ffc94d" />
                </linearGradient>
            </defs>
            <rect width="1200" height="720" rx="42" fill="url(#clubFallbackGradient)" />
            <circle cx="980" cy="130" r="170" fill="#ffffff" fill-opacity="0.14" />
            <circle cx="160" cy="590" r="220" fill="#061321" fill-opacity="0.12" />
            <rect x="86" y="92" width="180" height="180" rx="42" fill="#061321" fill-opacity="0.22" stroke="#ffffff" stroke-opacity="0.24" stroke-width="5" />
            <text x="176" y="206" text-anchor="middle" font-size="88" font-family="Segoe UI, sans-serif" font-weight="800" fill="#ffffff">${monogram}</text>
            <text x="92" y="372" font-size="42" font-family="Segoe UI, sans-serif" font-weight="700" letter-spacing="8" fill="#ffffff">${safeSport}</text>
            <text x="92" y="458" font-size="72" font-family="Segoe UI, sans-serif" font-weight="800" fill="#ffffff">${safeName}</text>
            <text x="92" y="516" font-size="34" font-family="Segoe UI, sans-serif" fill="#f7fbff">${safeDistrict}</text>
        </svg>`;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};
const handleClubImageError = (event, club) => {
    if (event.currentTarget.dataset.fallbackApplied === 'true') {
        return;
    }

    event.currentTarget.dataset.fallbackApplied = 'true';
    event.currentTarget.src = createClubFallbackArtwork(club);
};
export const PlayerProfilePage = ({
    playerId,
    onBack,
    onNavigate,
    state,
    socialState,
    onSaveProfile,
    onSendFriendRequest,
    dispatch,
    showToast,
    theme,
    themePreference,
    toggleTheme,
    applySystemTheme,
    auth,
    Header
}) => {
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState('');
    const [editAvailability, setEditAvailability] = useState('');
    const [editAvatar, setEditAvatar] = useState('');
    const fileInputRef = useRef(null);
    const accessibility = state.accessibility;
    const languagePreference = state.languagePreference || 'en';
    const liveUsers = socialState?.users || state.users;
    const liveCurrentUser = socialState?.currentUser || state.currentUser;
    const handleAccessibilityChange = (key) => (e) => {
        dispatch({ type: 'SET_ACCESSIBILITY', payload: { [key]: e.target.checked } });
    };
    const handleLanguageChange = (event) => {
        const nextLanguage = event.target.value;
        dispatch({ type: 'SET_LANGUAGE_PREFERENCE', payload: nextLanguage });
        showToast(`App language set to ${getLanguageLabel(nextLanguage)}.`);
    };
    const profileSettings = [
        {
            key: 'theme',
            label: 'Dark Mode Override',
            description: themePreference === 'system'
                ? `Following your device setting right now. Toggle this to lock ${theme === 'dark' ? 'light' : 'dark'} mode manually.`
                : 'Manual theme override is active. Use the system option below to go back to automatic device detection.',
            checked: theme === 'dark',
            onChange: toggleTheme
        },
        {
            key: 'largeFont',
            label: 'Large Font',
            description: 'Increase type sizing and breathing room across the interface.',
            checked: accessibility.largeFont,
            onChange: handleAccessibilityChange('largeFont')
        },
        {
            key: 'colorblind',
            label: 'Colorblind Mode',
            description: 'Strengthen contrast and reduce reliance on color-only cues.',
            checked: accessibility.colorblind,
            onChange: handleAccessibilityChange('colorblind')
        },
        {
            key: 'voicePrompts',
            label: 'Voice Prompts',
            description: 'Read key navigation and activity prompts aloud when available.',
            checked: accessibility.voicePrompts,
            onChange: handleAccessibilityChange('voicePrompts')
        }
    ];

    if (!playerId) {
        showToast('Error: Player ID missing');
        return <div className="page-content"><p>Loading error. Go back and try again.</p></div>;
    }

    const player = liveUsers[playerId] || state.users[playerId] || {
        name: 'Unknown',
        avatar: createDeterministicAvatar(playerId || 'unknown-player'),
        mmr: 0,
        matchesPlayed: 0,
        availability: 'N/A',
        friends: []
    };
    const isFriend = (liveCurrentUser.friends || []).includes(playerId);
    const isOwnProfile = liveCurrentUser.id === playerId;
    const recentMatches = state.matches.filter(m => m.participants.includes(playerId)).slice(0, 5);
    const venueById = state.venues.reduce((accumulator, venue) => ({
        ...accumulator,
        [venue.id]: venue
    }), {});
    const sharedSports = (player.sports || []).filter((sport) => (liveCurrentUser.sports || []).includes(sport));
    const compatibilityScore = buildCompatibility(liveCurrentUser, player, { matches: state.matches }).score;

    const handleAddFriend = () => {
        if (onSendFriendRequest) {
            onSendFriendRequest(playerId);
            return;
        }

        dispatch({ type: 'ADD_FRIEND', payload: { friendId: playerId } });
        showToast(`Added ${player.name} as friend!`);
    };

    const handleEdit = () => {
        setEditName(player.name);
        setEditAvailability(player.availability);
        setEditAvatar(resolveAvatar(player));
        setEditing(true);
    };

    const handleSaveEdit = () => {
        if (onSaveProfile) {
            onSaveProfile(playerId, { name: editName, availability: editAvailability, avatar: editAvatar || createDeterministicAvatar(editName || playerId) });
            setEditing(false);
            return;
        }

        dispatch({
            type: 'UPDATE_USER',
            payload: {
                id: playerId,
                updates: { name: editName, availability: editAvailability, avatar: editAvatar }
            }
        });
        setEditing(false);
        showToast('Profile updated!');
    };

    const handleAvatarUpload = (event) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                setEditAvatar(reader.result);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleSignOut = () => {
        auth.signOut();
        showToast("You've been signed out.");
    };

    return (
        <div className="page-content tech-page profile-page-shell">
            <Header
                title={player.name}
                onBack={onBack}
                actionIcon={isOwnProfile ? 'fa-sign-out-alt' : null}
                actionOnClick={isOwnProfile ? handleSignOut : null}
            />
            <div className="profile-header fade-in profile-hero-panel">
                <img
                    src={resolveAvatar(player)}
                    className="profile-picture"
                    alt={player.name}
                    onError={(e) => {
                        e.target.src = createDeterministicAvatar(player.name || playerId || 'player');
                    }}
                />
                <div className="profile-hero-copy">
                    <span className="section-kicker">Player identity</span>
                    <h2 className="text-lg font-semibold">{player.name}</h2>
                    <p className="text-sm">@{player.handle || 'player'}</p>
                    <p className="text-sm">{player.availability}</p>
                </div>
            </div>
            <div className="card">
                <h3 className="text-base font-semibold mb-2">Profile Details</h3>
                {editing ? (
                    <>
                        <div className="input-group">
                            <label>Name</label>
                            <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="input-field" />
                        </div>
                        <div className="input-group">
                            <label>Availability</label>
                            <input type="text" value={editAvailability} onChange={e => setEditAvailability(e.target.value)} className="input-field" />
                        </div>
                        <div className="input-group">
                            <label>Avatar URL</label>
                            <input type="text" value={editAvatar} onChange={e => setEditAvatar(e.target.value)} className="input-field" />
                        </div>
                        <div className="input-group">
                            <label>Replace profile picture</label>
                            <input ref={fileInputRef} type="file" accept="image/*" className="profile-file-input" onChange={handleAvatarUpload} />
                            <div className="profile-avatar-actions">
                                <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>Upload Image</button>
                                <button type="button" className="btn-secondary" onClick={() => setEditAvatar(createDeterministicAvatar(editName || playerId))}>Use Default Avatar</button>
                            </div>
                        </div>
                        <button className="btn-primary mt-4" onClick={handleSaveEdit}>Save</button>
                        <button className="btn-secondary mt-2" onClick={() => setEditing(false)}>Cancel</button>
                    </>
                ) : (
                    <>
                        <p className="text-sm"><strong>MMR:</strong> {player.mmr}</p>
                        <p className="text-sm"><strong>Matches Played:</strong> {player.matchesPlayed}</p>
                        <p className="text-sm"><strong>Availability:</strong> {player.availability}</p>
                        {isOwnProfile && <button className="btn-primary mt-4" onClick={handleEdit}>Edit Profile</button>}
                    </>
                )}
            </div>
            <div className="profile-stat-grid">
                <div className="profile-stat surface-tier-1 profile-stat-angled">
                    <span className="profile-stat-kicker">Skill</span>
                    <span className="profile-stat-value">{player.mmr}</span>
                    <span className="profile-stat-label">MMR</span>
                </div>
                <div className="profile-stat surface-tier-1 profile-stat-angled">
                    <span className="profile-stat-kicker">History</span>
                    <span className="profile-stat-value">{player.matchesPlayed}</span>
                    <span className="profile-stat-label">Matches</span>
                </div>
                <button type="button" className="profile-stat surface-tier-1 profile-stat-clickable profile-stat-angled" onClick={() => isOwnProfile && onNavigate({ page: 'friendsHub', params: {} })}>
                    <span className="profile-stat-kicker">Network</span>
                    <span className="profile-stat-value">{player.friends ? player.friends.length : 0}</span>
                    <span className="profile-stat-label">Friends</span>
                </button>
            </div>
            <div className="card mt-4">
                <h3 className="text-base font-semibold mb-2">Match Trust Signals</h3>
                <div className="signal-badge-row">
                    <span className="signal-badge"><i className="fas fa-shield-heart"></i>{buildReliabilityScore(player)} reliability</span>
                    <span className="signal-badge"><i className="fas fa-heart-pulse"></i>{compatibilityScore}% fit</span>
                    <span className="signal-badge"><i className="fas fa-location-dot"></i>{player.district || 'District open'}</span>
                </div>
                <p className="text-sm top-gap-md"><strong>Shared sports:</strong> {sharedSports.length ? sharedSports.join(', ') : 'None listed yet'}</p>
                <p className="text-sm"><strong>Preferred style:</strong> {player.playStyle || 'Balanced'}</p>
                {!isOwnProfile && (
                    <button className="btn-secondary mt-4" onClick={() => onNavigate({ page: 'createMatch', params: { presetPlayers: [playerId] } })}>
                        Start Session Together
                    </button>
                )}
            </div>
            {isOwnProfile && <button className="btn-secondary mt-4" onClick={() => onNavigate({ page: 'friendsHub', params: {} })}>Open Friends Hub</button>}
            {!isFriend && !isOwnProfile && (
                <button className="btn-primary mt-4" onClick={handleAddFriend}>
                    Send Friend Request
                </button>
            )}
            <div className="card mt-4">
                <h3 className="text-base font-semibold mb-2">Friends</h3>
                <div className="panel-stack">
                    {(player.friends || []).map(fId => {
                        const friend = liveUsers[fId] || state.users[fId];

                        return friend ? (
                            <button type="button" key={fId} className="signal-card friend-signal-card interactive-card" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: fId } })}>
                                <img
                                    src={resolveAvatar(friend)}
                                    className="friend-signal-avatar"
                                    alt={friend.name}
                                    onError={(event) => {
                                        event.currentTarget.src = createDeterministicAvatar(friend.handle || friend.name || fId || 'player');
                                    }}
                                />
                                <div className="signal-card-copy">
                                    <h4>{friend.name}</h4>
                                    <p>{friend.availability}</p>
                                </div>
                                <span className="presence-pill">{friend.liveStatus || 'Connected'}</span>
                            </button>
                        ) : null;
                    })}
                </div>
            </div>
            <div className="card mt-4">
                <h3 className="text-base font-semibold mb-2">Recent Matches</h3>
                {recentMatches.length === 0 ? (
                    <p className="text-sm text-gray-500">No recent matches.</p>
                ) : (
                    recentMatches.map(match => {
                        const venue = venueById[match.venueId];

                        return (
                            <button type="button" key={match.id} className="booking-item interactive-card booking-item-button booking-board-card recent-match-card" onClick={() => onNavigate({ page: 'matchDetail', params: { matchId: match.id } })}>
                                <div className="booking-details booking-board-details">
                                    <div className="booking-card-heading">
                                        <span className="section-kicker booking-card-kicker">{match.sport}</span>
                                        <h4>{venue?.name || 'Venue pending'}</h4>
                                    </div>
                                    <div className="booking-card-meta-grid">
                                        <p className="match-meta-line">{match.date} • {match.time}</p>
                                        <p className="match-meta-line">{venue?.location || 'Hong Kong'} • {match.participants.length}/{match.totalSlots} players</p>
                                    </div>
                                </div>
                                <div className="booking-card-side">
                                    <span className={`status-badge status-${match.status}`}>{match.status.charAt(0).toUpperCase() + match.status.slice(1)}</span>
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
            {isOwnProfile && (
                <div className="card mt-4 profile-settings-card">
                    <h3 className="text-base font-semibold mb-2">Settings</h3>
                    <div className="profile-settings-list">
                        {profileSettings.map((setting) => (
                            <div key={setting.key} className="profile-setting-row">
                                <div className="profile-setting-copy">
                                    <span className="profile-setting-label">{setting.label}</span>
                                    <p className="profile-setting-description">{setting.description}</p>
                                </div>
                                <label className="switch">
                                    <input type="checkbox" checked={setting.checked} onChange={setting.onChange} />
                                    <span className="slider"></span>
                                </label>
                            </div>
                        ))}
                    </div>
                    <div className="profile-language-panel">
                        <div className="profile-setting-copy">
                            <span className="profile-setting-label">App Language</span>
                            <p className="profile-setting-description">Translate the interface with Google Translate.</p>
                        </div>
                        <label className="profile-language-selector">
                            <span className="profile-language-selector-label">Language</span>
                            <select className="input-field" value={languagePreference} onChange={handleLanguageChange}>
                                {LANGUAGE_OPTIONS.map((option) => (
                                    <option key={option.code} value={option.code}>{option.label}</option>
                                ))}
                            </select>
                        </label>
                        <p className="profile-language-note">Current selection: {getLanguageLabel(languagePreference)}. Dynamic content may take a moment to refresh after switching.</p>
                    </div>
                    <button
                        type="button"
                        className={`btn-secondary w-full mt-4 profile-theme-system-button ${themePreference === 'system' ? 'is-active' : ''}`}
                        onClick={applySystemTheme}
                        disabled={themePreference === 'system'}
                    >
                        {themePreference === 'system' ? `Following system theme (${theme})` : 'Follow system theme'}
                    </button>
                </div>
            )}
            {isOwnProfile && (
                <button
                    className="btn-secondary w-full mt-2"
                    onClick={() => {
                        localStorage.removeItem('hasSeenQuickGuide');
                        showToast('Quick Guide will appear on next login!');
                    }}
                >
                    Show Quick Guide Again
                </button>
            )}
        </div>
    );
};

export const NotificationsPage = ({ state, dispatch, onBack, onNavigate, Header }) => {
    useEffect(() => {
        dispatch({ type: 'MARK_NOTIFICATIONS_READ' });
    }, [dispatch]);

    const handleNotificationClick = (n) => {
        dispatch({ type: 'MARK_NOTIFICATION_READ', payload: { id: n.id } });

        if (n.type === 'match_join' && n.matchId) {
            onNavigate({ page: 'matchDetail', params: { matchId: n.matchId } });
            return;
        }

        if (n.type === 'venue_new' && n.venueId) {
            onNavigate({ page: 'venueDetail', params: { venueId: n.venueId } });
            return;
        }

        alert(n.text);
    };

    return (
        <div className="page-content tech-page notifications-page-shell">
            <Header title="Notifications" onBack={onBack} onNavigate={onNavigate} hideNotifications />
            <section className="hero-panel notifications-hero-panel fade-in">
                <span className="section-kicker">Activity feed</span>
                <h2 className="section-title">Signals from your sports network</h2>
                <p>Stay on top of joins, venue updates, and system prompts that affect your next session.</p>
            </section>
            <ul className="notification-list fade-in">
                {state.notifications.length === 0 ? (
                    <p className="text-sm text-gray-500 p-4">No notifications.</p>
                ) : (
                    state.notifications.map(n => (
                        <li key={n.id}>
                            <button type="button" className={`notification-item tech-notification-item interactive-card ${n.read ? '' : 'unread'}`} onClick={() => handleNotificationClick(n)}>
                                <div className="notification-copy">
                                    <span className="signal-badge notification-type-badge">{n.type === 'match_join' ? 'Match' : 'Venue'}</span>
                                    <p className="text-sm">{n.text}</p>
                                </div>
                                <span className="text-xs text-gray-500">{n.time}</span>
                            </button>
                        </li>
                    ))
                )}
            </ul>
        </div>
    );
};

const buildRewardsSummary = (state) => {
    const completedMatches = state.matches.filter(match => match.status === 'completed' || match.result).length;
    const totalPoints = state.currentUser.matchesPlayed * 35 + state.currentUser.friends.length * 20 + completedMatches * 40;
    const nextTierTarget = 1200;
    const progress = Math.min(100, Math.round((totalPoints / nextTierTarget) * 100));
    const rewardTracks = [
        { title: 'Match Streak', value: `${Math.max(2, completedMatches)} sessions`, detail: 'Weekly activity bonus.', icon: 'fa-fire' },
        { title: 'Community Builder', value: `${state.currentUser.friends.length} friends`, detail: 'Squad growth progress.', icon: 'fa-user-group' },
        { title: 'Venue Explorer', value: `${new Set(state.matches.map(match => match.venueId)).size} venues`, detail: 'District badge progress.', icon: 'fa-location-dot' }
    ];

    return { totalPoints, progress, rewardTracks };
};

const RewardsSection = ({ state, onNavigate }) => {
    const { totalPoints, progress, rewardTracks } = buildRewardsSummary(state);

    return (
        <>
            <section className="hero-panel rewards-hero-panel fade-in surface-tier-3">
                <span className="section-kicker">Player progression</span>
                <h2 className="section-title">Turn activity into rewards and status</h2>
                <p>Track momentum, streaks, and venue progress across the city circuit.</p>
                <div className="signal-badge-row mt-3">
                    <span className="signal-badge"><i className="fas fa-bolt"></i>{totalPoints} momentum points</span>
                    <span className="signal-badge"><i className="fas fa-crown"></i>{progress}% to next tier</span>
                </div>
            </section>
            <section className="card rewards-progress-panel surface-tier-2 fade-in">
                <div className="section-heading-row compact-heading-row">
                    <div>
                        <span className="section-kicker">Tier progress</span>
                        <h3 className="section-title">City Circuit Level</h3>
                    </div>
                </div>
                <div className="rewards-progress-track">
                    <div className="rewards-progress-fill" style={{ width: `${progress}%` }}></div>
                </div>
                <p className="route-summary-line">Progress toward your next tier.</p>
            </section>
            <section className="rewards-grid fade-in">
                {rewardTracks.map((track) => (
                    <div key={track.title} className="signal-card rewards-card surface-tier-1">
                        <span className="metric-icon"><i className={`fas ${track.icon}`}></i></span>
                        <h3>{track.title}</h3>
                        <p className="rewards-card-value">{track.value}</p>
                        <p>{track.detail}</p>
                    </div>
                ))}
            </section>
            <section className="card rewards-cta-panel surface-tier-2 fade-in">
                <div>
                    <span className="section-kicker">Best next move</span>
                    <h3 className="section-title">Book another session to grow your streak</h3>
                </div>
                <button className="btn-primary" onClick={() => onNavigate({ page: 'booking', params: {} })}>Open Bookings</button>
            </section>
        </>
    );
};

const ClubsSection = ({ state, dispatch, onNavigate, showToast }) => {
    const joinedClubIds = new Set(state.currentUser.joinedClubIds || []);
    const featuredClubs = state.clubs || [];
    const totalUpcomingSessions = featuredClubs.reduce((total, club) => total + (club.upcomingSessions?.length || 0), 0);

    const handleJoinClub = (club) => {
        if (joinedClubIds.has(club.id)) {
            showToast(`${club.name} is already in your club circuit.`);
            return;
        }

        dispatch({ type: 'JOIN_CLUB', payload: { clubId: club.id } });
        showToast(`Joined ${club.name}.`);
    };

    return (
        <>
            <section className="hero-panel clubs-hero-panel fade-in surface-tier-3">
                <span className="section-kicker">Club circuit</span>
                <h2 className="section-title">Move from one-off sessions into real club rhythm</h2>
                <p>Find running crews, badminton ladders, tennis nights, football squads, and basketball communities built for repeat play.</p>
                <div className="signal-badge-row mt-3">
                    <span className="signal-badge"><i className="fas fa-people-group"></i>{featuredClubs.length} live clubs</span>
                    <span className="signal-badge"><i className="fas fa-stopwatch"></i>{totalUpcomingSessions} upcoming sessions</span>
                    <span className="signal-badge"><i className="fas fa-medal"></i>{joinedClubIds.size} joined</span>
                </div>
            </section>
            <section className="card clubs-summary-panel surface-tier-2 fade-in">
                <div className="clubs-summary-list">
                    <div className="booking-board-card clubs-summary-metric surface-tier-1">
                        <div className="booking-details booking-board-details">
                            <div className="booking-card-heading">
                                <span className="section-kicker booking-card-kicker">Club Summary</span>
                                <h4>Joined clubs</h4>
                            </div>
                            <div className="booking-card-meta-grid">
                                <p className="match-meta-line">Your active training communities across the city.</p>
                            </div>
                        </div>
                        <div className="booking-card-side clubs-summary-side">
                            <strong className="clubs-summary-value">{joinedClubIds.size}</strong>
                            <span className="clubs-summary-caption">Active</span>
                        </div>
                    </div>
                    <div className="booking-board-card clubs-summary-metric surface-tier-1">
                        <div className="booking-details booking-board-details">
                            <div className="booking-card-heading">
                                <span className="section-kicker booking-card-kicker">Club Summary</span>
                                <h4>Sport mix</h4>
                            </div>
                            <div className="booking-card-meta-grid">
                                <p className="match-meta-line">Running, racket, team, and open-run formats.</p>
                            </div>
                        </div>
                        <div className="booking-card-side clubs-summary-side">
                            <strong className="clubs-summary-value">{new Set(featuredClubs.map((club) => club.sport)).size}</strong>
                            <span className="clubs-summary-caption">Sports</span>
                        </div>
                    </div>
                    <div className="booking-board-card clubs-summary-metric surface-tier-1">
                        <div className="booking-details booking-board-details">
                            <div className="booking-card-heading">
                                <span className="section-kicker booking-card-kicker">Club Summary</span>
                                <h4>Next wave</h4>
                            </div>
                            <div className="booking-card-meta-grid">
                                <p className="match-meta-line">Fresh sessions landing across club calendars.</p>
                            </div>
                        </div>
                        <div className="booking-card-side clubs-summary-side clubs-summary-side-date">
                            <strong className="clubs-summary-value clubs-summary-value-date">{featuredClubs[0]?.upcomingSessions?.[0]?.date || 'This week'}</strong>
                            <span className="clubs-summary-caption">Next</span>
                        </div>
                    </div>
                </div>
            </section>
            <section className="clubs-list fade-in">
                {featuredClubs.map((club) => {
                    const isJoined = joinedClubIds.has(club.id);
                    const clubImage = club.heroImage || createClubFallbackArtwork(club);
                    return (
                        <article key={club.id} className="clubs-preview-stack">
                            <section className="hero-panel club-detail-hero surface-tier-3">
                                <div className="club-detail-media">
                                    <img src={clubImage} alt={club.name} className="club-detail-image" loading="lazy" onError={(event) => handleClubImageError(event, club)} />
                                </div>
                                <div className="club-detail-copy">
                                    <span className="section-kicker">{club.sport} club • {club.district}</span>
                                    <h2 className="section-title">{club.name}</h2>
                                    <p>{club.description}</p>
                                    <div className="signal-badge-row mt-3">
                                        <span className="signal-badge"><i className="fas fa-users"></i>{club.memberIds.length} members</span>
                                        {club.tags.map((tag) => <span key={tag} className="signal-badge">{tag}</span>)}
                                    </div>
                                </div>
                            </section>
                            <section className="card club-detail-panel surface-tier-2 clubs-preview-panel">
                                <p className="clubs-requirements"><strong>Join requirements:</strong> {club.requirements}</p>
                                <div className="friends-card-actions clubs-card-actions">
                                    <button className="btn-primary" onClick={() => handleJoinClub(club)} disabled={isJoined}>
                                        {isJoined ? 'Joined Club' : 'Join Club'}
                                    </button>
                                    <button className="btn-secondary" onClick={() => onNavigate({ page: 'clubDetail', params: { clubId: club.id } })}>
                                        View Details
                                    </button>
                                </div>
                            </section>
                        </article>
                    );
                })}
            </section>
        </>
    );
};

export const ClubsPage = ({ state, dispatch, initialTab = 'clubs', onBack, onNavigate, showToast = () => {}, Header }) => {
    const [activeTab, setActiveTab] = useState(initialTab === 'rewards' ? 'rewards' : 'clubs');

    useEffect(() => {
        setActiveTab(initialTab === 'rewards' ? 'rewards' : 'clubs');
    }, [initialTab]);

    return (
        <div className="page-content tech-page clubs-page-shell rewards-page-shell">
            <Header title="Clubs" onBack={onBack} onNavigate={onNavigate} />
            <section className="clubs-tab-bar fade-in surface-tier-2">
                <button className={`clubs-tab-pill ${activeTab === 'clubs' ? 'active' : ''}`} onClick={() => setActiveTab('clubs')}>Clubs</button>
                <button className={`clubs-tab-pill ${activeTab === 'rewards' ? 'active' : ''}`} onClick={() => setActiveTab('rewards')}>Rewards</button>
            </section>
            {activeTab === 'clubs'
                ? <ClubsSection state={state} dispatch={dispatch} onNavigate={onNavigate} showToast={showToast} />
                : <RewardsSection state={state} onNavigate={onNavigate} />}
        </div>
    );
};

export const ClubDetailPage = ({ state, dispatch, clubId, onBack, onNavigate, showToast = () => {}, Header }) => {
    const club = (state.clubs || []).find((entry) => entry.id === clubId);
    const joinedClubIds = new Set(state.currentUser.joinedClubIds || []);

    if (!clubId || !club) {
        return <div className="page-content tech-page"><p>Club not found.</p></div>;
    }

    const isJoined = joinedClubIds.has(club.id);
    const clubImage = club.heroImage || createClubFallbackArtwork(club);
    const handleJoinClub = () => {
        if (isJoined) {
            showToast(`${club.name} is already in your club circuit.`);
            return;
        }

        dispatch({ type: 'JOIN_CLUB', payload: { clubId: club.id } });
        showToast(`Joined ${club.name}.`);
    };

    return (
        <div className="page-content tech-page club-detail-page-shell">
            <Header title={club.name} onBack={onBack} onNavigate={onNavigate} />
            <section className="hero-panel club-detail-hero fade-in surface-tier-3">
                <div className="club-detail-media">
                    <img src={clubImage} alt={club.name} className="club-detail-image" onError={(event) => handleClubImageError(event, club)} />
                </div>
                <div className="club-detail-copy">
                    <span className="section-kicker">{club.sport} club • {club.district}</span>
                    <h2 className="section-title">{club.name}</h2>
                    <p>{club.description}</p>
                    <div className="signal-badge-row mt-3">
                        <span className="signal-badge"><i className="fas fa-users"></i>{club.memberIds.length} members</span>
                        {club.tags.map((tag) => <span key={tag} className="signal-badge">{tag}</span>)}
                    </div>
                </div>
            </section>
            <section className="card club-detail-panel surface-tier-2 fade-in">
                <div className="section-heading-row compact-heading-row">
                    <div>
                        <span className="section-kicker">Entry standard</span>
                        <h3 className="section-title">Join requirements and fit</h3>
                    </div>
                </div>
                <p>{club.requirements}</p>
                <div className="friends-card-actions clubs-card-actions top-gap-md">
                    <button className="btn-primary" onClick={handleJoinClub} disabled={isJoined}>{isJoined ? 'Joined Club' : 'Join Club'}</button>
                    <button className="btn-secondary" onClick={() => onNavigate({ page: 'clubs', params: {} })}>Back to Clubs</button>
                </div>
            </section>
            <section className="card club-detail-panel surface-tier-2 fade-in">
                <div className="section-heading-row compact-heading-row">
                    <div>
                        <span className="section-kicker">Upcoming calendar</span>
                        <h3 className="section-title">Sessions and events</h3>
                    </div>
                </div>
                <div className="clubs-session-list">
                    {(club.upcomingSessions || []).map((session) => (
                        <div key={session.id} className="clubs-session-item surface-tier-1">
                            <div>
                                <strong>{session.title}</strong>
                                <p>{session.date} • {session.time} • {session.venue}</p>
                            </div>
                            <span className="signal-badge"><i className="fas fa-ticket"></i>{session.spotsLeft} spots left</span>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
};

export const RewardsPage = ({ state, dispatch, initialTab = 'rewards', onBack, onNavigate, Header }) => (
    <ClubsPage state={state} dispatch={dispatch} initialTab={initialTab} onBack={onBack} onNavigate={onNavigate} Header={Header} />
);