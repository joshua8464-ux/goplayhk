const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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

export const normalizeMatchmakingTag = (value = '') => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export const availabilityMatchesSession = (availability = '', date = '', time = '') => {
    const normalized = availability.toLowerCase();
    const bucket = getTimeBucket(time);
    const parsedDate = date ? new Date(date) : null;
    const isWeekend = parsedDate ? [0, 6].includes(parsedDate.getDay()) : false;

    if (normalized.includes('weekend') && isWeekend) {
        return true;
    }

    if (normalized.includes('weekday') && !isWeekend) {
        return true;
    }

    if (bucket === 'morning' && normalized.includes('morning')) {
        return true;
    }

    if (bucket === 'lunch' && (normalized.includes('lunch') || normalized.includes('midday'))) {
        return true;
    }

    if (bucket === 'evening' && normalized.includes('evening')) {
        return true;
    }

    if (bucket === 'late' && (normalized.includes('late') || normalized.includes('evening'))) {
        return true;
    }

    return normalized.includes('flexible') || normalized.includes('any');
};

export const buildReliabilityScore = (player = {}) => Math.round(clamp(
    52 + ((player.matchesPlayed || 0) * 1.8) + Math.min((player.rewardPoints || 0) / 20, 16),
    48,
    96
));

const getSharedMatchHistory = ({ matches = [], currentUserId = '', candidateId = '', selectedPlayerIds = [] }) => {
    const selectedPlayerIdSet = new Set(selectedPlayerIds.filter(Boolean));
    const sharedMatches = matches.filter((match) => (
        (match.status === 'completed' || match.result)
        && (match.participants || []).includes(currentUserId)
        && (match.participants || []).includes(candidateId)
    ));
    const sharedFeedback = sharedMatches.flatMap((match) => (match.feedback || []))
        .filter((entry) => entry.userId === currentUserId && entry.targetUserId === candidateId);
    const squadOverlapMatches = sharedMatches.filter((match) => (
        [...selectedPlayerIdSet].every((playerId) => (match.participants || []).includes(playerId))
    ));
    const averageRating = sharedFeedback.length
        ? sharedFeedback.reduce((total, entry) => total + (entry.rating || 0), 0) / sharedFeedback.length
        : 0;

    return {
        sharedMatches: sharedMatches.length,
        sharedFeedbackCount: sharedFeedback.length,
        averageRating,
        squadOverlapMatches: squadOverlapMatches.length
    };
};

const buildHistoryAdjustment = (history) => {
    const sharedMatchBoost = Math.min(history.sharedMatches * 3, 12);
    const feedbackBoost = history.sharedFeedbackCount
        ? clamp((history.averageRating - 3) * 4, -8, 8)
        : 0;
    const squadBoost = Math.min(history.squadOverlapMatches * 2, 8);

    return {
        score: sharedMatchBoost + feedbackBoost + squadBoost,
        reason: history.sharedFeedbackCount > 0
            ? `history ${Math.round(clamp((history.averageRating / 5) * 100, 20, 100))}%`
            : history.sharedMatches > 0
                ? `${history.sharedMatches} shared sessions`
                : ''
    };
};

