import {
    collection,
    doc,
    getDoc,
    onSnapshot,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    updateDoc,
    where
} from 'firebase/firestore';
import { db } from '../config/firebase';

const PROFILES_COLLECTION = 'profiles';
const HANDLES_COLLECTION = 'handles';
const FRIENDSHIPS_COLLECTION = 'friendships';
const HANDLE_REGEX = /^[a-z0-9](?:[a-z0-9_]{2,19})$/;

const slugifyHandle = (value = '') => value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);

const escapeSvgText = (value = '') => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const createDeterministicAvatar = (seed = 'player') => {
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

export const createDiceBearAvatar = (seed = 'player') =>
    `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf&mouth=smile01,smile02,smile03`;

export const isPlaceholderAvatar = (url) => {
    if (typeof url !== 'string') return false;
    const trimmed = url.trim().toLowerCase();
    return trimmed.startsWith('data:image/svg+xml') || trimmed.includes('placehold.co') || trimmed.includes('ui-avatars.com');
};

export const normalizeAvatarUrl = (value, fallbackSeed = 'player') => {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }

    return createDiceBearAvatar(fallbackSeed);
};

const normalizeProfileRecord = (profileId, data = {}) => {
    const avatarSeed = data.handle || data.displayName || data.name || profileId || 'player';

    return {
        id: profileId,
        ...data,
        avatar: normalizeAvatarUrl(data.avatar, avatarSeed),
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt || '',
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || data.updatedAt || ''
    };
};

const buildProfilePayload = ({ firebaseUser, profile = {}, handle }) => ({
    id: firebaseUser.uid,
    uid: firebaseUser.uid,
    handle,
    handleLower: handle,
    name: profile.displayName || firebaseUser.displayName || profile.name || 'New User',
    displayName: profile.displayName || firebaseUser.displayName || profile.name || 'New User',
    avatar: normalizeAvatarUrl(profile.avatar, handle || firebaseUser.uid),
    mmr: profile.mmr || 1500,
    matchesPlayed: profile.matchesPlayed || 0,
    availability: profile.availability || 'Evenings & Weekends',
    sports: profile.sports || [profile.favoriteSport || 'Tennis'],
    district: profile.district || profile.homeDistrict || 'Causeway Bay',
    playStyle: profile.playStyle || 'Balanced',
    matchmakingTags: profile.matchmakingTags || ['open-to-all'],
    rewardPoints: profile.rewardPoints || 0,
    bio: profile.bio || '',
    friendCount: profile.friendCount || 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
});

export const normalizeHandle = (value = '') => slugifyHandle(value);

export const validateHandle = (value = '') => HANDLE_REGEX.test(normalizeHandle(value));

export const buildAutoHandleBase = (input = '') => {
    const normalized = slugifyHandle(input);
    if (normalized.length >= 3) {
        return normalized;
    }

    return 'player';
};

const getProfileRef = (uid) => doc(db, PROFILES_COLLECTION, uid);
const getHandleRef = (handle) => doc(db, HANDLES_COLLECTION, handle);
const getFriendshipRef = (firstUserId, secondUserId) => {
    const [lowerUserId, higherUserId] = [firstUserId, secondUserId].sort();
    return doc(db, FRIENDSHIPS_COLLECTION, `${lowerUserId}_${higherUserId}`);
};

export const isHandleAvailable = async (rawHandle = '') => {
    const handle = normalizeHandle(rawHandle);
    if (!validateHandle(handle)) {
        return false;
    }

    const snapshot = await getDoc(getHandleRef(handle));
    return !snapshot.exists();
};

const reserveHandleAndProfile = async ({ firebaseUser, profile, handle }) => runTransaction(db, async (transaction) => {
    const handleRef = getHandleRef(handle);
    const profileRef = getProfileRef(firebaseUser.uid);
    const [handleSnapshot, profileSnapshot] = await Promise.all([
        transaction.get(handleRef),
        transaction.get(profileRef)
    ]);

    if (handleSnapshot.exists() && handleSnapshot.data()?.uid !== firebaseUser.uid) {
        throw new Error('This handle is already taken. Please choose another one.');
    }

    const nextProfile = buildProfilePayload({ firebaseUser, profile, handle });

    if (!profileSnapshot.exists()) {
        transaction.set(profileRef, nextProfile);
    } else {
        transaction.set(profileRef, {
            ...profileSnapshot.data(),
            ...nextProfile,
            createdAt: profileSnapshot.data()?.createdAt || serverTimestamp(),
            updatedAt: serverTimestamp()
        }, { merge: true });
    }

    if (!handleSnapshot.exists()) {
        transaction.set(handleRef, {
            uid: firebaseUser.uid,
            handle,
            createdAt: serverTimestamp()
        });
    }

    return nextProfile;
});

