import { ASSISTANT_FALLBACK_MODEL_NAME, getAssistantModel, getAssistantModelName } from '../config/firebaseAi';
import { buildCompatibility, buildReliabilityScore } from './matchmaking';

const ASSISTANT_AI_KEYWORDS = [
    'group',
    'join',
    'players',
    'player',
    'teammate',
    'teammates',
    'partner',
    'partners',
    'fill',
    'team',
    'squad',
    'invite',
    'compatible',
    'chemistry',
    'who should',
    'who can',
    'find me',
    'find someone',
    'find players',
    'join right now',
    'matchmaking',
    'session',
    'venue',
    'court',
    'book',
    'booking',
    'where',
    'when',
    'recommend',
    'nearby',
    'tonight',
    'tomorrow',
    'practice',
    'schedule',
    'plan'
];

const MAX_HISTORY_MESSAGES = 6;
const RESPONSE_STYLES = {
    concise: 'concise',
    balanced: 'balanced',
    guided: 'guided'
};

const STATUS_QUERY_PATTERNS = [
    /\bnext\s+(?:match|session|booking)\b/i,
    /\bupcoming\b/i,
    /\bwhen\s+(?:is|do|does)\b/i,
    /\bwhat\s+time\b/i,
    /\bstatus\b/i,
    /\bdo\s+i\s+have\b/i
];

const GUIDE_QUERY_PATTERNS = [
    /\bhow\s+to\b/i,
    /\bhow\s+do\s+i\b/i,
    /\bstep\s*by\s*step\b/i,
    /\bwalk\s+me\s+through\b/i,
    /\bexplain\b/i,
    /\bguide\b/i
];

const PLANNING_QUERY_PATTERNS = [
    /\bplan\b/i,
    /\bstrategy\b/i,
    /\boptimi[sz]e\b/i,
    /\bcompare\b/i,
    /\bshould\s+i\b/i,
    /\bbest\s+way\b/i
];