export const buildCompatibility = (
    currentUser = {},
    player = {},
    {
        sport = '',
        date = '',
        time = '',
        playStyle = currentUser.playStyle || '',
        matches = [],
        selectedPlayerIds = []
    } = {}
) => {
    const sharedSports = (player.sports || []).filter((entry) => (currentUser.sports || []).includes(entry));
    const sameDistrict = player.district && player.district === currentUser.district;
    const samePlayStyle = player.playStyle && player.playStyle === playStyle;
    const sportAligned = sport ? (player.sports || []).includes(sport) : sharedSports.length > 0;
    const scheduleAligned = date && time ? availabilityMatchesSession(player.availability || '', date, time) : false;
    const mmrGap = Math.abs((player.mmr || 1500) - (currentUser.mmr || 1500));
    const history = getSharedMatchHistory({
        matches,
        currentUserId: currentUser.id,
        candidateId: player.id,
        selectedPlayerIds
    });
    const historyAdjustment = buildHistoryAdjustment(history);
    const score = Math.round(clamp(
        42
        + (sharedSports.length * 13)
        + (sameDistrict ? 8 : 0)
        + (samePlayStyle ? 7 : 0)
        + (sportAligned ? 10 : 0)
        + (scheduleAligned ? 8 : 0)
        + Math.max(0, 14 - (mmrGap / 22))
        + historyAdjustment.score,
        38,
        99
    ));
    const reasons = [];

    if (sportAligned && sport) {
        reasons.push(`${sport} ready`);
    } else if (sharedSports.length) {
        reasons.push(sharedSports.slice(0, 2).join(' + '));
    }

    if (sameDistrict) {
        reasons.push('same district');
    }

    if (scheduleAligned) {
        reasons.push('schedule aligned');
    } else if (samePlayStyle) {
        reasons.push(`${player.playStyle.toLowerCase()} style`);
    }

    if (historyAdjustment.reason) {
        reasons.push(historyAdjustment.reason);
    }

    reasons.push(`${buildReliabilityScore(player)} reliability`);

    return {
        score,
        reasons: reasons.slice(0, 4),
        history
    };
};

const buildSquadBalanceScore = ({ currentUser = {}, candidate = {}, selectedPlayers = [], sport = '', date = '', time = '' }) => {
    const group = [currentUser, ...selectedPlayers, candidate].filter(Boolean);

    if (group.length < 3) {
        return {
            score: 0,
            reasons: []
        };
    }

    const mmrValues = group.map((player) => player.mmr || 1500);
    const mmrSpread = Math.max(...mmrValues) - Math.min(...mmrValues);
    const scheduleCoverage = group.filter((player) => availabilityMatchesSession(player.availability || '', date, time)).length / group.length;
    const sportCoverage = sport
        ? group.filter((player) => (player.sports || []).includes(sport)).length / group.length
        : 1;
    const districtCoverage = currentUser.district
        ? group.filter((player) => player.district === currentUser.district).length / group.length
        : 0.5;
    const score = Math.round(clamp(
        48
        + (sportCoverage * 20)
        + (scheduleCoverage * 18)
        + (districtCoverage * 8)
        + Math.max(0, 12 - (mmrSpread / 40)),
        30,
        98
    ));
    const reasons = [];

    if (sportCoverage >= 0.75 && sport) {
        reasons.push(`${sport} lineup coverage`);
    }

    if (scheduleCoverage >= 0.67) {
        reasons.push('group schedule overlap');
    }

    if (mmrSpread <= 220) {
        reasons.push('balanced squad range');
    }

    return {
        score,
        reasons: reasons.slice(0, 3)
    };
};

const buildInclusionAdjustment = ({ candidate = {}, inclusionFocus = '' }) => {
    const normalizedFocus = normalizeMatchmakingTag(inclusionFocus);
    const candidateTags = (candidate.matchmakingTags || []).map(normalizeMatchmakingTag);

    if (!normalizedFocus || normalizedFocus === 'open-to-all') {
        return {
            score: 0,
            reason: ''
        };
    }

    const matchesFocus = candidateTags.includes(normalizedFocus);
    return {
        score: matchesFocus ? 8 : -4,
        reason: matchesFocus ? inclusionFocus : ''
    };
};

