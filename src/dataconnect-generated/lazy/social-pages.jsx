import React, { useState } from 'react';
import { buildCompatibility, buildReliabilityScore } from '../../app/data/matchmaking';

const escapeSvgText = (value = '') => String(value)
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
    const safeLabel = escapeSvgText(label);
    const safeInitials = escapeSvgText(initials);
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
const resolveAvatar = (user = {}) => user?.avatar || createDeterministicAvatar(user?.handle || user?.name || user?.id || 'player');
const resolveDiceBearAvatar = (user = {}) => {
    const seed = user?.handle || user?.name || user?.id || 'player';
    return `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf&mouth=smile01,smile02,smile03`;
};
const handleAvatarError = (event, user = {}) => {
    event.currentTarget.src = createDeterministicAvatar(user?.handle || user?.name || user?.id || 'player');
};

const resolveSocialState = (state, socialState) => {
    const socialUsers = socialState?.users && Object.keys(socialState.users).length > 0 ? socialState.users : state.users;
    const socialCurrentUser = socialState?.currentUser?.id ? socialState.currentUser : state.currentUser;
    const socialFriendRequests = Array.isArray(socialState?.friendRequests) ? socialState.friendRequests : state.friendRequests;

    return {
        currentUser: socialCurrentUser,
        users: socialUsers,
        friendRequests: socialFriendRequests
    };
};

const getPresenceLabel = (user) => user?.liveStatus === 'Online' ? 'Online' : 'Offline';

export const FriendsHubPage = ({ state, socialState, onBack, onNavigate, Header }) => {
    const liveState = resolveSocialState(state, socialState);
    const squad = (liveState.currentUser.friends || []).map(friendId => liveState.users[friendId]).filter(Boolean);
    const incomingRequests = liveState.friendRequests.filter(request => request.toUserId === liveState.currentUser.id && request.status === 'pending');
    const outgoingRequests = liveState.friendRequests.filter(request => request.fromUserId === liveState.currentUser.id && request.status === 'pending');
    const recommendations = Object.values(liveState.users).filter(user => user.id !== liveState.currentUser.id && !(liveState.currentUser.friends || []).includes(user.id)).slice(0, 3);
    const upcomingWithFriends = state.matches.filter(match => match.status === 'upcoming' && match.participants.some(participantId => (liveState.currentUser.friends || []).includes(participantId)));
    const panels = [
        { page: 'friendsSquad', kicker: 'Squad board', title: 'Manage your core players', detail: `${squad.length} connected teammates.`, icon: 'fa-user-group' },
        { page: 'friendsDiscover', kicker: 'Discovery', title: 'Find new players nearby', detail: `${recommendations.length} suggested profiles.`, icon: 'fa-compass' },
        { page: 'friendsInvites', kicker: 'Invites', title: 'Process pending requests', detail: `${incomingRequests.length} in • ${outgoingRequests.length} out.`, icon: 'fa-envelope-open-text' },
        { page: 'friendsRecurring', kicker: 'Recurring squads', title: 'Save regular teams', detail: `${state.recurringSquads.length} repeat squads.`, icon: 'fa-people-group' }
    ];

    return (
        <div className="page-content tech-page friends-page-shell">
            <Header title="Friends" onBack={onBack} onNavigate={onNavigate} />
            <section className="hero-panel friends-hero-panel fade-in surface-tier-3">
                <span className="section-kicker">Community graph</span>
                <h2 className="section-title">Run your sports circle like a real network</h2>
                <p>Manage your squad, invites, and repeat groups here.</p>
                <div className="signal-badge-row mt-3">
                    <span className="signal-badge"><i className="fas fa-user-group"></i>{squad.length} active friends</span>
                    <span className="signal-badge"><i className="fas fa-envelope"></i>{incomingRequests.length} pending invites</span>
                    <span className="signal-badge"><i className="fas fa-calendar-check"></i>{upcomingWithFriends.length} sessions with friends</span>
                </div>
            </section>
            <section className="friends-nav-grid fade-in">
                {panels.map(panel => (
                    <button key={panel.page} className="signal-card friends-nav-card surface-tier-2" onClick={() => onNavigate({ page: panel.page, params: {} })}>
                        <span className="metric-icon"><i className={`fas ${panel.icon}`}></i></span>
                        <span className="section-kicker">{panel.kicker}</span>
                        <h3>{panel.title}</h3>
                        <p>{panel.detail}</p>
                    </button>
                ))}
            </section>
            <section className="card friends-overview-panel surface-tier-2 fade-in">
                <div className="section-heading-row compact-heading-row">
                    <div>
                        <span className="section-kicker">Live squad preview</span>
                        <h3 className="section-title">Who you can coordinate with right now</h3>
                    </div>
                </div>
                <div className="panel-stack">
                    {squad.slice(0, 3).map(friend => (
                        <button
                            key={friend.id}
                            type="button"
                            className="signal-card friend-signal-card friend-preview-button surface-tier-1"
                            onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: friend.id } })}
                        >
                            <img src={resolveAvatar(friend)} className="friend-signal-avatar" alt={friend.name} onError={(event) => handleAvatarError(event, friend)} />
                            <div className="signal-card-copy">
                                <h4>{friend.name}</h4>
                                <p>{friend.availability}</p>
                            </div>
                            <span className="presence-pill">{getPresenceLabel(friend)}</span>
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
};