const normalizeText = (value = '') => value.toLowerCase().replace(/[^a-z0-9\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const detectResponseStyle = (rawInput = '', fallbackReply = {}) => {
    const normalizedInput = normalizeText(rawInput);

    if (!normalizedInput) {
        return RESPONSE_STYLES.balanced;
    }

    if (GUIDE_QUERY_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
        return RESPONSE_STYLES.guided;
    }

    if (PLANNING_QUERY_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
        return RESPONSE_STYLES.guided;
    }

    if (fallbackReply?.intent === 'booking') {
        return RESPONSE_STYLES.balanced;
    }

    if (STATUS_QUERY_PATTERNS.some((pattern) => pattern.test(normalizedInput))) {
        return RESPONSE_STYLES.concise;
    }

    return RESPONSE_STYLES.balanced;
};

const buildResponseStyleInstructions = (responseStyle = RESPONSE_STYLES.balanced) => {
    if (responseStyle === RESPONSE_STYLES.concise) {
        return 'Output style target: concise. Use 1 to 2 short sentences and stay under 60 words unless the user explicitly asks for more detail.';
    }

    if (responseStyle === RESPONSE_STYLES.guided) {
        return 'Output style target: guided. Use 3 to 6 clear steps, mention specific in-app sections, and include practical next actions. Keep it under 220 words.';
    }

    return 'Output style target: balanced. Use 2 to 4 sentences, include key reasoning, and keep the answer under 120 words.';
};

const buildAppBlueprint = (context = {}) => ({
    productAreas: [
        { page: 'home', purpose: 'overview, stats, and quick launch actions' },
        { page: 'booking', purpose: 'discover venues, join sessions, and draft reservations' },
        { page: 'createMatch', purpose: 'finalize match details and reservation confirmation' },
        { page: 'explore', purpose: 'map view, route options, and travel mode guidance' },
        { page: 'friendsHub', purpose: 'social layer for squads, invites, and recurring groups' },
        { page: 'friendsDiscover', purpose: 'find compatible players and profiles' },
        { page: 'bookingLobbies', purpose: 'manage hosted sessions and open slots' },
        { page: 'clubs', purpose: 'clubs + rewards surface' }
    ],
    capabilities: [
        'draft booking details from chat and hand off to confirmation',
        'navigate directly to venue detail, match detail, booking, and routing screens',
        'surface live district slots and leaderboard demand snapshots',
        'recommend players using compatibility and reliability signals'
    ],
    activeCounts: {
        venues: (context.venues || []).length,
        matches: (context.matches || []).length,
        users: Object.keys(context.users || {}).length
    }
});

export const rankLivePlayerOptions = ({
    currentUser = {},
    users = {},
    preferredSport = '',
    district = '',
    includeOffline = false,
    limit = 6
} = {}) => Object.values(users || {})
    .filter((player) => player?.id && player.id !== currentUser?.id)
    .filter((player) => includeOffline || String(player.liveStatus || '').toLowerCase() === 'online')
    .map((player) => {
        const compatibility = buildCompatibility(currentUser, player, { sport: preferredSport });
        const sameSport = preferredSport ? (player.sports || []).includes(preferredSport) : false;
        const sameDistrict = district ? player.district === district : player.district === currentUser?.district;
        const reliability = buildReliabilityScore(player);
        const liveBoost = String(player.liveStatus || '').toLowerCase() === 'online' ? 12 : 0;
        const score = Math.round(clamp(
            compatibility.score
            + (sameSport ? 14 : 0)
            + (sameDistrict ? 8 : 0)
            + liveBoost,
            38,
            99
        ));
        const reasons = [
            sameSport ? `${preferredSport} ready` : '',
            sameDistrict ? `near ${player.district || district || currentUser?.district || 'you'}` : '',
            compatibility.reasons[0] || '',
            `${reliability} reliability`
        ].filter(Boolean).slice(0, 3);

        return {
            ...player,
            fitScore: score,
            reliability,
            reasons,
            liveStatus: player.liveStatus || 'Offline',
            availability: player.availability || 'Availability not set'
        };
    })
    .sort((firstPlayer, secondPlayer) => secondPlayer.fitScore - firstPlayer.fitScore)
    .slice(0, limit);

const buildJoinableMatches = (context = {}) => {
    const currentUserId = context.currentUser?.id;

    return (context.matches || [])
        .filter((match) => (
            match.status === 'upcoming'
            && match.creatorId !== currentUserId
            && !match.participants.includes(currentUserId)
            && match.participants.length < (match.totalSlots || 4)
        ))
        .sort((firstMatch, secondMatch) => {
            const firstRatio = firstMatch.participants.length / Math.max(firstMatch.totalSlots || 4, 1);
            const secondRatio = secondMatch.participants.length / Math.max(secondMatch.totalSlots || 4, 1);

            return secondRatio - firstRatio;
        })
        .slice(0, 3)
        .map((match, index) => ({
            key: `JOIN_MATCH_${index + 1}`,
            matchId: match.id,
            sport: match.sport,
            date: match.date,
            time: match.time,
            participantCount: match.participants.length,
            totalSlots: match.totalSlots || 4,
            venueName: context.venuesById?.[match.venueId]?.name || 'Venue pending'
        }));
};

const buildHostedMatches = (context = {}) => {
    const currentUserId = context.currentUser?.id;

    return (context.matches || [])
        .filter((match) => (
            match.status === 'upcoming'
            && match.creatorId === currentUserId
            && match.participants.length < (match.totalSlots || 4)
        ))
        .sort((firstMatch, secondMatch) => {
            const firstOpenSlots = (firstMatch.totalSlots || 4) - firstMatch.participants.length;
            const secondOpenSlots = (secondMatch.totalSlots || 4) - secondMatch.participants.length;

            return firstOpenSlots - secondOpenSlots;
        })
        .slice(0, 3)
        .map((match, index) => ({
            key: `HOSTED_MATCH_${index + 1}`,
            matchId: match.id,
            sport: match.sport,
            date: match.date,
            time: match.time,
            openSlots: Math.max((match.totalSlots || 4) - match.participants.length, 0),
            totalSlots: match.totalSlots || 4,
            venueName: context.venuesById?.[match.venueId]?.name || 'Venue pending'
        }));
};

const buildPlayerCandidates = (context = {}) => Object.values(context.users || {})
    .filter((player) => (
        player.id !== context.currentUser?.id
        && !(context.currentUser?.friends || []).includes(player.id)
    ))
    .map((player) => ({
        key: '',
        playerId: player.id,
        name: player.name,
        district: player.district || 'District open',
        sports: (player.sports || []).slice(0, 3),
        playStyle: player.playStyle || 'Balanced',
        availability: player.availability || 'Availability not set',
        fit: buildCompatibility(context.currentUser, player, { matches: context.matches || [] }),
        reliability: buildReliabilityScore(player)
    }))
    .sort((firstEntry, secondEntry) => secondEntry.fit.score - firstEntry.fit.score)
    .slice(0, 4)
    .map((entry, index) => ({
        ...entry,
        key: `PLAYER_${index + 1}`
    }));

const buildActionCatalog = (context = {}) => {
    const catalog = {
        OPEN_EXPLORE: {
            label: 'Open Explore',
            action: { type: 'navigate', page: 'explore', params: {} },
            description: 'Open venue and sport discovery.'
        },
        OPEN_DISCOVERY: {
            label: 'Discover Players',
            action: { type: 'navigate', page: 'friendsDiscover', params: {} },
            description: 'Open the player discovery area.'
        },
        OPEN_FRIENDS_HUB: {
            label: 'Open Friends Hub',
            action: { type: 'navigate', page: 'friendsHub', params: {} },
            description: 'Open the friends and squad dashboard.'
        },
        OPEN_CREATE_MATCH: {
            label: 'Create Match',
            action: { type: 'navigate', page: 'createMatch', params: {} },
            description: 'Start a fresh session setup.'
        },
        OPEN_BOOKING: {
            label: 'Join A Group',
            action: { type: 'navigate', page: 'booking', params: {} },
            description: 'Open booking and join-group flows.'
        }
    };

    (context.joinableMatches || []).forEach((match) => {
        catalog[`OPEN_${match.key}`] = {
            label: `Open ${match.sport}`,
            action: { type: 'navigate', page: 'matchDetail', params: { matchId: match.matchId } },
            description: `Open joinable match ${match.key}: ${match.sport} at ${match.time}, ${match.participantCount}/${match.totalSlots} players, ${match.venueName}.`
        };
    });

    (context.hostedMatches || []).forEach((match) => {
        catalog[`OPEN_${match.key}`] = {
            label: 'Open Lobby',
            action: { type: 'navigate', page: 'bookingLobbies', params: {} },
            description: `Open hosted match ${match.key}: ${match.sport} at ${match.time}, ${match.openSlots} slots still open.`
        };
    });

    (context.playerCandidates || []).forEach((player) => {
        catalog[`OPEN_${player.key}`] = {
            label: `View ${player.name}`,
            action: { type: 'navigate', page: 'playerProfile', params: { playerId: player.playerId } },
            description: `Open player ${player.key}: ${player.name}, ${player.fit.score}% fit, ${player.reliability} reliability, ${player.district}.`
        };
    });

    return catalog;
};

const buildPromptContext = (context = {}) => {
    const venuesById = (context.venues || []).reduce((accumulator, venue) => ({
        ...accumulator,
        [venue.id]: venue
    }), {});
    const livePlayerCandidates = rankLivePlayerOptions({
        currentUser: context.currentUser,
        users: context.socialUsers || context.users,
        preferredSport: context.upcomingMatch?.sport || context.currentUser?.sports?.[0] || '',
        district: context.currentUser?.district,
        includeOffline: false,
        limit: 4
    });
    const enrichedContext = {
        ...context,
        venuesById
    };
    const joinableMatches = buildJoinableMatches(enrichedContext);
    const hostedMatches = buildHostedMatches(enrichedContext);
    const playerCandidates = buildPlayerCandidates(enrichedContext);
    const venueOptions = (context.venues || [])
        .slice(0, 4)
        .map((venue, index) => ({
            key: `VENUE_${index + 1}`,
            venueId: venue.id,
            name: venue.name,
            location: venue.location,
            sport: venue.sport,
            availability: venue.availability,
            rating: venue.rating
        }));
    const liveSlotHighlights = (context.liveSlots || [])
        .filter((slot) => (slot.currentParticipantCount || slot.participantIds?.length || 0) < (slot.targetGroupSize || 4))
        .sort((firstSlot, secondSlot) => {
            const firstOpenSeats = (firstSlot.targetGroupSize || 4) - (firstSlot.currentParticipantCount || firstSlot.participantIds?.length || 0);
            const secondOpenSeats = (secondSlot.targetGroupSize || 4) - (secondSlot.currentParticipantCount || secondSlot.participantIds?.length || 0);

            return firstOpenSeats - secondOpenSeats;
        })
        .slice(0, 4)
        .map((slot) => ({
            slotId: slot.id,
            venueName: slot.venueName,
            sport: slot.sport,
            time: slot.time,
            date: slot.date,
            currentParticipantCount: slot.currentParticipantCount || slot.participantIds?.length || 0,
            targetGroupSize: slot.targetGroupSize || 4,
            district: slot.district
        }));
    const leaderboardHighlights = (context.weeklyLeaderboard?.entries || [])
        .slice(0, 3)
        .map((entry) => ({
            venueName: entry.venueName,
            time: entry.time,
            date: entry.date,
            demand: entry.offPeakOpportunityScore,
            playerCount: entry.currentParticipantCount,
            targetGroupSize: entry.targetGroupSize
        }));
    const actionCatalog = buildActionCatalog({
        ...enrichedContext,
        joinableMatches,
        hostedMatches,
        playerCandidates
    });

    return {
        summary: {
            currentView: context.currentView?.page || 'assistant',
            user: context.currentUser ? {
                name: context.currentUser.name,
                district: context.currentUser.district || 'District open',
                sports: context.currentUser.sports || [],
                playStyle: context.currentUser.playStyle || 'Balanced',
                friends: context.currentUser.friends?.length || 0
            } : null,
            upcomingMatch: context.upcomingMatch ? {
                sport: context.upcomingMatch.sport,
                date: context.upcomingMatch.date,
                time: context.upcomingMatch.time
            } : null,
            liveSignals: {
                onlinePlayers: Object.values(context.socialUsers || {}).filter((player) => String(player.liveStatus || '').toLowerCase() === 'online').length,
                liveOpenSlots: liveSlotHighlights.length,
                pendingRequests: (context.socialFriendRequests || []).length,
                district: context.currentUser?.district || 'Causeway Bay'
            },
            joinableMatches,
            hostedMatches,
            playerCandidates: playerCandidates.map((player) => ({
                key: player.key,
                name: player.name,
                district: player.district,
                sports: player.sports,
                playStyle: player.playStyle,
                availability: player.availability,
                fitScore: player.fit.score,
                fitReasons: player.fit.reasons,
                reliability: player.reliability
            })),
            livePlayerCandidates: livePlayerCandidates.map((player) => ({
                id: player.id,
                name: player.name,
                district: player.district,
                liveStatus: player.liveStatus,
                sports: player.sports || [],
                fitScore: player.fitScore,
                reasons: player.reasons,
                availability: player.availability
            })),
            venueOptions,
            liveSlotHighlights,
            leaderboardHighlights,
            availableActions: Object.entries(actionCatalog).map(([key, value]) => ({ key, description: value.description })),
            appBlueprint: buildAppBlueprint(context)
        },
        actionCatalog
    };
};

const buildHistory = (messages = []) => messages
    .filter((message) => message.type === 'user' || message.type === 'bot')
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => `${message.type === 'user' ? 'User' : 'Assistant'}: ${message.text}`)
    .join('\n');

const buildPrompt = (userInput, promptContext, historyText = '', responseStyle = RESPONSE_STYLES.balanced) => `You are the GoPlayHK Concierge.

Help with matchmaking, team completion, player discovery, venue choice, next-step planning, booking preparation, and app walkthrough questions.
Never invent players, sessions, venues, availability, confidence numbers, or booking confirmations.
Use only the provided context and available action keys.
Prefer joining existing viable groups before suggesting new sessions when supported by context.
When the user asks how to use the app, provide practical instructions that map to real sections from appBlueprint.
${buildResponseStyleInstructions(responseStyle)}
If the user asks for general sports advice, physical training, nutrition, or general conversational chat, answer logically and politely while staying within the target style.

Return valid JSON only with this shape:
{
    "answer": "string",
    "actionKeys": ["string"],
    "confidence": "high | medium | low",
    "focus": "join-group | fill-team | find-players | start-session | venue | booking-prep | general",
    "responseStyle": "concise | balanced | guided",
    "useFallback": boolean
}

Recent conversation:
${historyText || 'None'}

Context:
${JSON.stringify(promptContext.summary, null, 2)}

User message:
${userInput}`;

const parseJsonBlock = (rawText = '') => {
    const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fencedMatch?.[1] || rawText;
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        throw new Error('No JSON object found in AI response.');
    }

    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
};

