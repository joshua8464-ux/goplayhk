import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PickupGameCard from './PickupGameCard';
import {
    DEFAULT_PICKUP_PAGE_SIZE,
    decoratePickupGame,
    fetchPickupGamesPage,
    joinPickupGame,
    splitMyGames,
    subscribeToPickupGames
} from '../../data/pickupGames';

const PickupGamesPage = ({ state, onNavigate, showToast, Header, theme = 'light', initialTab = 'discover' }) => {
    const currentUserId = state?.currentUser?.id || '';
    const [tab, setTab] = useState(initialTab === 'mine' ? 'mine' : 'discover');

    const [discoverGames, setDiscoverGames] = useState([]);
    const [loadingDiscover, setLoadingDiscover] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const cursorRef = useRef(null);

    const [myGames, setMyGames] = useState([]);
    const [loadingMine, setLoadingMine] = useState(true);
    const [busyGameId, setBusyGameId] = useState('');

    // Discover: real cursor pagination (startAfter), not a re-fetch of page 1.
    const loadDiscover = useCallback(async ({ append = false } = {}) => {
        if (append) {
            setLoadingMore(true);
        } else {
            setLoadingDiscover(true);
            cursorRef.current = null;
        }

        try {
            const { games, hasMore: more, cursor } = await fetchPickupGamesPage({
                pageSize: DEFAULT_PICKUP_PAGE_SIZE,
                cursor: append ? cursorRef.current : null
            });
            cursorRef.current = cursor;
            setHasMore(more);
            setDiscoverGames((prev) => (append ? [...prev, ...games] : games));
        } catch (error) {
            showToast?.(error?.message || 'Could not load games.', 'error');
            if (!append) {
                setDiscoverGames([]);
            }
        } finally {
            setLoadingDiscover(false);
            setLoadingMore(false);
        }
    }, [showToast]);

    useEffect(() => {
        loadDiscover({ append: false });
    }, [loadDiscover]);

    // My Games stays live (small, personal): array-contains uid returns both
    // hosted and joined, which we split locally.
    useEffect(() => {
        if (!currentUserId) {
            setMyGames([]);
            setLoadingMine(false);
            return undefined;
        }

        setLoadingMine(true);
        const unsubscribe = subscribeToPickupGames({ joinedPlayerId: currentUserId }, (games) => {
            setMyGames(games);
            setLoadingMine(false);
        }, () => {
            setMyGames([]);
            setLoadingMine(false);
        });

        return unsubscribe;
    }, [currentUserId]);

    const { hosting, joined } = useMemo(() => splitMyGames(myGames, currentUserId), [myGames, currentUserId]);

    const openGame = (game) => onNavigate({ page: 'pickupGameDetail', params: { gameId: game.id } });

    const handleJoin = async (game) => {
        setBusyGameId(game.id);
        try {
            await joinPickupGame(game.id);
            // Optimistically reflect the join without refetching the whole page.
            setDiscoverGames((prev) => prev.map((entry) => (
                entry.id === game.id
                    ? decoratePickupGame({ ...entry, joinedPlayerIds: [...(entry.joinedPlayerIds || []), currentUserId] })
                    : entry
            )));
            showToast?.('You joined the game. See you on the court!', 'success');
        } catch (error) {
            showToast?.(error?.message || 'Could not join this game.', 'error');
        } finally {
            setBusyGameId('');
        }
    };

    const renderGrid = (games, emptyCopy) => {
        if (!games.length) {
            return (
                <div className="pickup-empty surface-tier-1">
                    <i className="fas fa-people-group" aria-hidden="true"></i>
                    <p>{emptyCopy}</p>
                </div>
            );
        }

        return (
            <div className="pickup-grid">
                {games.map((game) => (
                    <PickupGameCard
                        key={game.id}
                        game={game}
                        currentUserId={currentUserId}
                        onOpen={openGame}
                        onJoin={handleJoin}
                        busy={busyGameId === game.id}
                        theme={theme}
                    />
                ))}
            </div>
        );
    };

    const renderSkeleton = () => (
        <div className="pickup-grid">
            {[0, 1, 2].map((index) => (
                <div key={index} className="pickup-card pickup-card-skeleton" aria-hidden="true">
                    <div className="skeleton-line skeleton-line-sm"></div>
                    <div className="skeleton-line skeleton-line-lg"></div>
                    <div className="skeleton-line"></div>
                    <div className="skeleton-line skeleton-line-sm"></div>
                </div>
            ))}
        </div>
    );

    return (
        <div className="page-content tech-page pickup-page">
            {Header ? <Header title="Pickup Games" onNavigate={onNavigate} /> : null}

            <section className="pickup-hero fade-in">
                <div className="pickup-hero-copy">
                    <span className="section-kicker">Play today</span>
                    <h2 className="pickup-hero-title">Find a pickup game near you</h2>
                    <p className="pickup-hero-sub">
                        Real games hosted by real players across Hong Kong — join one, or host your own.
                    </p>
                </div>
                <button type="button" className="btn-primary pickup-host-cta" onClick={() => onNavigate({ page: 'hostGame', params: {} })}>
                    <i className="fas fa-plus" aria-hidden="true"></i> Host a game
                </button>
            </section>

            <div className="pickup-tabs" role="tablist">
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'discover'}
                    className={`pickup-tab${tab === 'discover' ? ' active' : ''}`}
                    onClick={() => setTab('discover')}
                >
                    Discover
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'mine'}
                    className={`pickup-tab${tab === 'mine' ? ' active' : ''}`}
                    onClick={() => setTab('mine')}
                >
                    My Games
                </button>
            </div>

            {tab === 'discover' ? (
                <section className="fade-in">
                    {loadingDiscover
                        ? renderSkeleton()
                        : renderGrid(discoverGames, 'No games have been posted yet. Be the first to host one!')}

                    {!loadingDiscover ? (
                        <div className="pickup-load-more">
                            <button type="button" className="pickup-load-more-btn" onClick={() => loadDiscover({ append: false })} disabled={loadingMore}>
                                <i className="fas fa-rotate-right" aria-hidden="true"></i> Refresh
                            </button>
                            {hasMore ? (
                                <button type="button" className="pickup-load-more-btn" onClick={() => loadDiscover({ append: true })} disabled={loadingMore}>
                                    {loadingMore ? 'Loading…' : 'Load more'}
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                </section>
            ) : (
                <section className="fade-in pickup-mine">
                    {loadingMine ? renderSkeleton() : (
                        <>
                            <div className="pickup-subheading">
                                <span className="section-kicker">Hosting</span>
                                <h3 className="section-title">Games you organize</h3>
                            </div>
                            {renderGrid(hosting, 'You are not hosting any games yet.')}

                            <div className="pickup-subheading">
                                <span className="section-kicker">Joined</span>
                                <h3 className="section-title">Games you joined</h3>
                            </div>
                            {renderGrid(joined, 'You have not joined any games yet. Open Discover to find one.')}
                        </>
                    )}
                </section>
            )}
        </div>
    );
};

export default PickupGamesPage;