export const FriendsSquadPage = ({ state, socialState, onBack, onNavigate, Header }) => {
    const liveState = resolveSocialState(state, socialState);
    const squad = (liveState.currentUser.friends || []).map(friendId => liveState.users[friendId]).filter(Boolean);
    const matchesWithFriends = state.matches.filter(match => match.participants.includes(liveState.currentUser.id) && match.participants.some(participantId => (liveState.currentUser.friends || []).includes(participantId)));

    return (
        <div className="page-content tech-page friends-page-shell">
            <Header title="My Squad" onBack={onBack} onNavigate={onNavigate} />
            <section className="hero-panel friends-subpage-hero fade-in surface-tier-3">
                <span className="section-kicker">Squad board</span>
                <h2 className="section-title">Keep your most reliable players close</h2>
                <p>Jump into profiles, start a session with a preset squadmate, and track which matches already include friends.</p>
            </section>
            <section className="panel-stack fade-in">
                {squad.map(friend => (
                    <div key={friend.id} className="card friends-member-card surface-tier-2">
                        <button type="button" className="friends-member-main interactive-card" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: friend.id } })}>
                            <img src={resolveAvatar(friend)} className="friend-signal-avatar large-avatar" alt={friend.name} onError={(event) => handleAvatarError(event, friend)} />
                            <div className="signal-card-copy">
                                <h4>{friend.name}</h4>
                                <p>{friend.availability}</p>
                                <div className="signal-badge-row">
                                    <span className="signal-badge"><i className="fas fa-chart-line"></i>{friend.mmr} MMR</span>
                                    <span className="signal-badge"><i className="fas fa-medal"></i>{friend.matchesPlayed} matches</span>
                                </div>
                            </div>
                        </button>
                        <div className="friends-card-actions">
                            <button className="btn-secondary" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: friend.id } })}>Open Profile</button>
                            <button className="btn-primary" onClick={() => onNavigate({ page: 'createMatch', params: { presetPlayers: [friend.id] } })}>Start Session</button>
                        </div>
                    </div>
                ))}
            </section>
            <button className="btn-secondary w-full mt-4" onClick={() => onNavigate({ page: 'friendsRecurring', params: {} })}>Open Recurring Squads</button>
            <section className="card friends-overview-panel surface-tier-2 fade-in">
                <div className="section-heading-row compact-heading-row">
                    <div>
                        <span className="section-kicker">Shared schedule</span>
                        <h3 className="section-title">Upcoming sessions with friends</h3>
                    </div>
                </div>
                {matchesWithFriends.length === 0 ? (
                    <div className="friends-empty-state surface-tier-1">
                        <h4>No shared sessions yet</h4>
                        <p>Use Start Session on a squadmate card to spin up a match with a pre-filled roster.</p>
                    </div>
                ) : (
                    matchesWithFriends.map(match => (
                        <button type="button" key={match.id} className="booking-item tech-booking-item surface-tier-1 interactive-card booking-item-button" onClick={() => onNavigate({ page: 'matchDetail', params: { matchId: match.id } })}>
                            <div className="booking-details">
                                <h4>{match.sport} • {match.date}</h4>
                                <p>{match.participants.filter(participantId => (liveState.currentUser.friends || []).includes(participantId)).length} friends in this session</p>
                            </div>
                            <span className="presence-pill">Live roster</span>
                        </button>
                    ))
                )}
            </section>
        </div>
    );
};