const safeArray = (value) => Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry.trim()) : [];

const normalizeAssistantAiError = (error, preferredModelName = '') => {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    const resolvedModelName = getAssistantModelName(preferredModelName);

    if (code.includes('permission') || message.includes('permission')) {
        return 'Firebase AI Logic is being blocked by project permissions or App Check validation.';
    }

    if (message.includes('app check')) {
        return 'App Check is rejecting the AI request. Verify the deployed domain is registered for your current App Check configuration.';
    }

    if (message.includes('api key') || code.includes('api-key')) {
        return 'Firebase AI Logic could not access the Gemini Developer API for this Firebase project.';
    }

    if (message.includes('network') || code.includes('network')) {
        return 'Firebase AI Logic could not reach the network. Check connectivity, hosting CSP, and Google AI API access.';
    }

    if (message.includes('quota') || message.includes('rate')) {
        return 'Firebase AI Logic is temporarily rate limited for this project. Try again shortly.';
    }

    if (message.includes('billing') || message.includes('blaze')) {
        return 'The Firebase project needs the required Gemini APIs enabled and may require the Blaze plan.';
    }

    if (message.includes('model')) {
        return `The configured Gemini model "${resolvedModelName}" is not available for this project.`;
    }

    return 'Firebase AI Logic request failed. Verify Gemini Developer API onboarding, required APIs, and billing/project eligibility.';
};

