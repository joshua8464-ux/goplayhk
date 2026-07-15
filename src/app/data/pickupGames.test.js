import { beforeAll, describe, expect, it, vi } from 'vitest';

// Avoid pulling in the real Firebase app (which requires VITE_* env vars at
// import time). We only exercise the pure, Firestore-free helpers here.
vi.mock('../config/firebase', () => ({
    auth: { currentUser: null },
    db: {}
}));

let helpers;

beforeAll(async () => {
    helpers = await import('./pickupGames');
});

const makeGame = (overrides = {}) => ({
    id: 'g1',
    creatorId: 'host',
    joinedPlayerIds: ['host', 'p2'],
    spotsTotal: 4,
    ...overrides
});

describe('clampSpots', () => {
    it('keeps values inside the allowed range', () => {
        expect(helpers.clampSpots(1)).toBe(helpers.MIN_PICKUP_SPOTS);
        expect(helpers.clampSpots(999)).toBe(helpers.MAX_PICKUP_SPOTS);
        expect(helpers.clampSpots(8)).toBe(8);
    });

    it('falls back to the minimum for non-numbers', () => {
        expect(helpers.clampSpots('abc')).toBe(helpers.MIN_PICKUP_SPOTS);
        expect(helpers.clampSpots(undefined)).toBe(helpers.MIN_PICKUP_SPOTS);
    });
});

describe('getPickupGameCounts', () => {
    it('derives occupancy from the joinedPlayerIds array only', () => {
        const counts = helpers.getPickupGameCounts(makeGame());
        expect(counts.joinCount).toBe(2);
        expect(counts.spotsRemaining).toBe(2);
        expect(counts.isFull).toBe(false);
        expect(counts.fillPercent).toBe(50);
    });

    it('reports full when the array reaches capacity', () => {
        const counts = helpers.getPickupGameCounts(makeGame({ joinedPlayerIds: ['a', 'b', 'c', 'd'] }));
        expect(counts.isFull).toBe(true);
        expect(counts.spotsRemaining).toBe(0);
        expect(counts.fillPercent).toBe(100);
    });

    it('is safe when fields are missing', () => {
        const counts = helpers.getPickupGameCounts({});
        expect(counts.joinCount).toBe(0);
        expect(counts.fillRatio).toBe(0);
    });
});

describe('join eligibility', () => {
    it('lets a new signed-in player join a game with room', () => {
        expect(helpers.canUserJoin(makeGame(), 'newbie')).toBe(true);
    });

    it('blocks joining when already in the roster', () => {
        expect(helpers.hasUserJoined(makeGame(), 'p2')).toBe(true);
        expect(helpers.canUserJoin(makeGame(), 'p2')).toBe(false);
    });

    it('blocks joining a full game', () => {
        const full = makeGame({ joinedPlayerIds: ['a', 'b', 'c', 'd'] });
        expect(helpers.canUserJoin(full, 'newbie')).toBe(false);
    });

    it('requires a uid', () => {
        expect(helpers.canUserJoin(makeGame(), '')).toBe(false);
    });
});

describe('splitMyGames', () => {
    it('separates hosted games from joined games', () => {
        const games = [
            makeGame({ id: 'a', creatorId: 'me', joinedPlayerIds: ['me'] }),
            makeGame({ id: 'b', creatorId: 'other', joinedPlayerIds: ['other', 'me'] })
        ];
        const { hosting, joined } = helpers.splitMyGames(games, 'me');
        expect(hosting.map((g) => g.id)).toEqual(['a']);
        expect(joined.map((g) => g.id)).toEqual(['b']);
    });
});

describe('splitPageDocs', () => {
    it('peels off the +1 probe row and flags more', () => {
        const docs = [1, 2, 3, 4];
        const { pageDocs, hasMore } = helpers.splitPageDocs(docs, 3);
        expect(pageDocs).toEqual([1, 2, 3]);
        expect(hasMore).toBe(true);
    });

    it('reports no more when the page is not full', () => {
        const { pageDocs, hasMore } = helpers.splitPageDocs([1, 2], 3);
        expect(pageDocs).toEqual([1, 2]);
        expect(hasMore).toBe(false);
    });
});

describe('share links', () => {
    it('builds a deep link and reads it back', () => {
        const url = helpers.buildShareUrl('https://goplayhk.web.app/', 'game-123');
        expect(url).toBe('https://goplayhk.web.app/?game=game-123');
        expect(helpers.readSharedGameId('?game=game-123')).toBe('game-123');
    });

    it('returns empty when no game param is present', () => {
        expect(helpers.readSharedGameId('?foo=bar')).toBe('');
        expect(helpers.readSharedGameId('')).toBe('');
    });
});

describe('buildPickupGameConstraints', () => {
    it('adds a where clause for creator filters', () => {
        const browse = helpers.buildPickupGameConstraints({});
        const mine = helpers.buildPickupGameConstraints({ creatorId: 'me' });
        // orderBy + limit for browse; +1 where clause for the filtered query.
        expect(mine.length).toBe(browse.length + 1);
    });
});
