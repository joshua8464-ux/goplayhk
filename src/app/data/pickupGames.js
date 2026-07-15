import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    startAfter,
    updateDoc,
    where
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';

// Shared, discoverable "pickup games" collection.
//
// Unlike the legacy per-user `userStates/{uid}` match blob, documents here live
// in one global collection so ANY signed-in player can browse and join a game
// another player hosts. This module intentionally reuses the Firestore patterns
// already proven in `liveBookings.js` (collection/query/onSnapshot/arrayUnion).

export const PICKUP_GAMES_COLLECTION = 'pickupGames';
export const DEFAULT_PICKUP_PAGE_SIZE = 12;
export const BROWSE_PICKUP_LIMIT = 50;
export const MIN_PICKUP_SPOTS = 2;
export const MAX_PICKUP_SPOTS = 30;

// --- Pure helpers (no Firestore) — unit tested in pickupGames.test.js ---

export const clampSpots = (value) => {
    const parsed = Math.round(Number(value));

    if (!Number.isFinite(parsed)) {
        return MIN_PICKUP_SPOTS;
    }

    return Math.min(MAX_PICKUP_SPOTS, Math.max(MIN_PICKUP_SPOTS, parsed));
};

// The joinedPlayerIds ARRAY is the single source of truth for occupancy — we
// never store a separate count field (that is exactly the drift bug that broke
// the reference build). Everything derived is computed here instead.
export const getPickupGameCounts = (game = {}) => {
    const joinedPlayerIds = Array.isArray(game.joinedPlayerIds) ? game.joinedPlayerIds : [];
    const spotsTotal = Math.max(Number(game.spotsTotal) || 0, 0);
    const joinCount = joinedPlayerIds.length;
    const spotsRemaining = Math.max(spotsTotal - joinCount, 0);
    const isFull = spotsTotal > 0 && joinCount >= spotsTotal;
    const fillRatio = spotsTotal > 0 ? Math.min(joinCount / spotsTotal, 1) : 0;
    const fillPercent = Math.round(fillRatio * 100);

    return { joinedPlayerIds, spotsTotal, joinCount, spotsRemaining, isFull, fillRatio, fillPercent };
};

export const decoratePickupGame = (game = {}) => ({
    ...game,
    ...getPickupGameCounts(game)
});

export const isPickupGameCreator = (game = {}, uid = '') => Boolean(uid) && game.creatorId === uid;

export const hasUserJoined = (game = {}, uid = '') => Boolean(uid)
    && Array.isArray(game.joinedPlayerIds)
    && game.joinedPlayerIds.includes(uid);

export const canUserJoin = (game = {}, uid = '') => {
    if (!uid) {
        return false;
    }

    const { isFull } = getPickupGameCounts(game);
    return !isFull && !hasUserJoined(game, uid);
};

// Split a mixed "my games" result (array-contains uid returns both hosted and
// joined games, because the host is always in joinedPlayerIds) into two lists.
export const splitMyGames = (games = [], uid = '') => {
    const hosting = [];
    const joined = [];

    games.forEach((game) => {
        if (isPickupGameCreator(game, uid)) {
            hosting.push(game);
        } else {
            joined.push(game);
        }
    });

    return { hosting, joined };
};

// Given the +1 "probe" row appended to every query, peel it off and report more.
export const splitPageDocs = (docs = [], pageSize = DEFAULT_PICKUP_PAGE_SIZE) => {
    const hasMore = docs.length > pageSize;
    const pageDocs = hasMore ? docs.slice(0, pageSize) : docs;

    return { pageDocs, hasMore };
};

export const buildShareUrl = (origin = '', gameId = '') => {
    const base = String(origin || '').replace(/\/$/, '');
    return `${base}/?game=${encodeURIComponent(gameId)}`;
};

export const readSharedGameId = (search = '') => {
    try {
        return new URLSearchParams(search || '').get('game') || '';
    } catch {
        return '';
    }
};

export const mapPickupGameDoc = (snapshot) => decoratePickupGame({ id: snapshot.id, ...snapshot.data() });