const toAssistantReply = ({
    parsed,
    promptContext,
    fallbackReply,
    responseStyle = RESPONSE_STYLES.balanced,
    modelName = '',
    source = 'ai'
}) => {
    if (!parsed) {
        return fallbackReply;
    }

    const mappedActions = safeArray(parsed.actionKeys)
        .map((key) => promptContext.actionCatalog[key])
        .filter(Boolean)
        .slice(0, 4)
        .map((entry) => ({
            label: entry.label,
            action: entry.action
        }));

    return {
        intent: parsed.focus || 'general',
        text: typeof parsed.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : fallbackReply.text,
        actions: mappedActions.length > 0 ? mappedActions : fallbackReply.actions,
        draft: null,
        source,
        confidence: parsed.confidence || 'medium',
        responseStyle: parsed.responseStyle || responseStyle,
        modelName
    };
};

export const shouldUseAssistantAi = (rawInput = '', context = {}) => {
    const normalized = normalizeText(rawInput);

    if (!normalized || !context.currentUser) {
        return false;
    }

    if (normalized.length < 3) {
        return false;
    }

    if (ASSISTANT_AI_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
        return true;
    }

    return normalized.split(' ').length >= 2;
};

const shouldRetryWithFallbackModel = (error = {}) => {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();

    return (
        message.includes('model')
        || message.includes('quota')
        || message.includes('rate')
        || message.includes('permission')
        || message.includes('api key')
        || message.includes('not found')
        || code.includes('permission')
        || code.includes('quota')
        || code.includes('api-key')
        || code.includes('not-found')
    );
};