export const buildMatchmakingSuggestions = ({
    users = {},
    currentUser = {},
    selectedPlayerIds = [],
    totalSlots = 4,
    sport = '',
    venue = null,
    date = '',
    time = '',
    playStyle = 'Balanced',
    inclusionFocus = 'Open to All',
    matches = []
} = {}) => {
    const excludedIds = new Set([currentUser.id, ...selectedPlayerIds]);
    const selectedPlayers = selectedPlayerIds.map((playerId) => users[playerId]).filter(Boolean);

    return Object.values(users)
        .filter((candidate) => candidate?.id && !excludedIds.has(candidate.id))
        .map((candidate) => {
            const compatibility = buildCompatibility(currentUser, candidate, {
                sport,
                date,
                time,
                playStyle,
                matches,
                selectedPlayerIds
            });
            const squadBalance = buildSquadBalanceScore({
                currentUser,
                candidate,
                selectedPlayers,
                sport,
                date,
                time
            });
            const reliability = buildReliabilityScore(candidate);
            const inclusionAdjustment = buildInclusionAdjustment({ candidate, inclusionFocus });
            const shouldApplySquadScore = totalSlots > 2 || selectedPlayers.length >= 2;
            const score = Math.round(clamp(
                (compatibility.score * (shouldApplySquadScore ? 0.65 : 0.85))
                + (reliability * 0.15)
                + (shouldApplySquadScore ? squadBalance.score * 0.2 : 0)
                + inclusionAdjustment.score,
                30,
                99
            ));
            const reasons = [
                compatibility.reasons[0] || '',
                squadBalance.reasons[0] || '',
                inclusionAdjustment.reason || '',
                `${reliability} reliability`
            ].filter(Boolean).slice(0, 4);

            return {
                userId: candidate.id,
                name: candidate.name,
                score,
                reasons,
                reliability,
                compatibilityScore: compatibility.score,
                squadScore: squadBalance.score,
                district: candidate.district || venue?.location || '',
                availability: candidate.availability || 'Availability not set',
                sports: candidate.sports || []
            };
        })
        .sort((firstCandidate, secondCandidate) => secondCandidate.score - firstCandidate.score)
        .slice(0, 6)
        .map((candidate, index) => ({
            ...candidate,
            status: index < 2 ? 'invited' : 'queued'
        }));
};

export const createInitialMatchmakingState = ({
    users = {},
    currentUser = {},
    selectedPlayerIds = [],
    totalSlots = 4,
    sport = '',
    venue = null,
    date = '',
    time = '',
    playStyle = 'Balanced',
    inclusionFocus = 'Open to All',
    enabled = true,
    matches = []
} = {}) => {
    if (!enabled) {
        return {
            enabled: false,
            status: 'manual',
            confidence: 0,
            fitSummary: 'Manual squad mode enabled.',
            inviteWave: 0,
            openSlots: Math.max(totalSlots - selectedPlayerIds.length, 0),
            preferences: { playStyle, inclusionFocus },
            suggestions: []
        };
    }

    const suggestions = buildMatchmakingSuggestions({
        users,
        currentUser,
        selectedPlayerIds,
        totalSlots,
        sport,
        venue,
        date,
        time,
        playStyle,
        inclusionFocus,
        matches
    });
    const confidence = suggestions.length
        ? Math.round(suggestions.slice(0, 3).reduce((total, candidate) => total + candidate.score, 0) / Math.min(suggestions.length, 3))
        : 0;
    const leadCandidate = suggestions[0];
    const groupMode = totalSlots > 2 || selectedPlayerIds.length >= 2;

    return {
        enabled: true,
        status: selectedPlayerIds.length >= totalSlots ? 'filled' : (suggestions.some((candidate) => candidate.status === 'invited') ? 'searching' : 'awaiting-pool'),
        confidence,
        fitSummary: leadCandidate
            ? `${groupMode ? 'Squad balance' : 'Player fit'} is strongest around ${leadCandidate.reasons.join(', ')}.`
            : 'No strong partners yet. Try widening the time or venue radius.',
        inviteWave: 1,
        openSlots: Math.max(totalSlots - selectedPlayerIds.length, 0),
        preferences: { playStyle, inclusionFocus },
        suggestions
    };
};
