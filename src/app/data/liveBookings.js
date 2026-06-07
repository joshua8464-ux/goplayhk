import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    query,
    serverTimestamp,
    setDoc,
    where
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { app, auth, db, functions } from '../config/firebase';

const LIVE_BOOKING_SLOTS_COLLECTION = 'bookingSlots';
const LIVE_BOOKING_LEADERBOARDS_COLLECTION = 'bookingLeaderboards';
const LIVE_BOOKING_DISTRICT_METRICS_COLLECTION = 'bookingDistrictMetrics';
const LIVE_BOOKING_PRESETS_COLLECTION = 'bookingPresets';
const reserveLiveBookingSlotCallable = httpsCallable(functions, 'reserveLiveBookingSlot');
const reserveLiveBookingSlotHttpUrl = `https://asia-southeast1-${app.options.projectId}.cloudfunctions.net/reserveLiveBookingSlotHttp`;

const DEFAULT_SPORT_PRESET = {
    targetGroupSize: 4,
    minViableGroup: 2,
    courtCount: 3,
    durationMinutes: 90
};

export const SPORT_BOOKING_PRESETS = {
    Tennis: { targetGroupSize: 4, minViableGroup: 2, courtCount: 4, durationMinutes: 90 },
    Badminton: { targetGroupSize: 4, minViableGroup: 2, courtCount: 5, durationMinutes: 90 },
    Basketball: { targetGroupSize: 10, minViableGroup: 6, courtCount: 2, durationMinutes: 90 },
    Football: { targetGroupSize: 14, minViableGroup: 10, courtCount: 1, durationMinutes: 90 },
    Swimming: { targetGroupSize: 6, minViableGroup: 2, courtCount: 4, durationMinutes: 60 },
    Rugby: { targetGroupSize: 14, minViableGroup: 10, courtCount: 1, durationMinutes: 90 },
    Volleyball: { targetGroupSize: 12, minViableGroup: 8, courtCount: 2, durationMinutes: 90 },
    Athletics: { targetGroupSize: 8, minViableGroup: 4, courtCount: 3, durationMinutes: 60 },
    Running: { targetGroupSize: 8, minViableGroup: 3, courtCount: 3, durationMinutes: 60 },
    Cycling: { targetGroupSize: 8, minViableGroup: 4, courtCount: 2, durationMinutes: 90 },
    Golf: { targetGroupSize: 4, minViableGroup: 2, courtCount: 4, durationMinutes: 90 },
    'Horse Racing': { targetGroupSize: 8, minViableGroup: 4, courtCount: 2, durationMinutes: 120 },
    'Multi-sport': { targetGroupSize: 6, minViableGroup: 3, courtCount: 3, durationMinutes: 90 },
    Hiking: { targetGroupSize: 8, minViableGroup: 3, courtCount: 3, durationMinutes: 120 }
};