export const buildPickupGameConstraints = ({
    creatorId = '',
    joinedPlayerId = '',
    pageSize = DEFAULT_PICKUP_PAGE_SIZE,
    cursor = null
} = {}) => {
    const constraints = [];

    if (creatorId) {
        constraints.push(where('creatorId', '==', creatorId));
    }

    if (joinedPlayerId) {
        constraints.push(where('joinedPlayerIds', 'array-contains', joinedPlayerId));
    }

    constraints.push(orderBy('createdAt', 'desc'));

    if (cursor) {
        constraints.push(startAfter(cursor));
    }

    // Fetch one extra row so callers can detect "has more" without a count read.
    constraints.push(limit(pageSize + 1));

    return constraints;
};

// --- Firestore operations ---

const requireUser = (action = 'continue') => {
    const user = auth.currentUser;

    if (!user) {
        throw new Error(`You must be signed in to ${action}.`);
    }

    return user;
};

export async function createPickupGame(input = {}) {
    const user = requireUser('host a game');

    const payload = {
        title: String(input.title || '').trim() || 'Pickup game',
        description: String(input.description || '').trim(),
        sport: input.sport || '',
        venueId: input.venueId || '',
        venueName: input.venueName || '',
        district: input.district || '',
        lat: Number.isFinite(Number(input.lat)) ? Number(input.lat) : null,
        lng: Number.isFinite(Number(input.lng)) ? Number(input.lng) : null,
        scheduledStartAt: input.scheduledStartAt || '',
        spotsTotal: clampSpots(input.spotsTotal),
        joinedPlayerIds: [user.uid],
        creatorId: user.uid,
        // Denormalized so cards render the host without an extra read per card.
        creatorName: input.creatorName || user.displayName || 'Host',
        creatorAvatar: input.creatorAvatar || user.photoURL || '',
        status: 'open',
        createdAt: serverTimestamp()
    };

    const created = await addDoc(collection(db, PICKUP_GAMES_COLLECTION), payload);
    return created.id;
}

export async function fetchPickupGameById(gameId) {
    const snapshot = await getDoc(doc(db, PICKUP_GAMES_COLLECTION, gameId));

    if (!snapshot.exists()) {
        throw new Error('This game is no longer available.');
    }

    return mapPickupGameDoc(snapshot);
}

export async function fetchPickupGamesPage(filter = {}) {
    const constraints = buildPickupGameConstraints(filter);
    const snapshot = await getDocs(query(collection(db, PICKUP_GAMES_COLLECTION), ...constraints));
    const { pageDocs, hasMore } = splitPageDocs(snapshot.docs, filter.pageSize || DEFAULT_PICKUP_PAGE_SIZE);

    return {
        games: pageDocs.map(mapPickupGameDoc),
        hasMore,
        cursor: pageDocs.length ? pageDocs[pageDocs.length - 1] : null
    };
}

export function subscribeToPickupGames(filter = {}, onValue, onError) {
    const pageSize = filter.pageSize || BROWSE_PICKUP_LIMIT;
    const constraints = buildPickupGameConstraints({ ...filter, pageSize });
    const gamesQuery = query(collection(db, PICKUP_GAMES_COLLECTION), ...constraints);

    return onSnapshot(gamesQuery, (snapshot) => {
        const { pageDocs } = splitPageDocs(snapshot.docs, pageSize);
        onValue(pageDocs.map(mapPickupGameDoc));
    }, onError);
}

export function subscribeToPickupGame(gameId, onValue, onError) {
    return onSnapshot(doc(db, PICKUP_GAMES_COLLECTION, gameId), (snapshot) => {
        onValue(snapshot.exists() ? mapPickupGameDoc(snapshot) : null);
    }, onError);
}

export async function joinPickupGame(gameId) {
    const user = requireUser('join a game');
    await updateDoc(doc(db, PICKUP_GAMES_COLLECTION, gameId), {
        joinedPlayerIds: arrayUnion(user.uid)
    });
}

export async function leavePickupGame(gameId) {
    const user = requireUser('leave a game');
    await updateDoc(doc(db, PICKUP_GAMES_COLLECTION, gameId), {
        joinedPlayerIds: arrayRemove(user.uid)
    });
}

export async function removePickupGameMember(gameId, memberUid) {
    requireUser('manage this game');

    if (!memberUid) {
        throw new Error('A member is required to remove them.');
    }

    await updateDoc(doc(db, PICKUP_GAMES_COLLECTION, gameId), {
        joinedPlayerIds: arrayRemove(memberUid)
    });
}

export async function deletePickupGame(gameId) {
    requireUser('delete a game');
    await deleteDoc(doc(db, PICKUP_GAMES_COLLECTION, gameId));
}