export const FriendsRecurringPage = ({ state, socialState, dispatch, onBack, onNavigate, showToast, Header }) => {
    const liveState = resolveSocialState(state, socialState);
    const squadMates = (liveState.currentUser.friends || []).map(friendId => liveState.users[friendId]).filter(Boolean);
    const recurringSquads = state.recurringSquads.filter(squad => squad.ownerId === liveState.currentUser.id);
    const [squadName, setSquadName] = useState('');
    const [cadence, setCadence] = useState('Weekly');
    const [selectedMemberIds, setSelectedMemberIds] = useState([]);

    const toggleMember = (friendId) => {
        setSelectedMemberIds(current => current.includes(friendId) ? current.filter(id => id !== friendId) : [...current, friendId]);
    };

    const handleCreateRecurringSquad = () => {
        if (!squadName.trim() || selectedMemberIds.length === 0) {
            showToast('Add a squad name and at least one squadmate.');
            return;
        }

        dispatch({
            type: 'CREATE_RECURRING_SQUAD',
            payload: {
                name: squadName.trim(),
                cadence,
                memberIds: selectedMemberIds
            }
        });
        setSquadName('');
        setCadence('Weekly');
        setSelectedMemberIds([]);
        showToast('Recurring squad created.');
    };

    return (
        <div className="page-content tech-page friends-page-shell">
            <Header title="Recurring Squads" onBack={onBack} onNavigate={onNavigate} />
            <section className="hero-panel friends-subpage-hero fade-in surface-tier-3">
                <span className="section-kicker">Repeat coordination</span>
                <h2 className="section-title">Save your regular teams and relaunch them fast</h2>
                <p>Keep repeat groups ready for one-tap match setup.</p>
            </section>
            <section className="card friends-overview-panel surface-tier-2 fade-in">
                <div className="section-heading-row compact-heading-row">
                    <div>
                        <span className="section-kicker">Create squad</span>
                        <h3 className="section-title">Build a recurring lineup</h3>
                    </div>
                </div>
                <div className="input-group">
                    <label>Squad Name</label>
                    <input className="input-field" value={squadName} onChange={e => setSquadName(e.target.value)} placeholder="e.g. Harbour Tuesday Crew" />
                </div>
                <div className="input-group">
                    <label>Cadence</label>
                    <select className="input-field" value={cadence} onChange={e => setCadence(e.target.value)}>
                        <option value="Weekly">Weekly</option>
                        <option value="Biweekly">Biweekly</option>
                        <option value="Monthly">Monthly</option>
                    </select>
                </div>
                <div className="recurring-squad-selector">
                    {squadMates.map(friend => (
                        <button key={friend.id} className={`map-venue-chip ${selectedMemberIds.includes(friend.id) ? 'active' : ''}`} onClick={() => toggleMember(friend.id)}>
                            {friend.name}
                        </button>
                    ))}
                </div>
                <button className="btn-primary mt-4" onClick={handleCreateRecurringSquad}>Save Recurring Squad</button>
            </section>
            <section className="panel-stack fade-in">
                {recurringSquads.length === 0 ? (
                    <div className="friends-empty-state surface-tier-1">
                        <h4>No recurring squads yet</h4>
                        <p>Save a regular lineup here so you can relaunch the same group without rebuilding the roster each time.</p>
                    </div>
                ) : (
                    recurringSquads.map(squad => (
                        <div key={squad.id} className="card friends-member-card surface-tier-2">
                            <div className="signal-card-copy">
                                <span className="section-kicker">{squad.cadence}</span>
                                <h4>{squad.name}</h4>
                                <p>{squad.memberIds.map(memberId => liveState.users[memberId]?.name).filter(Boolean).join(', ')}</p>
                            </div>
                            <div className="friends-card-actions">
                                <button className="btn-secondary" onClick={() => onNavigate({ page: 'friendsSquad', params: {} })}>View Squad</button>
                                <button className="btn-primary" onClick={() => onNavigate({ page: 'createMatch', params: { presetPlayers: squad.memberIds } })}>Launch Session</button>
                            </div>
                        </div>
                    ))
                )}
            </section>
        </div>
    );
};

