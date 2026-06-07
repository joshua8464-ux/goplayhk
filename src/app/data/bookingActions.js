import { reserveLiveBookingSession } from './liveBookings';

export const calculateSplitAmount = (total = 0, participants = 1) => Math.ceil((total || 0) / Math.max(participants, 1));

export const submitBookingReservation = async ({
    currentUser,
    usersById = {},
    venues = [],
    selectedVenue,
    formData,
    autoMatchEnabled,
    createMatchmakingState,
    inclusionFocus,
    matches = [],
    delayMs = 1250
}) => {
    if (!selectedVenue?.id) {
        throw new Error('Select a venue before submitting the reservation.');
    }

    if (!currentUser?.id) {
        throw new Error('A signed-in user is required before booking.');
    }

    if (delayMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }

    const liveAllocation = await reserveLiveBookingSession({
        venue: selectedVenue,
        date: formData.date,
        time: formData.time,
        currentUser,
        usersById,
        selectedPlayerIds: formData.players.filter((playerId) => playerId !== currentUser.id),
        venues,
        strategy: autoMatchEnabled ? 'smart' : 'join-random'
    });
    const matchId = `m${Date.now()}`;
    const matchmaking = await Promise.resolve(createMatchmakingState({
        users: usersById,
        currentUser,
        selectedPlayerIds: formData.players,
        totalSlots: formData.totalSlots,
        sport: formData.sport,
        venue: selectedVenue,
        date: formData.date,
        time: formData.time,
        playStyle: formData.playStyle,
        inclusionFocus,
        enabled: autoMatchEnabled,
        matches
    }));

    return {
        matchId,
        liveAllocation,
        matchmaking,
        newMatch: {
            id: matchId,
            sport: formData.sport,
            venueId: formData.venueId,
            date: formData.date,
            time: formData.time,
            skill: formData.playStyle,
            totalSlots: formData.totalSlots,
            participants: formData.players,
            creatorId: currentUser.id,
            status: 'upcoming',
            isLeague: false,
            isPrivate: false,
            cost: selectedVenue.price || 0,
            comments: [],
            feedback: [],
            result: null,
            booking: {
                status: 'venue confirmed',
                reservedAt: 'Now',
                paymentStatus: (selectedVenue.price || 0) > 0
                    ? `split ready • HKD ${calculateSplitAmount(selectedVenue.price || 0, formData.totalSlots)}/player`
                    : 'free venue',
                venueLocked: true,
                liveBookingId: liveAllocation?.slotId || '',
                liveBookingStatus: liveAllocation?.status || 'reserved'
            },
            matchmaking
        }
    };
};