export const ensurePublicProfile = async ({ firebaseUser, profile = {}, requestedHandle = '' }) => {
    const profileRef = getProfileRef(firebaseUser.uid);
    const existingProfileSnapshot = await getDoc(profileRef);

    if (existingProfileSnapshot.exists()) {
        const existingProfile = existingProfileSnapshot.data();
        const mergedProfile = {
            ...existingProfile,
            displayName: existingProfile.displayName || firebaseUser.displayName || profile.displayName || existingProfile.name,
            name: existingProfile.name || firebaseUser.displayName || profile.displayName || existingProfile.displayName,
            avatar: normalizeAvatarUrl(existingProfile.avatar || profile.avatar, existingProfile.handle || firebaseUser.uid),
            updatedAt: serverTimestamp()
        };

        await setDoc(profileRef, mergedProfile, { merge: true });
        return { ...existingProfile, ...mergedProfile };
    }

    const candidateHandles = [];
    const requested = normalizeHandle(requestedHandle);
    if (requested) {
        candidateHandles.push(requested);
    }

    const baseHandle = buildAutoHandleBase(profile.displayName || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || firebaseUser.uid);
    candidateHandles.push(baseHandle);
    for (let index = 1; index <= 12; index += 1) {
        candidateHandles.push(`${baseHandle.slice(0, Math.max(3, 18 - `${index}`.length))}${index}`);
    }

    let lastError = new Error('Unable to reserve a unique handle right now.');

    for (const handle of candidateHandles) {
        if (!validateHandle(handle)) {
            continue;
        }

        try {
            return await reserveHandleAndProfile({ firebaseUser, profile, handle });
        } catch (error) {
            lastError = error;
            if (!String(error?.message || '').toLowerCase().includes('taken')) {
                break;
            }
        }
    }

    throw lastError;
};

export const updatePublicProfile = async (userId, updates) => {
    const profileRef = getProfileRef(userId);
    await updateDoc(profileRef, {
        ...updates,
        ...(Object.prototype.hasOwnProperty.call(updates, 'avatar') ? {
            avatar: normalizeAvatarUrl(updates.avatar, updates.handle || updates.displayName || updates.name || userId)
        } : {}),
        updatedAt: serverTimestamp()
    });
};

export const subscribeToPublicProfiles = (onValue) => onSnapshot(collection(db, PROFILES_COLLECTION), (snapshot) => {
    const profiles = {};
    snapshot.forEach((documentSnapshot) => {
        const data = documentSnapshot.data();
        profiles[documentSnapshot.id] = normalizeProfileRecord(documentSnapshot.id, data);
    });
    onValue(profiles);
});

export const subscribeToFriendships = (userId, onValue) => {
    const friendshipsQuery = query(collection(db, FRIENDSHIPS_COLLECTION), where('users', 'array-contains', userId));

    return onSnapshot(friendshipsQuery, (snapshot) => {
        const friendIds = [];
        snapshot.forEach((documentSnapshot) => {
            const data = documentSnapshot.data();
            if (data.status !== 'accepted') {
                return;
            }

            const friendId = (data.users || []).find((entry) => entry !== userId);
            if (friendId) {
                friendIds.push(friendId);
            }
        });
        onValue(friendIds);
    });
};

export const acceptFriendship = async ({ currentUserId, otherUserId }) => {
    const friendshipRef = getFriendshipRef(currentUserId, otherUserId);
    await setDoc(friendshipRef, {
        users: [currentUserId, otherUserId].sort(),
        status: 'accepted',
        acceptedBy: currentUserId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    }, { merge: true });
};