export const FriendsDiscoverPage = ({ state, socialState, onSendFriendRequest, dispatch, onBack, onNavigate, showToast, Header }) => {
    const liveState = resolveSocialState(state, socialState);
    const pendingRequestUserIds = new Set(liveState.friendRequests
        .filter(request => request.status === 'pending' && (request.fromUserId === liveState.currentUser.id || request.toUserId === liveState.currentUser.id))
        .flatMap(request => [request.fromUserId, request.toUserId]));
    const recommendations = Object.values(liveState.users).filter(user =>
        user.id !== liveState.currentUser.id &&
        !(liveState.currentUser.friends || []).includes(user.id) &&
        !pendingRequestUserIds.has(user.id)
    ).map((user) => {
        const fit = buildCompatibility(liveState.currentUser, user, { matches: state.matches });

        return {
            user,
            fit: {
                fitScore: fit.score,
                reasons: fit.reasons
            }
        };
    }).sort((firstEntry, secondEntry) => secondEntry.fit.fitScore - firstEntry.fit.fitScore);
    const featuredRecommendation = recommendations[0] || null;

    const handleInvite = (userId) => {
        if (onSendFriendRequest) {
            onSendFriendRequest(userId);
            return;
        }

        dispatch({
            type: 'SEND_FRIEND_REQUEST',
            payload: {
                fromUserId: liveState.currentUser.id,
                toUserId: userId,
                message: 'Want to connect and play sometime?'
            }
        });
        showToast('Friend invite sent.');
    };

    return (
        <div className="page-content tech-page friends-page-shell">
            <Header title="Discover Players" onBack={onBack} onNavigate={onNavigate} />
            <section className="friends-discover-hero-grid fade-in">
                <div className="hero-panel friends-subpage-hero surface-tier-3">
                    <span className="section-kicker">Discovery</span>
                    <h2 className="section-title">Find the right players fast</h2>
                    <p>Best-fit players first, then quick invites or a direct session start.</p>
                    <div className="signal-badge-row top-gap-sm">
                        <span className="signal-badge"><i className="fas fa-heart-pulse"></i>{recommendations.length} available fits</span>
                        <span className="signal-badge"><i className="fas fa-location-dot"></i>{liveState.currentUser.district || 'Hong Kong'}</span>
                    </div>
                </div>
                {featuredRecommendation ? (
                    <div className="friends-discover-spotlight surface-tier-2">
                        <span className="section-kicker">Top fit</span>
                        <div className="friends-discover-spotlight-head">
                            <img src={resolveDiceBearAvatar(featuredRecommendation.user)} className="friend-signal-avatar friends-spotlight-avatar" alt={featuredRecommendation.user.name} onError={(event) => handleAvatarError(event, featuredRecommendation.user)} />
                            <div>
                                <h3>{featuredRecommendation.user.name}</h3>
                                <p>{featuredRecommendation.fit.fitScore}% fit • {buildReliabilityScore(featuredRecommendation.user)} reliability</p>
                            </div>
                        </div>
                        <div className="friends-fit-meter" aria-hidden="true">
                            <span style={{ width: `${featuredRecommendation.fit.fitScore}%` }}></span>
                        </div>
                        <div className="signal-badge-row">
                            {featuredRecommendation.fit.reasons.map((reason) => (
                                <span key={reason} className="signal-badge">{reason}</span>
                            ))}
                        </div>
                        <button className="btn-primary friends-spotlight-button" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: featuredRecommendation.user.id } })}>Open Profile</button>
                    </div>
                ) : null}
            </section>
            <section className="panel-stack fade-in">
                {recommendations.length === 0 ? (
                    <div className="friends-empty-state surface-tier-1">
                        <h4>No players to discover right now</h4>
                        <p>Your live directory is still syncing, or you have already invited everyone currently available. Try again in a moment or review your invites.</p>
                        <button type="button" className="btn-secondary mt-4" onClick={() => onNavigate({ page: 'friendsInvites', params: {} })}>Open Invites</button>
                    </div>
                ) : recommendations.map(({ user, fit }, index) => (
                    <div key={user.id} className="card friends-member-card friends-discovery-card surface-tier-2">
                        <div className="friends-discovery-rank">{String(index + 1).padStart(2, '0')}</div>
                        <div className="friends-discovery-main">
                            <button type="button" className="friends-member-main interactive-card" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: user.id } })}>
                                <img src={resolveDiceBearAvatar(user)} className="friend-signal-avatar large-avatar" alt={user.name} onError={(event) => handleAvatarError(event, user)} />
                                <div className="signal-card-copy">
                                    <h4>{user.name}</h4>
                                    <p>{user.availability}</p>
                                    <div className="signal-badge-row">
                                        <span className="signal-badge"><i className="fas fa-heart-pulse"></i>{fit.fitScore}% fit</span>
                                        <span className="signal-badge"><i className="fas fa-shield-heart"></i>{buildReliabilityScore(user)} reliability</span>
                                        <span className="signal-badge"><i className="fas fa-satellite-dish"></i>@{user.handle || 'player'}</span>
                                    </div>
                                    <div className="signal-badge-row top-gap-sm">
                                        {fit.reasons.map((reason) => (
                                            <span key={reason} className="signal-badge">{reason}</span>
                                        ))}
                                    </div>
                                    <div className="friends-fit-meter" aria-hidden="true">
                                        <span style={{ width: `${fit.fitScore}%` }}></span>
                                    </div>
                                </div>
                            </button>
                            <div className="friends-card-actions friends-discovery-actions">
                                <button className="btn-secondary" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: user.id } })}>View Profile</button>
                                <button className="btn-secondary" onClick={() => onNavigate({ page: 'createMatch', params: { presetPlayers: [user.id] } })}>Invite To Session</button>
                                <button className="btn-primary" onClick={() => handleInvite(user.id)}>Send Invite</button>
                            </div>
                        </div>
                    </div>
                ))}
            </section>
        </div>
    );
};

