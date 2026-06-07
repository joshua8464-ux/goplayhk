import { onDisconnect, onValue, ref, serverTimestamp, set } from 'firebase/database';
import { rtdb } from '../config/firebase';
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp as firestoreServerTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { acceptFriendship, normalizeAvatarUrl } from './publicProfiles';

const PRESENCE_ROOT = 'presence';
const REQUESTS_COLLECTION = 'socialRequests';

const getPresenceRef = (userId) => ref(rtdb, `${PRESENCE_ROOT}/${userId}`);
const getConnectionRef = () => ref(rtdb, '.info/connected');
const getFriendRequestId = (firstUserId, secondUserId) => [firstUserId, secondUserId].sort().join('__');
const getFriendRequestRef = (firstUserId, secondUserId) => doc(db, REQUESTS_COLLECTION, getFriendRequestId(firstUserId, secondUserId));
const normalizeProfileAvatar = (profile = {}, fallbackSeed = 'player') => normalizeAvatarUrl(profile.avatar, profile.handle || profile.displayName || profile.name || fallbackSeed);

const mapFriendRequestSnapshot = (snapshot) => snapshot.docs.map((documentSnapshot) => {
    const data = documentSnapshot.data();

    return {
        id: documentSnapshot.id,
        ...data,
        senderAvatar: normalizeAvatarUrl(data.senderAvatar, data.senderHandle || data.senderName || data.fromUserId || documentSnapshot.id),
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() || data.createdAt || '',
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() || data.updatedAt || ''
    };
});

export const subscribeToPresence = (onValueChange) => onValue(ref(rtdb, PRESENCE_ROOT), (snapshot) => {
    onValueChange(snapshot.val() || {});
});

export const publishPresence = (userId, profile, getCurrentPage) => {
    const connectionRef = getConnectionRef();
    const presenceRef = getPresenceRef(userId);

    return onValue(connectionRef, (snapshot) => {
        if (snapshot.val() !== true) {
            return;
        }

        const page = typeof getCurrentPage === 'function' ? getCurrentPage() : 'home';
        onDisconnect(presenceRef).set({
            online: false,
            lastSeenAt: serverTimestamp(),
            page,
            name: profile.displayName || profile.name,
            handle: profile.handle,
            avatar: normalizeProfileAvatar(profile, userId),
            availability: profile.availability || 'Offline'
        });

        set(presenceRef, {
            online: true,
            lastSeenAt: serverTimestamp(),
            page,
            name: profile.displayName || profile.name,
            handle: profile.handle,
            avatar: normalizeProfileAvatar(profile, userId),
            availability: profile.availability || 'Available now'
        });
    });
};

export const updatePresencePage = async (userId, profile, page) => {
    await set(getPresenceRef(userId), {
        online: true,
        lastSeenAt: serverTimestamp(),
        page,
        name: profile.displayName || profile.name,
        handle: profile.handle,
        avatar: normalizeProfileAvatar(profile, userId),
        availability: profile.availability || 'Available now'
    });
};

export const subscribeToFriendRequests = (userId, onValueChange) => {
    let incomingRequests = [];
    let outgoingRequests = [];

    const emit = () => {
        const mergedRequests = [...incomingRequests, ...outgoingRequests]
            .filter((request) => request.status === 'pending')
            .sort((firstRequest, secondRequest) => new Date(secondRequest.time || secondRequest.createdAt || 0).getTime() - new Date(firstRequest.time || firstRequest.createdAt || 0).getTime());

        onValueChange(mergedRequests);
    };

    const unsubscribeIncoming = onSnapshot(
        query(collection(db, REQUESTS_COLLECTION), where('toUserId', '==', userId)),
        (snapshot) => {
            incomingRequests = mapFriendRequestSnapshot(snapshot);
            emit();
        },
        () => {
            incomingRequests = [];
            emit();
        }
    );

    const unsubscribeOutgoing = onSnapshot(
        query(collection(db, REQUESTS_COLLECTION), where('fromUserId', '==', userId)),
        (snapshot) => {
            outgoingRequests = mapFriendRequestSnapshot(snapshot);
            emit();
        },
        () => {
            outgoingRequests = [];
            emit();
        }
    );

    return () => {
        unsubscribeIncoming();
        unsubscribeOutgoing();
    };
};

export const sendFriendRequest = async ({ fromProfile, toUserId, message }) => {
    const requestRef = getFriendRequestRef(fromProfile.id, toUserId);

    const request = {
        fromUserId: fromProfile.id,
        toUserId,
        message,
        status: 'pending',
        time: new Date().toISOString(),
        senderName: fromProfile.displayName || fromProfile.name,
        senderHandle: fromProfile.handle,
        senderAvatar: normalizeProfileAvatar(fromProfile, fromProfile.id),
        users: [fromProfile.id, toUserId].sort(),
        createdAt: firestoreServerTimestamp(),
        updatedAt: firestoreServerTimestamp()
    };

    try {
        await setDoc(requestRef, request);
    } catch (error) {
        if (error?.code === 'permission-denied') {
            throw new Error('Live invites are still syncing with your player profile. Please wait a moment and try again.');
        }

        throw error;
    }

    return requestRef.id;
};

export const acceptFriendRequest = async ({ request }) => {
    await acceptFriendship({ currentUserId: request.toUserId, otherUserId: request.fromUserId });
    await deleteDoc(doc(db, REQUESTS_COLLECTION, request.id));
};

export const declineFriendRequest = async ({ request }) => {
    await deleteDoc(doc(db, REQUESTS_COLLECTION, request.id));
};
