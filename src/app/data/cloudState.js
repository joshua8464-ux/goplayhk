import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

const USER_STATE_COLLECTION = 'userStates';
const DEFAULT_MATCH_DURATION_MINUTES = 90;
const READY_LEAD_MINUTES = 30;
const COMPLETE_GRACE_MINUTES = 15;
const STATE_VERSION = 1;
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

const cloneSerializable = (value) => JSON.parse(JSON.stringify(value));

const toIsoString = (value) => {
    if (!value) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value.toDate === 'function') {
        return value.toDate().toISOString();
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    return '';
};

const formatTimelineLabel = (date) => date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
});

const createDateFromMatch = (match) => {
    const scheduledStartAt = toIsoString(match.scheduledStartAt);

    if (scheduledStartAt) {
        const parsedTimestamp = new Date(scheduledStartAt);
        if (!Number.isNaN(parsedTimestamp.getTime())) {
            return parsedTimestamp;
        }
    }

    if (match.date && match.time) {
        const parsedDate = new Date(`${match.date}T${match.time}:00`);
        if (!Number.isNaN(parsedDate.getTime())) {
            return parsedDate;
        }
    }

    return null;
};

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60 * 1000);

const buildDefaultUser = (firebaseUser, existingUser = {}) => ({
    id: firebaseUser.uid,
    name: existingUser.name || firebaseUser.displayName || 'New User',
    avatar: existingUser.avatar || createDeterministicAvatar(existingUser.name || firebaseUser.displayName || firebaseUser.uid),
    mmr: existingUser.mmr || 1500,
    matchesPlayed: existingUser.matchesPlayed || 0,
    availability: existingUser.availability || 'Evenings & Weekends',
    friends: existingUser.friends || [],
    sports: existingUser.sports || ['Tennis'],
    district: existingUser.district || 'Causeway Bay',
    playStyle: existingUser.playStyle || 'Balanced',
    matchmakingTags: existingUser.matchmakingTags || ['open-to-all'],
    rewardPoints: existingUser.rewardPoints || 0,
    historyProcessedMatchIds: existingUser.historyProcessedMatchIds || []
});

const buildSeedMatches = (baseState, userId) => baseState.matches
    .filter((match) => match.creatorId === userId || match.participants.includes(userId))
    .map((match) => ({
        ...match,
        playState: match.playState || 'scheduled',
        scheduledStartAt: createDateFromMatch(match)?.toISOString() || '',
        scheduledEndAt: createDateFromMatch(match)
            ? addMinutes(createDateFromMatch(match), DEFAULT_MATCH_DURATION_MINUTES).toISOString()
            : ''
    }));

