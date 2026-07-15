import React from 'react';
import { canUserJoin, hasUserJoined, isPickupGameCreator } from '../../data/pickupGames';

const formatSchedule = (value) => {
    if (!value) {
        return 'Flexible timing';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString('en-HK', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
};

const PickupGameCard = ({ game, currentUserId, onOpen, onJoin, busy = false }) => {
    const joined = hasUserJoined(game, currentUserId);
    const mine = isPickupGameCreator(game, currentUserId);
    const joinable = canUserJoin(game, currentUserId);

    const joinLabel = mine
        ? 'You are hosting'
        : joined
            ? 'Joined'
            : game.isFull
                ? 'Full'
                : busy
                    ? 'Joining…'
                    : 'Join game';

    return (
        <div className="pickup-card surface-tier-2">
            <div className="pickup-card-head">
                <span className="pickup-sport-chip">{game.sport || 'Sport'}</span>
                {mine && <span className="pickup-owner-chip">Host</span>}
            </div>

            <button type="button" className="pickup-card-title-btn" onClick={() => onOpen?.(game)}>
                <h3 className="pickup-card-title">{game.title}</h3>
            </button>

            <p className="pickup-card-meta">
                <i className="fas fa-location-dot" aria-hidden="true"></i>
                {game.venueName || game.district || 'Location to be confirmed'}
            </p>
            <p className="pickup-card-meta">
                <i className="fas fa-clock" aria-hidden="true"></i>
                {formatSchedule(game.scheduledStartAt)}
            </p>

            <div className="pickup-card-host">
                <span className="pickup-card-host-name">Organized by {game.creatorName || 'Host'}</span>
            </div>

            <div className="pickup-card-footer">
                <span className="pickup-spots-text">
                    <i className="fas fa-users" aria-hidden="true"></i>
                    {game.joinCount}/{game.spotsTotal} players
                </span>
                <div className="pickup-card-actions">
                    <button type="button" className="pickup-ghost-btn" onClick={() => onOpen?.(game)}>
                        View
                    </button>
                    <button
                        type="button"
                        className="pickup-join-btn"
                        onClick={() => onJoin?.(game)}
                        disabled={!joinable || busy}
                    >
                        {joinLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PickupGameCard;