const buildModelCandidates = (preferredModelName = '', userId = '') => {
    const primaryModel = getAssistantModelName(preferredModelName, userId);
    const fallbackModel = getAssistantModelName(ASSISTANT_FALLBACK_MODEL_NAME, userId);

    if (primaryModel === fallbackModel) {
        return [primaryModel];
    }

    return [primaryModel, fallbackModel];
};

const buildGuidedFallbackReply = (fallbackReply = {}, responseStyle = RESPONSE_STYLES.balanced, modelName = '') => ({
    intent: fallbackReply.intent || 'general',
    text: fallbackReply.text || 'I can still help with booking, players, and venue actions.',
    actions: fallbackReply.actions || [],
    draft: fallbackReply.draft || null,
    source: 'guided',
    confidence: fallbackReply.confidence || 'medium',
    responseStyle,
    modelName
});

export const generateAssistantAiReply = async ({ rawInput, context, history = [], fallbackReply, preferredModelName = '' }) => {
    const userId = context.currentUser?.id || '';
    const promptContext = buildPromptContext(context);
    const responseStyle = detectResponseStyle(rawInput, fallbackReply);
    const historyText = buildHistory(history);
    const modelCandidates = buildModelCandidates(preferredModelName, userId);
    let lastError = null;

    for (let index = 0; index < modelCandidates.length; index += 1) {
        const modelName = modelCandidates[index];

        try {
            const model = await getAssistantModel(modelName, userId);
            const result = await model.generateContent(buildPrompt(rawInput, promptContext, historyText, responseStyle));
            const parsed = parseJsonBlock(result.response.text());

            if (parsed?.useFallback) {
                return buildGuidedFallbackReply(fallbackReply, responseStyle, modelName);
            }

            return toAssistantReply({
                parsed,
                promptContext,
                fallbackReply,
                responseStyle,
                modelName,
                source: index === 0 ? 'ai' : 'ai-fallback'
            });
        } catch (error) {
            lastError = error;
            const canRetry = index < modelCandidates.length - 1 && shouldRetryWithFallbackModel(error);

            if (!canRetry) {
                break;
            }
        }
    }

    const normalizedError = new Error(normalizeAssistantAiError(lastError, modelCandidates[0] || preferredModelName));
    normalizedError.cause = lastError;
    throw normalizedError;
};