export const DISTRICT_DEMAND_PRESETS = {
    'Causeway Bay': { morning: 0.48, lunch: 0.64, evening: 0.94, late: 0.71 },
    'Kowloon City': { morning: 0.45, lunch: 0.61, evening: 0.86, late: 0.66 },
    'Tsim Sha Tsui': { morning: 0.42, lunch: 0.58, evening: 0.81, late: 0.6 },
    'Happy Valley': { morning: 0.44, lunch: 0.55, evening: 0.78, late: 0.59 },
    'Yau Ma Tei': { morning: 0.39, lunch: 0.57, evening: 0.76, late: 0.63 },
    'Tseung Kwan O': { morning: 0.37, lunch: 0.5, evening: 0.73, late: 0.56 },
    'Shek Kip Mei': { morning: 0.36, lunch: 0.48, evening: 0.71, late: 0.54 },
    'Sham Shui Po': { morning: 0.34, lunch: 0.47, evening: 0.69, late: 0.53 },
    Aberdeen: { morning: 0.32, lunch: 0.45, evening: 0.65, late: 0.49 },
    'Mong Kok': { morning: 0.43, lunch: 0.59, evening: 0.84, late: 0.68 },
    'Tai Po': { morning: 0.28, lunch: 0.39, evening: 0.58, late: 0.42 },
    'Sha Tin': { morning: 0.31, lunch: 0.43, evening: 0.63, late: 0.48 },
    'Lantau Island': { morning: 0.19, lunch: 0.26, evening: 0.36, late: 0.24 },
    'Kwai Tsing': { morning: 0.25, lunch: 0.34, evening: 0.52, late: 0.38 },
    'Siu Sai Wan': { morning: 0.24, lunch: 0.36, evening: 0.57, late: 0.39 },
    'Hung Hom': { morning: 0.35, lunch: 0.51, evening: 0.74, late: 0.57 },
    'Yuen Long': { morning: 0.21, lunch: 0.33, evening: 0.49, late: 0.37 },
    'Tsuen Wan': { morning: 0.27, lunch: 0.41, evening: 0.61, late: 0.44 },
    'Tsing Yi': { morning: 0.23, lunch: 0.35, evening: 0.51, late: 0.38 }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeDate = (date) => (date || '').slice(0, 10);

export const getTimeBucket = (time = '') => {
    const hour = Number.parseInt((time || '').split(':')[0], 10);

    if (Number.isNaN(hour)) {
        return 'evening';
    }

    if (hour < 12) {
        return 'morning';
    }

    if (hour < 15) {
        return 'lunch';
    }

    if (hour < 20) {
        return 'evening';
    }

    return 'late';
};

const getSportPreset = (sport = '') => SPORT_BOOKING_PRESETS[sport] || DEFAULT_SPORT_PRESET;

const getWeekKey = (dateValue = '') => {
    const date = new Date(dateValue || Date.now());
    const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = utcDate.getUTCDay() || 7;
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
    const weekNumber = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);

    return `${utcDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
};

const getPresetDemandScore = ({ district = '', time = '', sport = '' }) => {
    const bucket = getTimeBucket(time);
    const districtProfile = DISTRICT_DEMAND_PRESETS[district] || { morning: 0.31, lunch: 0.44, evening: 0.67, late: 0.51 };
    const sportPreset = getSportPreset(sport);
    const sizeFactor = clamp((sportPreset.targetGroupSize || 4) / 10, 0.2, 1);

    return clamp((districtProfile[bucket] || 0.5) * (0.8 + (sizeFactor * 0.2)), 0.12, 0.98);
};

const buildParticipantSnapshot = (user) => ({
    id: user.id,
    name: user.name || user.displayName || 'Player',
    avatar: user.avatar || '',
    district: user.district || '',
    mmr: user.mmr || 1500,
    reliabilityScore: clamp(0.45 + Math.min((user.matchesPlayed || 0) * 0.018, 0.32) + Math.min((user.rewardPoints || 0) / 2000, 0.18), 0.3, 0.95),
    friends: user.friends || []
});

const average = (values = []) => {
    if (!values.length) {
        return 0;
    }

    return values.reduce((total, value) => total + value, 0) / values.length;
};

const buildProbabilityLabel = (probabilityScore) => {
    if (probabilityScore >= 82) {
        return 'High probability';
    }

    if (probabilityScore >= 62) {
        return 'Medium probability';
    }

    return 'Lower probability';
};

const buildSlotId = ({ venueId, date, time, courtIndex }) => `${venueId}_${normalizeDate(date)}_${time}_${courtIndex}`;

const createSyntheticSlot = ({ venue, date, time, courtIndex }) => {
    const preset = getSportPreset(venue.sport);
    const presetDemandScore = getPresetDemandScore({ district: venue.location, time, sport: venue.sport });

    return {
        id: buildSlotId({ venueId: venue.id, date, time, courtIndex }),
        venueId: venue.id,
        venueName: venue.name,
        district: venue.location,
        sport: venue.sport,
        date: normalizeDate(date),
        time,
        timeBucket: getTimeBucket(time),
        courtId: `${venue.id}-court-${courtIndex}`,
        courtLabel: `Court ${courtIndex}`,
        courtIndex,
        targetGroupSize: preset.targetGroupSize,
        minViableGroup: preset.minViableGroup,
        participantIds: [],
        participants: [],
        waitlistIds: [],
        waitlist: [],
        currentParticipantCount: 0,
        status: 'open',
        presetDemandScore,
        weekKey: getWeekKey(date),
        source: 'preset'
    };
};

const decorateSlot = ({ slot, currentUser, usersById, venuesById }) => {
    const venue = venuesById[slot.venueId] || null;
    const targetGroupSize = slot.targetGroupSize || getSportPreset(slot.sport).targetGroupSize;
    const minViableGroup = slot.minViableGroup || getSportPreset(slot.sport).minViableGroup;
    const participantIds = slot.participantIds || [];
    const participantProfiles = (slot.participants || []).length
        ? slot.participants
        : participantIds.map((participantId) => buildParticipantSnapshot(usersById[participantId] || { id: participantId }));
    const occupancyRatio = clamp(participantIds.length / Math.max(targetGroupSize, 1), 0, 1);
    const averageReliability = average(participantProfiles.map((participant) => participant.reliabilityScore || 0.55)) || 0.55;
    const averageMmr = average(participantProfiles.map((participant) => participant.mmr || 1500)) || 1500;
    const userMmr = currentUser?.mmr || 1500;
    const mmrGap = Math.abs(averageMmr - userMmr);
    const skillCompatibility = clamp(1 - (mmrGap / 450), 0.2, 1);
    const friendOverlap = participantIds.filter((participantId) => (currentUser?.friends || []).includes(participantId)).length;
    const friendFactor = clamp(friendOverlap / Math.max(participantIds.length || 1, 1), 0, 1);
    const reliabilityFactor = currentUser
        ? clamp(0.45 + Math.min((currentUser.matchesPlayed || 0) * 0.018, 0.28) + Math.min((currentUser.rewardPoints || 0) / 3000, 0.12), 0.35, 0.95)
        : 0.6;
    const recentAccessPenalty = currentUser ? clamp((currentUser.matchesPlayed || 0) / 90, 0, 0.18) : 0;
    const presetDemandScore = slot.presetDemandScore || getPresetDemandScore({ district: slot.district, time: slot.time, sport: slot.sport });
    const completionBoost = participantIds.length + 1 >= minViableGroup
        ? 0.34
        : participantIds.length > 0
            ? 0.2
            : 0.08;
    const districtFit = currentUser?.district && currentUser.district === slot.district ? 0.12 : 0.06;
    const priceFactor = venue ? clamp(1 - ((venue.price || 0) / 240), 0.1, 1) : 0.55;
    const probabilityScore = Math.round(clamp((
        (presetDemandScore * 0.32)
        + (completionBoost * 0.22)
        + (skillCompatibility * 0.15)
        + (friendFactor * 0.12)
        + (averageReliability * 0.1)
        + (reliabilityFactor * 0.06)
        + districtFit
        - (recentAccessPenalty * 0.16)
        + (priceFactor * 0.03)
    ) * 100, 24, 98));
    const offPeakOpportunityScore = Math.round(clamp((
        ((1 - presetDemandScore) * 0.55)
        + ((1 - occupancyRatio) * 0.2)
        + (priceFactor * 0.17)
        + ((1 - friendFactor) * 0.04)
        + ((1 - averageReliability) * 0.04)
    ) * 100, 8, 96));
    const joinRandomEligible = participantIds.length > 0 && participantIds.length < targetGroupSize;
    const reasons = [];

    if (joinRandomEligible && participantIds.length + 1 >= minViableGroup) {
        reasons.push('one more player makes this group viable');
    }

    if (friendOverlap > 0) {
        reasons.push(`${friendOverlap} friend${friendOverlap > 1 ? 's' : ''} already in slot`);
    }

    if (skillCompatibility >= 0.72) {
        reasons.push('skill-compatible group');
    }

    if (presetDemandScore <= 0.45) {
        reasons.push('off-peak demand window');
    }

    if (slot.waitlistIds?.length) {
        reasons.push(`${slot.waitlistIds.length} waiting for movement`);
    }

    return {
        ...slot,
        venue,
        participantProfiles,
        currentParticipantCount: participantIds.length,
        occupancyRatio,
        joinRandomEligible,
        probabilityScore,
        probabilityLabel: buildProbabilityLabel(probabilityScore),
        offPeakOpportunityScore,
        reasons: reasons.slice(0, 3)
    };
};

const mapSnapshotToSlot = (documentSnapshot) => ({
    id: documentSnapshot.id,
    ...documentSnapshot.data()
});

const shouldRetryReservationOverHttp = (error) => {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();

    return code.includes('internal')
        || code.includes('unavailable')
        || code.includes('deadline')
        || message.includes('cors')
        || message.includes('failed to fetch')
        || message.includes('network')
        || message.includes('fetch');
};

const reserveLiveBookingSlotOverHttp = async (payload) => {
    const firebaseUser = auth.currentUser;

    if (!firebaseUser) {
        throw new Error('You must be signed in to reserve a live booking slot.');
    }

    const idToken = await firebaseUser.getIdToken();
    const response = await fetch(reserveLiveBookingSlotHttpUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    const responseBody = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(responseBody.error || 'Live booking could not be completed right now.');
    }

    return responseBody;
};

const buildLocalReservationFallback = async ({ venue, date, time, currentUser, usersById = {}, selectedPlayerIds = [], venues = [], strategy = 'smart' }) => {
    const district = venue.location || currentUser.district || '';
    const snapshot = await getDocs(query(collection(db, LIVE_BOOKING_SLOTS_COLLECTION), where('district', '==', district), limit(150)));
    const slots = snapshot.docs
        .map(mapSnapshotToSlot)
        .filter((slot) => slot.venueId === venue.id && normalizeDate(slot.date) === normalizeDate(date) && slot.time === time);
    const venuesById = venues.reduce((accumulator, item) => ({
        ...accumulator,
        [item.id]: item
    }), {});
    const selectedSlot = selectCandidateSlot({
        slots,
        currentUser,
        usersById,
        venuesById,
        strategy
    }) || decorateSlot({
        slot: createSyntheticSlot({ venue, date, time, courtIndex: 1 }),
        currentUser,
        usersById,
        venuesById
    });
    const targetGroupSize = selectedSlot.targetGroupSize || getSportPreset(venue.sport).targetGroupSize;
    const participantIds = Array.from(new Set([
        ...(selectedSlot.participantIds || []),
        currentUser.id,
        ...selectedPlayerIds
    ]));
    const participants = participantIds.map((participantId) => buildParticipantSnapshot(usersById[participantId] || (participantId === currentUser.id ? currentUser : { id: participantId })));

    return {
        slotId: selectedSlot.id,
        status: 'reserved',
        slot: {
            ...selectedSlot,
            participantIds,
            participants,
            currentParticipantCount: participantIds.length,
            targetGroupSize,
            status: participantIds.length >= targetGroupSize ? 'filled' : 'open',
            source: 'local-fallback'
        },
        fallback: true
    };
};

export const ensureBookingPresetCatalog = async () => {
    const presetDocRef = doc(db, LIVE_BOOKING_PRESETS_COLLECTION, 'catalog');
    await setDoc(presetDocRef, {
        sportRules: SPORT_BOOKING_PRESETS,
        districtDemand: DISTRICT_DEMAND_PRESETS,
        version: 1,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

export const ensureLiveSlotWindow = async ({ venue, date, time }) => {
    if (!venue?.id || !date || !time) {
        return [];
    }

    const preset = getSportPreset(venue.sport);
    const operations = [];
    const slotRefs = [];

    for (let courtIndex = 1; courtIndex <= preset.courtCount; courtIndex += 1) {
        const slot = createSyntheticSlot({ venue, date, time, courtIndex });
        const slotRef = doc(db, LIVE_BOOKING_SLOTS_COLLECTION, slot.id);
        slotRefs.push(slotRef);
        operations.push(getDoc(slotRef).then((snapshot) => {
            if (snapshot.exists()) {
                return null;
            }

            return setDoc(slotRef, {
                venueId: slot.venueId,
                venueName: slot.venueName,
                district: slot.district,
                sport: slot.sport,
                date: slot.date,
                time: slot.time,
                timeBucket: slot.timeBucket,
                courtId: slot.courtId,
                courtLabel: slot.courtLabel,
                courtIndex: slot.courtIndex,
                targetGroupSize: slot.targetGroupSize,
                minViableGroup: slot.minViableGroup,
                weekKey: slot.weekKey,
                presetDemandScore: slot.presetDemandScore,
                source: 'preset',
                updatedAt: serverTimestamp(),
                createdAt: serverTimestamp()
            }, { merge: true });
        }));
    }

    await Promise.all(operations);
    return slotRefs;
};

export const subscribeToDistrictLiveSlots = ({ district = '', maxItems = 120 }, onValue, onError) => {
    const baseCollection = collection(db, LIVE_BOOKING_SLOTS_COLLECTION);
    const slotQuery = district
        ? query(baseCollection, where('district', '==', district), limit(maxItems))
        : query(baseCollection, limit(maxItems));

    return onSnapshot(slotQuery, (snapshot) => {
        onValue(snapshot.docs.map(mapSnapshotToSlot));
    }, onError);
};

export const subscribeToUserLiveBookings = (userId, onValue, onError) => {
    if (!userId) {
        onValue([]);
        return () => {};
    }

    const slotQuery = query(collection(db, LIVE_BOOKING_SLOTS_COLLECTION), where('participantIds', 'array-contains', userId), limit(80));

    return onSnapshot(slotQuery, (snapshot) => {
        onValue(snapshot.docs.map(mapSnapshotToSlot));
    }, onError);
};

export const subscribeToWeeklyDistrictLeaderboard = ({ district = '', date = new Date() }, onValue, onError) => {
    if (!district) {
        onValue(null);
        return () => {};
    }

    const leaderboardRef = doc(db, LIVE_BOOKING_LEADERBOARDS_COLLECTION, `${district}__${getWeekKey(date)}`);

    return onSnapshot(leaderboardRef, (snapshot) => {
        onValue(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
    }, onError);
};

const selectCandidateSlot = ({ slots, currentUser, usersById, venuesById, strategy = 'smart' }) => {
    const decoratedSlots = slots
        .map((slot) => decorateSlot({ slot, currentUser, usersById, venuesById }))
        .filter((slot) => slot.currentParticipantCount < slot.targetGroupSize);
    const joinableSlots = decoratedSlots.filter((slot) => slot.joinRandomEligible);

    if (strategy === 'join-random' && joinableSlots.length) {
        return joinableSlots.sort((firstSlot, secondSlot) => secondSlot.probabilityScore - firstSlot.probabilityScore)[0];
    }

    const prioritized = decoratedSlots.sort((firstSlot, secondSlot) => {
        if (firstSlot.joinRandomEligible !== secondSlot.joinRandomEligible) {
            return Number(secondSlot.joinRandomEligible) - Number(firstSlot.joinRandomEligible);
        }

        return secondSlot.probabilityScore - firstSlot.probabilityScore;
    });

    return prioritized[0] || null;
};

export const rebuildWeeklyDistrictLeaderboardSnapshot = async ({ district, venues = [], rawSlots = [], date = new Date() }) => {
    if (!district) {
        return { entries: [], metrics: null };
    }

    const venuesById = venues.reduce((accumulator, venue) => ({
        ...accumulator,
        [venue.id]: venue
    }), {});
    let slots = rawSlots;

    if (!slots.length) {
        const snapshot = await getDocs(query(collection(db, LIVE_BOOKING_SLOTS_COLLECTION), where('district', '==', district), limit(150)));
        slots = snapshot.docs.map(mapSnapshotToSlot);
    }

    const relevantWeekKey = getWeekKey(date);
    const leaderboardEntries = slots
        .filter((slot) => slot.weekKey === relevantWeekKey)
        .map((slot) => decorateSlot({ slot, currentUser: null, usersById: {}, venuesById }))
        .sort((firstSlot, secondSlot) => {
            if (firstSlot.offPeakOpportunityScore !== secondSlot.offPeakOpportunityScore) {
                return secondSlot.offPeakOpportunityScore - firstSlot.offPeakOpportunityScore;
            }

            return secondSlot.probabilityScore - firstSlot.probabilityScore;
        })
        .slice(0, 10)
        .map((slot) => ({
            slotId: slot.id,
            venueId: slot.venueId,
            venueName: slot.venueName,
            courtLabel: slot.courtLabel,
            sport: slot.sport,
            date: slot.date,
            time: slot.time,
            currentParticipantCount: slot.currentParticipantCount,
            targetGroupSize: slot.targetGroupSize,
            probabilityScore: slot.probabilityScore,
            offPeakOpportunityScore: slot.offPeakOpportunityScore,
            reasons: slot.reasons,
            price: slot.venue?.price || 0
        }));
    const metrics = {
        district,
        weekKey: relevantWeekKey,
        totalTrackedSlots: slots.filter((slot) => slot.weekKey === relevantWeekKey).length,
        averageOccupancy: average(slots.filter((slot) => slot.weekKey === relevantWeekKey).map((slot) => ((slot.participantIds || []).length / Math.max(slot.targetGroupSize || 1, 1)))) || 0,
        joinRandomEligibleCount: slots.filter((slot) => slot.weekKey === relevantWeekKey && (slot.participantIds || []).length > 0 && (slot.participantIds || []).length < (slot.targetGroupSize || 1)).length,
        updatedAt: serverTimestamp()
    };

    await Promise.all([
        setDoc(doc(db, LIVE_BOOKING_LEADERBOARDS_COLLECTION, `${district}__${relevantWeekKey}`), {
            district,
            weekKey: relevantWeekKey,
            entries: leaderboardEntries,
            updatedAt: serverTimestamp()
        }, { merge: true }),
        setDoc(doc(db, LIVE_BOOKING_DISTRICT_METRICS_COLLECTION, `${district}__${relevantWeekKey}`), metrics, { merge: true })
    ]);

    return { entries: leaderboardEntries, metrics };
};

export const reserveLiveBookingSession = async ({
    venue,
    date,
    time,
    currentUser,
    usersById = {},
    selectedPlayerIds = [],
    venues = [],
    strategy = 'smart'
}) => {
    if (!venue?.id || !date || !time || !currentUser?.id) {
        throw new Error('A venue, date, time, and signed-in user are required.');
    }

    await ensureLiveSlotWindow({ venue, date, time });

    const payload = {
        venue: {
            id: venue.id,
            name: venue.name,
            location: venue.location,
            sport: venue.sport
        },
        date: normalizeDate(date),
        time,
        strategy,
        selectedPlayerIds,
        currentUser: buildParticipantSnapshot(currentUser),
        selectedPlayers: selectedPlayerIds
            .map((userId) => usersById[userId])
            .filter(Boolean)
            .map((user) => buildParticipantSnapshot(user))
    };

    try {
        const response = await reserveLiveBookingSlotCallable(payload);
        return response.data;
    } catch (error) {
        if (!shouldRetryReservationOverHttp(error)) {
            throw error;
        }

        try {
            return await reserveLiveBookingSlotOverHttp(payload);
        } catch (httpError) {
            if (!shouldRetryReservationOverHttp(httpError)) {
                throw httpError;
            }

            return buildLocalReservationFallback({
                venue,
                date,
                time,
                currentUser,
                usersById,
                selectedPlayerIds,
                venues,
                strategy
            });
        }
    }
};

export const buildBookingBoardModel = ({
    rawSlots = [],
    venues = [],
    currentUser,
    usersById = {},
    selectedVenueId = '',
    selectedDistrict = '',
    selectedSport = '',
    selectedDate = '',
    selectedTime = '',
    weeklyLeaderboard = null
}) => {
    const venuesById = venues.reduce((accumulator, venue) => ({
        ...accumulator,
        [venue.id]: venue
    }), {});
    const selectedVenue = venuesById[selectedVenueId] || null;
    const filteredSlots = rawSlots.filter((slot) => {
        if (selectedDistrict && slot.district !== selectedDistrict) {
            return false;
        }

        if (selectedSport && slot.sport !== selectedSport) {
            return false;
        }

        if (selectedDate && normalizeDate(slot.date) !== normalizeDate(selectedDate)) {
            return false;
        }

        if (selectedTime && slot.time !== selectedTime) {
            return false;
        }

        return true;
    });
    const selectedVenuePresetSlots = selectedVenue && selectedDate && selectedTime
        ? Array.from({ length: getSportPreset(selectedVenue.sport).courtCount }, (_, index) => createSyntheticSlot({
            venue: selectedVenue,
            date: selectedDate,
            time: selectedTime,
            courtIndex: index + 1
        }))
        : [];
    const venueSpecificRawSlots = filteredSlots.filter((slot) => slot.venueId === selectedVenueId);
    const effectiveVenueSlots = venueSpecificRawSlots.length ? venueSpecificRawSlots : selectedVenuePresetSlots;
    const decoratedVenueSlots = effectiveVenueSlots
        .map((slot) => decorateSlot({ slot, currentUser, usersById, venuesById }))
        .sort((firstSlot, secondSlot) => secondSlot.probabilityScore - firstSlot.probabilityScore);
    const decoratedDistrictSlots = filteredSlots
        .map((slot) => decorateSlot({ slot, currentUser, usersById, venuesById }))
        .filter((slot) => slot.currentParticipantCount < slot.targetGroupSize)
        .sort((firstSlot, secondSlot) => secondSlot.probabilityScore - firstSlot.probabilityScore);
    const joinRandomOptions = decoratedVenueSlots.filter((slot) => slot.joinRandomEligible);
    const alternativeSlots = decoratedDistrictSlots
        .filter((slot) => slot.venueId !== selectedVenueId)
        .slice(0, 4);
    const lowDemandEntries = weeklyLeaderboard?.entries?.length
        ? weeklyLeaderboard.entries
        : decoratedDistrictSlots
            .slice()
            .sort((firstSlot, secondSlot) => secondSlot.offPeakOpportunityScore - firstSlot.offPeakOpportunityScore)
            .slice(0, 10)
            .map((slot) => ({
                slotId: slot.id,
                venueId: slot.venueId,
                venueName: slot.venueName,
                courtLabel: slot.courtLabel,
                sport: slot.sport,
                date: slot.date,
                time: slot.time,
                currentParticipantCount: slot.currentParticipantCount,
                targetGroupSize: slot.targetGroupSize,
                probabilityScore: slot.probabilityScore,
                offPeakOpportunityScore: slot.offPeakOpportunityScore,
                reasons: slot.reasons,
                price: slot.venue?.price || 0
            }));

    return {
        selectedVenue,
        selectedVenueSlots: decoratedVenueSlots,
        joinRandomOptions,
        bestImmediateSlot: decoratedVenueSlots[0] || null,
        alternativeSlots,
        lowDemandEntries,
        districtLivePressure: Math.round(average(filteredSlots.map((slot) => slot.presetDemandScore || getPresetDemandScore({ district: slot.district, time: slot.time, sport: slot.sport }))) * 100) || 0
    };
};