export const buildUserCloudState = ({ firebaseUser, baseState, knownUser }) => {
    const defaultUser = buildDefaultUser(firebaseUser, knownUser);
    const users = {
        ...cloneSerializable(baseState.users),
        [firebaseUser.uid]: defaultUser
    };

    return {
        version: STATE_VERSION,
        currentUserId: firebaseUser.uid,
        currentUser: defaultUser,
        users,
        matches: buildSeedMatches(baseState, firebaseUser.uid),
        notifications: cloneSerializable(baseState.notifications.filter((notification) => {
            if (notification.matchId) {
                return baseState.matches.some((match) => match.id === notification.matchId && (match.creatorId === firebaseUser.uid || match.participants.includes(firebaseUser.uid)));
            }

            return true;
        })),
        friendRequests: cloneSerializable(baseState.friendRequests.filter((request) => request.fromUserId === firebaseUser.uid || request.toUserId === firebaseUser.uid)),
        recurringSquads: cloneSerializable(baseState.recurringSquads.filter((squad) => squad.ownerId === firebaseUser.uid || squad.memberIds.includes(firebaseUser.uid))),
        lastCheckIn: null,
        accessibility: cloneSerializable(baseState.accessibility),
        languagePreference: baseState.languagePreference || 'en',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
};

const ensureNotification = (notifications, notification) => {
    if (notifications.some((entry) => entry.id === notification.id)) {
        return notifications;
    }

    return [...notifications, notification];
};

const calculateRewardPoints = (currentUser, matches = []) => {
    const completedMatches = matches.filter((match) => (
        match.status === 'completed'
        && (match.creatorId === currentUser.id || match.participants.includes(currentUser.id))
    )).length;

    return currentUser.matchesPlayed * 35 + (currentUser.friends?.length || 0) * 20 + completedMatches * 40;
};

export const reconcileUserCloudState = (rawState) => {
    const nextState = cloneSerializable(rawState);
    const currentUserId = nextState.currentUser?.id || nextState.currentUserId;

    if (!currentUserId) {
        return { state: nextState, changed: false };
    }

    const users = nextState.users || {};
    const currentUser = users[currentUserId] || nextState.currentUser;
    const processedMatchIds = new Set(currentUser?.historyProcessedMatchIds || []);
    const now = new Date();
    let changed = false;
    let notifications = Array.isArray(nextState.notifications) ? nextState.notifications : [];

    const matches = (nextState.matches || []).map((match) => {
        const scheduledStart = createDateFromMatch(match);
        if (!scheduledStart) {
            return match;
        }

        const scheduledEnd = match.scheduledEndAt
            ? new Date(match.scheduledEndAt)
            : addMinutes(scheduledStart, DEFAULT_MATCH_DURATION_MINUTES);
        const nextMatch = {
            ...match,
            scheduledStartAt: match.scheduledStartAt || scheduledStart.toISOString(),
            scheduledEndAt: match.scheduledEndAt || scheduledEnd.toISOString(),
            playState: match.playState || 'scheduled'
        };

        if (!match.scheduledStartAt || !match.scheduledEndAt) {
            changed = true;
        }

        if (nextMatch.status === 'cancelled' || nextMatch.status === 'completed') {
            if (nextMatch.status === 'completed' && !processedMatchIds.has(nextMatch.id) && nextMatch.participants.includes(currentUserId)) {
                processedMatchIds.add(nextMatch.id);
                currentUser.matchesPlayed += 1;
                notifications = ensureNotification(notifications, {
                    id: `match-complete-${nextMatch.id}`,
                    text: `${nextMatch.sport} moved into your completed history. Rewards were updated.`,
                    time: formatTimelineLabel(now),
                    read: false,
                    type: 'match_completed',
                    matchId: nextMatch.id
                });
                changed = true;
            }

            return nextMatch;
        }

        const readyAt = addMinutes(scheduledStart, -READY_LEAD_MINUTES);
        const completeAt = addMinutes(scheduledEnd, COMPLETE_GRACE_MINUTES);

        if (now >= completeAt) {
            nextMatch.status = 'completed';
            nextMatch.playState = 'completed';
            nextMatch.completedAt = nextMatch.completedAt || now.toISOString();
            nextMatch.booking = nextMatch.booking
                ? { ...nextMatch.booking, status: 'session completed' }
                : nextMatch.booking;

            if (!processedMatchIds.has(nextMatch.id) && nextMatch.participants.includes(currentUserId)) {
                processedMatchIds.add(nextMatch.id);
                currentUser.matchesPlayed += 1;
            }

            notifications = ensureNotification(notifications, {
                id: `match-complete-${nextMatch.id}`,
                text: `${nextMatch.sport} at ${nextMatch.time} has been moved into your completed history.`,
                time: formatTimelineLabel(now),
                read: false,
                type: 'match_completed',
                matchId: nextMatch.id
            });
            changed = true;
            return nextMatch;
        }

        if (now >= scheduledStart) {
            if (nextMatch.playState !== 'live') {
                nextMatch.playState = 'live';
                notifications = ensureNotification(notifications, {
                    id: `match-live-${nextMatch.id}`,
                    text: `${nextMatch.sport} is now live. Check in and play your session.`,
                    time: formatTimelineLabel(now),
                    read: false,
                    type: 'match_live',
                    matchId: nextMatch.id
                });
                changed = true;
            }

            return nextMatch;
        }

        if (now >= readyAt && nextMatch.playState !== 'ready') {
            nextMatch.playState = 'ready';
            notifications = ensureNotification(notifications, {
                id: `match-ready-${nextMatch.id}`,
                text: `${nextMatch.sport} starts soon. Venue details and route options are ready.`,
                time: formatTimelineLabel(now),
                read: false,
                type: 'match_ready',
                matchId: nextMatch.id
            });
            changed = true;
            return nextMatch;
        }

        if (nextMatch.playState !== 'scheduled') {
            nextMatch.playState = 'scheduled';
            changed = true;
        }

        return nextMatch;
    });

    const nextUser = {
        ...currentUser,
        historyProcessedMatchIds: [...processedMatchIds]
    };
    const nextRewardPoints = calculateRewardPoints(nextUser, matches);

    if (nextUser.rewardPoints !== nextRewardPoints) {
        nextUser.rewardPoints = nextRewardPoints;
        changed = true;
    }

    const nextUsers = {
        ...users,
        [currentUserId]: nextUser
    };

    nextState.currentUser = nextUser;
    nextState.currentUserId = currentUserId;
    nextState.users = nextUsers;
    nextState.matches = matches;
    nextState.notifications = notifications;
    nextState.updatedAt = new Date().toISOString();

    return { state: nextState, changed };
};

export const serializeUserCloudState = (state) => JSON.stringify({
    version: STATE_VERSION,
    currentUserId: state.currentUser?.id || state.currentUserId || '',
    currentUser: state.currentUser,
    users: state.users,
    matches: state.matches,
    notifications: state.notifications,
    friendRequests: state.friendRequests,
    recurringSquads: state.recurringSquads,
    lastCheckIn: state.lastCheckIn,
    accessibility: state.accessibility,
    languagePreference: state.languagePreference || 'en'
});

export const getUserStateRef = (userId) => doc(db, USER_STATE_COLLECTION, userId);

export const ensureUserCloudDocument = async ({ firebaseUser, baseState, knownUser }) => {
    const stateRef = getUserStateRef(firebaseUser.uid);
    const snapshot = await getDoc(stateRef);

    if (snapshot.exists()) {
        return snapshot.data();
    }

    const seedState = buildUserCloudState({ firebaseUser, baseState, knownUser });
    await setDoc(stateRef, seedState);
    return seedState;
};

export const subscribeToUserCloudState = (userId, onValue) => onSnapshot(getUserStateRef(userId), (snapshot) => {
    onValue(snapshot.exists() ? snapshot.data() : null);
});

export const saveUserCloudState = async (userId, state) => {
    await setDoc(getUserStateRef(userId), {
        ...state,
        version: STATE_VERSION,
        updatedAt: new Date().toISOString()
    });
};
