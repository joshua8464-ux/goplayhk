import React, { useEffect, useMemo, useState } from 'react';
import PickupMap from './PickupMap';
import {
    buildShareUrl,
    canUserJoin,
    deletePickupGame,
    hasUserJoined,
    isPickupGameCreator,
    joinPickupGame,
    leavePickupGame,
    removePickupGameMember,
    subscribeToPickupGame
} from '../../data/pickupGames';

const formatSchedule = (value) => {
    if (!value) {
        return 'Flexible timing';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString('en-HK', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
};

const PickupGameDetailPage = ({ gameId, state, onBack, onNavigate, showToast, Header, theme = 'light' }) => {
    const currentUserId = state?.currentUser?.id || '';
    const [game, setGame] = useState(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [busy, setBusy] = useState(false);
    const [showMap, setShowMap] = useState(false);

    useEffect(() => {
        if (!gameId) {
            setLoading(false);
            setNotFound(true);
            return undefined;
        }

        setLoading(true);
        const unsubscribe = subscribeToPickupGame(gameId, (nextGame) => {
            setGame(nextGame);
            setNotFound(!nextGame);
            setLoading(false);
        }, () => {
            setNotFound(true);
            setLoading(false);
        });

        return unsubscribe;
    }, [gameId]);

    const usersById = useMemo(() => state?.users || {}, [state?.users]);
    const nameFor = (uid) => {
        if (uid === game?.creatorId) {
            return usersById[uid]?.name || game?.creatorName || 'Host';
        }
        return usersById[uid]?.name || 'Player';
    };

    const isCreator = isPickupGameCreator(game || {}, currentUserId);
    const joined = hasUserJoined(game || {}, currentUserId);
    const joinable = canUserJoin(game || {}, currentUserId);

    const runAction = async (action, successMessage) => {
        setBusy(true);
        try {
            await action();
            if (successMessage) {
                showToast?.(successMessage, 'success');
            }
        } catch (error) {
            showToast?.(error?.message || 'Something went wrong.', 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleJoin = () => runAction(() => joinPickupGame(gameId), 'You joined the game.');
    const handleLeave = () => runAction(() => leavePickupGame(gameId), 'You left the game.');
    const handleRemove = (memberUid) => runAction(() => removePickupGameMember(gameId, memberUid), 'Player removed.');
    const handleDelete = () => runAction(async () => {
        await deletePickupGame(gameId);
        showToast?.('Game deleted.', 'success');
        onNavigate({ page: 'pickupGames', params: { tab: 'mine' } });
    });

    const handleShare = async () => {
        const shareUrl = buildShareUrl(typeof window !== 'undefined' ? window.location.origin : '', gameId);
        try {
            if (navigator?.share) {
                await navigator.share({ title: game?.title || 'Pickup game', url: shareUrl });
                return;
            }

            await navigator.clipboard.writeText(shareUrl);
            showToast?.('Share link copied to clipboard.', 'success');
        } catch {
            showToast?.(shareUrl, 'info');
        }
    };

    const hasLocation = Number.isFinite(Number(game?.lat)) && Number.isFinite(Number(game?.lng));

    if (loading) {
        return (
            <div className="page-content tech-page pickup-page">
                {Header ? <Header title="Pickup Game" onNavigate={onNavigate} /> : null}
                <div className="pickup-detail-card surface-tier-2">
                    <div className="skeleton-line skeleton-line-lg"></div>
                    <div className="skeleton-line"></div>
                    <div className="skeleton-line skeleton-line-sm"></div>
                </div>
            </div>
        );
    }

    if (notFound || !game) {
        return (
            <div className="page-content tech-page pickup-page">
                {Header ? <Header title="Pickup Game" onNavigate={onNavigate} /> : null}
                <div className="pickup-empty surface-tier-1">
                    <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
                    <p>This game is no longer available.</p>
                    <button type="button" className="btn-primary" onClick={() => onNavigate({ page: 'pickupGames', params: {} })}>
                        Back to Pickup Games
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="page-content tech-page pickup-page">
            {Header ? <Header title="Pickup Game" onNavigate={onNavigate} /> : null}

            <button type="button" className="pickup-back-link" onClick={onBack}>
                <i className="fas fa-arrow-left" aria-hidden="true"></i> Back
            </button>

            <section className="pickup-detail-card surface-tier-2 fade-in">
                <div className="pickup-card-head">
                    <span className="pickup-sport-chip">{game.sport || 'Sport'}</span>
                    {isCreator && <span className="pickup-owner-chip">You host this</span>}
                </div>
                <h2 className="pickup-detail-title">{game.title}</h2>
                {game.description ? <p className="pickup-detail-desc">{game.description}</p> : null}

                <div className="pickup-detail-meta">
                    <p><i className="fas fa-location-dot" aria-hidden="true"></i> {game.venueName || game.district || 'Location to be confirmed'}</p>
                    <p><i className="fas fa-clock" aria-hidden="true"></i> {formatSchedule(game.scheduledStartAt)}</p>
                    <p><i className="fas fa-users" aria-hidden="true"></i> {game.joinCount}/{game.spotsTotal} players ({game.spotsRemaining} spot{game.spotsRemaining === 1 ? '' : 's'} left)</p>
                </div>

                <div className="pickup-progress-track" role="progressbar" aria-valuenow={game.fillPercent} aria-valuemin={0} aria-valuemax={100}>
                    <div className="pickup-progress-fill" style={{ width: `${game.fillPercent}%` }}></div>
                </div>

                {showMap && hasLocation ? (
                    <PickupMap lat={game.lat} lng={game.lng} label={game.venueName} theme={theme} height="260px" />
                ) : null}

                <div className="pickup-detail-actions">
                    {isCreator ? (
                        <button type="button" className="pickup-danger-btn" onClick={handleDelete} disabled={busy}>
                            <i className="fas fa-trash" aria-hidden="true"></i> Delete game
                        </button>
                    ) : joined ? (
                        <button type="button" className="pickup-ghost-btn" onClick={handleLeave} disabled={busy}>
                            Leave game
                        </button>
                    ) : (
                        <button type="button" className="pickup-join-btn" onClick={handleJoin} disabled={!joinable || busy}>
                            {game.isFull ? 'Full' : busy ? 'Joining…' : 'Join game'}
                        </button>
                    )}
                    {hasLocation ? (
                        <button type="button" className="pickup-ghost-btn" onClick={() => setShowMap((prev) => !prev)}>
                            <i className="fas fa-map-location-dot" aria-hidden="true"></i> {showMap ? 'Hide map' : 'Show map'}
                        </button>
                    ) : null}
                    <button type="button" className="pickup-share-btn" onClick={handleShare}>
                        <i className="fas fa-share-nodes" aria-hidden="true"></i> Share
                    </button>
                </div>
            </section>

            <section className="pickup-roster surface-tier-1 fade-in">
                <div className="pickup-subheading">
                    <span className="section-kicker">Roster</span>
                    <h3 className="section-title">Who is playing</h3>
                </div>
                <ul className="pickup-roster-list">
                    {(game.joinedPlayerIds || []).map((uid) => (
                        <li key={uid} className="pickup-roster-item">
                            <span className="pickup-roster-name">
                                {nameFor(uid)}
                                {uid === game.creatorId ? <span className="pickup-roster-tag">Host</span> : null}
                                {uid === currentUserId ? <span className="pickup-roster-tag pickup-roster-tag-you">You</span> : null}
                            </span>
                            {isCreator && uid !== game.creatorId ? (
                                <button
                                    type="button"
                                    className="pickup-remove-btn"
                                    onClick={() => handleRemove(uid)}
                                    disabled={busy}
                                    aria-label={`Remove ${nameFor(uid)}`}
                                >
                                    <i className="fas fa-user-minus" aria-hidden="true"></i>
                                </button>
                            ) : null}
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    );
};

export default PickupGameDetailPage;