export const FriendsInvitesPage = ({ state, socialState, onAcceptRequest, onDeclineRequest, dispatch, onBack, onNavigate, showToast, Header }) => {
    const liveState = resolveSocialState(state, socialState);
    const incomingRequests = liveState.friendRequests.filter(request => request.toUserId === liveState.currentUser.id && request.status === 'pending');
    const outgoingRequests = liveState.friendRequests.filter(request => request.fromUserId === liveState.currentUser.id && request.status === 'pending');

    const handleAccept = (requestId) => {
        if (onAcceptRequest) {
            onAcceptRequest(requestId);
            return;
        }

        dispatch({ type: 'ACCEPT_FRIEND_REQUEST', payload: { requestId } });
        showToast('Friend request accepted.');
    };

    const handleDecline = (requestId) => {
        if (onDeclineRequest) {
            onDeclineRequest(requestId);
            return;
        }

        dispatch({ type: 'DECLINE_FRIEND_REQUEST', payload: { requestId } });
        showToast('Friend request declined.');
    };

    return (
        <div className="page-content tech-page friends-page-shell">
            <Header title="Invites" onBack={onBack} onNavigate={onNavigate} />
            <section className="hero-panel friends-subpage-hero fade-in surface-tier-3">
                <span className="section-kicker">Request queue</span>
                <h2 className="section-title">Manage incoming and outgoing invitations</h2>
                <p>Accept the right connections quickly and keep pending outreach visible in one place.</p>
            </section>
            <section className="card friends-overview-panel surface-tier-2 fade-in">
                <div className="section-heading-row compact-heading-row">
                    <div>
                        <span className="section-kicker">Incoming</span>
                        <h3 className="section-title">Players waiting for your approval</h3>
                    </div>
                </div>
                {incomingRequests.length === 0 ? (
                    <div className="friends-empty-state surface-tier-1">
                        <h4>No incoming requests</h4>
                        <p>Your network is quiet right now. Discovery invites will show up here as they arrive.</p>
                    </div>
                ) : (
                    incomingRequests.map(request => {
                        const sender = liveState.users[request.fromUserId] || {
                            id: request.fromUserId,
                            name: request.senderName || 'Unknown player',
                            avatar: request.senderAvatar,
                            availability: 'Offline'
                        };

                        return sender ? (
                            <div key={request.id} className="card friends-request-card surface-tier-1">
                                <div className="friends-member-main" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: sender.id } })}>
                                    <img src={resolveAvatar(sender)} className="friend-signal-avatar large-avatar" alt={sender.name} onError={(event) => handleAvatarError(event, sender)} />
                                    <div className="signal-card-copy">
                                        <h4>{sender.name}</h4>
                                        <p>{request.message}</p>
                                        <span className="text-xs">{request.time}</span>
                                    </div>
                                </div>
                                <div className="friends-card-actions">
                                    <button className="btn-secondary" onClick={() => handleDecline(request.id)}>Decline</button>
                                    <button className="btn-primary" onClick={() => handleAccept(request.id)}>Accept</button>
                                </div>
                            </div>
                        ) : null;
                    })
                )}
            </section>
            <section className="card friends-overview-panel surface-tier-2 fade-in">
                <div className="section-heading-row compact-heading-row">
                    <div>
                        <span className="section-kicker">Outgoing</span>
                        <h3 className="section-title">Invites you have already sent</h3>
                    </div>
                </div>
                {outgoingRequests.length === 0 ? (
                    <div className="friends-empty-state surface-tier-1">
                        <h4>No outgoing invites</h4>
                        <p>Use Discover Players to expand your network with a few high-quality invites.</p>
                    </div>
                ) : (
                    outgoingRequests.map(request => {
                        const receiver = liveState.users[request.toUserId];

                        return receiver ? (
                            <div key={request.id} className="card friends-request-card surface-tier-1">
                                <div className="friends-member-main" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: receiver.id } })}>
                                    <img src={resolveAvatar(receiver)} className="friend-signal-avatar large-avatar" alt={receiver.name} onError={(event) => handleAvatarError(event, receiver)} />
                                    <div className="signal-card-copy">
                                        <h4>{receiver.name}</h4>
                                        <p>{request.message}</p>
                                        <span className="text-xs">Sent {request.time}</span>
                                    </div>
                                </div>
                                <span className="presence-pill">Pending</span>
                            </div>
                        ) : null;
                    })
                )}
            </section>
        </div>
    );
};