import { getAssistantModelName, getFirebaseGenerativeModel } from '../config/firebaseAi';
import { createInitialMatchmakingState } from './matchmaking';

const MATCHMAKING_SCOPE = 'matchmaking';
const MATCHMAKING_SYSTEM_INSTRUCTION = 'You are the GoPlayHK Matchmaking Director. You may only rank and explain candidates already present in the provided candidate pool. Never invent players, venues, times, availability, fairness metrics, or outcomes. Respect hard constraints exactly. Optimize for fair, transparent, and balanced invitations. Return strict JSON only.';
const MATCHMAKING_TIMEOUT_MS = 6500;
const MAX_DECISION_LOG_ENTRIES = 8;
const DEFAULT_MATCHMAKING_MODEL = 'gemini-2.5-flash';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const parseJsonBlock = (rawText = '') => {
    const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fencedMatch?.[1] || rawText;
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        throw new Error('No JSON object found in Gemini matchmaking response.');
    }

    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
};

const safeArray = (value) => Array.isArray(value) ? value : [];

const dedupeIds = (ids = []) => {
    const seen = new Set();

    return ids.filter((id) => {
        if (!id || seen.has(id)) {
            return false;
        }

        seen.add(id);
        return true;
    });
};

const buildStatus = ({ enabled, openSlots, suggestions = [] }) => {
    if (!enabled) {
        return 'manual';
    }

    if (openSlots === 0) {
        return 'filled';
    }

    if (suggestions.some((candidate) => candidate.status === 'invited')) {
        return 'searching';
    }

    if (suggestions.some((candidate) => candidate.status === 'queued')) {
        return 'ready';
    }

    return 'manual-review';
};

const buildConfidenceFromSuggestions = (suggestions = []) => {
    if (!suggestions.length) {
        return 0;
    }

    const topSuggestions = suggestions.slice(0, Math.min(suggestions.length, 3));
    return Math.round(topSuggestions.reduce((total, candidate) => total + (candidate.score || 0), 0) / topSuggestions.length);
};

const appendDecisionLog = (matchmaking = {}, entry) => ([
    ...(matchmaking.decisionLog || []),
    entry
]).slice(-MAX_DECISION_LOG_ENTRIES);

const buildDecisionEntry = ({
    phase,
    source,
    summary,
    confidence,
    modelName = '',
    selectedUserIds = [],
    guardrailNotes = [],
    fallbackReason = ''
}) => ({
    phase,
    source,
    summary,
    confidence,
    modelName,
    selectedUserIds,
    guardrailNotes,
    fallbackReason,
    createdAt: new Date().toISOString()
});

const buildDecisionMeta = ({
    phase,
    source,
    modelName = '',
    fallbackReason = '',
    guardrailNotes = [],
    summary = ''
}) => ({
    phase,
    source,
    modelName,
    fallbackReason,
    guardrailNotes,
    summary,
    updatedAt: new Date().toISOString()
});

const annotateDeterministicPreview = (matchmakingState, fallbackReason = '') => ({
    ...matchmakingState,
    fitSummary: fallbackReason
        ? `${matchmakingState.fitSummary} Fallback: ${fallbackReason}`
        : matchmakingState.fitSummary,
    decisionMeta: buildDecisionMeta({
        phase: 'preview',
        source: 'deterministic',
        fallbackReason,
        summary: matchmakingState.fitSummary
    }),
    decisionLog: appendDecisionLog(matchmakingState, buildDecisionEntry({
        phase: 'preview',
        source: 'deterministic',
        summary: matchmakingState.fitSummary,
        confidence: matchmakingState.confidence || 0,
        fallbackReason
    }))
});

const annotateDeterministicWave = ({ updatedMatch, joinedUserIds = [], fallbackReason = '' }) => {
    const nextMatchmaking = updatedMatch.matchmaking || {};
    const summary = fallbackReason
        ? `${nextMatchmaking.fitSummary || 'Deterministic matchmaking wave executed.'} Fallback: ${fallbackReason}`
        : (nextMatchmaking.fitSummary || 'Deterministic matchmaking wave executed.');

    return {
        updatedMatch: {
            ...updatedMatch,
            matchmaking: {
                ...nextMatchmaking,
                fitSummary: summary,
                decisionMeta: buildDecisionMeta({
                    phase: 'wave',
                    source: 'deterministic',
                    fallbackReason,
                    summary
                }),
                decisionLog: appendDecisionLog(nextMatchmaking, buildDecisionEntry({
                    phase: 'wave',
                    source: 'deterministic',
                    summary,
                    confidence: nextMatchmaking.confidence || 0,
                    fallbackReason,
                    selectedUserIds: joinedUserIds
                }))
            }
        },
        joinedUserIds,
        notifications: joinedUserIds.map((userId, index) => ({
            id: `${Date.now()}-${index}`,
            text: `Gemini fallback still filled a slot with ${userId}.`,
            time: 'Now',
            read: false,
            type: 'ai_match_fallback_join',
            matchId: updatedMatch.id
        }))
    };
};

const normalizeDecisionConfidence = (value, fallbackValue) => {
    const parsed = Number.parseInt(value, 10);

    if (Number.isNaN(parsed)) {
        return fallbackValue;
    }

    return clamp(parsed, 0, 99);
};

const buildAllowedCandidateLookup = (suggestions = []) => suggestions.reduce((lookup, candidate) => ({
    ...lookup,
    [candidate.userId]: candidate
}), {});

const buildRankedIds = ({ suggestions = [], selectedUserIds = [], rankedCandidates = [] }) => {
    const allowedLookup = buildAllowedCandidateLookup(suggestions);
    const suggestedIds = suggestions.map((candidate) => candidate.userId);
    const aiRankedIds = safeArray(rankedCandidates)
        .map((candidate) => String(candidate?.userId || '').trim())
        .filter((userId) => allowedLookup[userId]);
    const preferredIds = safeArray(selectedUserIds)
        .map((userId) => String(userId || '').trim())
        .filter((userId) => allowedLookup[userId]);

    return dedupeIds([...preferredIds, ...aiRankedIds, ...suggestedIds]);
};

const buildReasonLookup = (rankedCandidates = []) => safeArray(rankedCandidates).reduce((lookup, candidate) => {
    const userId = String(candidate?.userId || '').trim();

    if (!userId) {
        return lookup;
    }

    return {
        ...lookup,
        [userId]: typeof candidate.reason === 'string' && candidate.reason.trim()
            ? candidate.reason.trim()
            : ''
    };
}, {});

export const applyGeminiPreviewDecision = ({ baseState, decision, modelName = '' }) => {
    const rankedIds = buildRankedIds({
        suggestions: baseState.suggestions,
        selectedUserIds: decision.selectedUserIds,
        rankedCandidates: decision.rankedCandidates
    });

    if (!rankedIds.length) {
        throw new Error('Gemini preview decision did not include any valid candidate IDs.');
    }

    const candidateLookup = buildAllowedCandidateLookup(baseState.suggestions);
    const reasonLookup = buildReasonLookup(decision.rankedCandidates);
    const invitedCount = Math.min(2, Math.max(baseState.openSlots || 0, 0));
    const suggestions = rankedIds.map((userId, index) => {
        const existingCandidate = candidateLookup[userId];
        const aiReason = reasonLookup[userId];

        return {
            ...existingCandidate,
            status: index < invitedCount ? 'invited' : 'queued',
            reasons: aiReason
                ? [aiReason, ...(existingCandidate.reasons || []).filter((reason) => reason !== aiReason)].slice(0, 4)
                : existingCandidate.reasons,
            aiReason: aiReason || existingCandidate.aiReason || ''
        };
    });
    const summary = typeof decision.summary === 'string' && decision.summary.trim()
        ? decision.summary.trim()
        : baseState.fitSummary;
    const confidence = normalizeDecisionConfidence(decision.confidence, buildConfidenceFromSuggestions(suggestions));

    return {
        ...baseState,
        suggestions,
        confidence,
        fitSummary: summary,
        status: buildStatus({ enabled: baseState.enabled, openSlots: baseState.openSlots, suggestions }),
        decisionMeta: buildDecisionMeta({
            phase: 'preview',
            source: 'gemini',
            modelName,
            guardrailNotes: safeArray(decision.guardrailNotes),
            summary
        }),
        decisionLog: appendDecisionLog(baseState, buildDecisionEntry({
            phase: 'preview',
            source: 'gemini',
            summary,
            confidence,
            modelName,
            selectedUserIds: rankedIds.slice(0, Math.max(baseState.openSlots || 0, 0)),
            guardrailNotes: safeArray(decision.guardrailNotes)
        }))
    };
};

const buildWaveCandidatePool = (match) => (match.matchmaking?.suggestions || []).filter((candidate) => (
    candidate.status === 'queued' || candidate.status === 'invited'
));

const runDeterministicWave = (match) => {
    if (!match?.matchmaking?.enabled) {
        return { updatedMatch: match, joinedUserIds: [] };
    }

    let inviteWave = match.matchmaking.inviteWave || 1;
    let suggestions = [...(match.matchmaking.suggestions || [])];
    let participants = [...match.participants];
    const joinedUserIds = [];

    if (participants.length >= match.totalSlots) {
        return { updatedMatch: match, joinedUserIds };
    }

    if (!suggestions.some((candidate) => candidate.status === 'invited')) {
        let invitedCount = 0;

        suggestions = suggestions.map((candidate) => {
            if (candidate.status === 'queued' && invitedCount < 2) {
                invitedCount += 1;
                return { ...candidate, status: 'invited' };
            }

            return candidate;
        });

        if (invitedCount > 0) {
            inviteWave += 1;
        }
    }

    const nextCandidate = suggestions.find((candidate) => (
        candidate.status === 'invited' && !participants.includes(candidate.userId)
    ));

    if (nextCandidate && participants.length < match.totalSlots) {
        participants = [...participants, nextCandidate.userId];
        joinedUserIds.push(nextCandidate.userId);
        suggestions = suggestions.map((candidate) => (
            candidate.userId === nextCandidate.userId
                ? { ...candidate, status: 'joined' }
                : candidate
        ));
    }

    const openSlots = Math.max(match.totalSlots - participants.length, 0);

    return {
        updatedMatch: {
            ...match,
            participants,
            matchmaking: {
                ...match.matchmaking,
                suggestions,
                inviteWave,
                openSlots,
                confidence: buildConfidenceFromSuggestions(suggestions),
                status: buildStatus({ enabled: match.matchmaking.enabled, openSlots, suggestions }),
                lastRunLabel: 'Deterministic fallback just now'
            }
        },
        joinedUserIds
    };
};

export const applyGeminiWaveDecision = ({ match, decision, modelName = '' }) => {
    const matchmaking = match.matchmaking || {};
    const waveCandidates = buildWaveCandidatePool(match);
    const rankedIds = buildRankedIds({
        suggestions: waveCandidates,
        selectedUserIds: decision.selectedUserIds,
        rankedCandidates: decision.rankedCandidates
    });
    const candidateLookup = buildAllowedCandidateLookup(matchmaking.suggestions || []);
    const selectedInviteIds = decision.shouldPauseInvites
        ? []
        : rankedIds.slice(0, Math.min(Math.max(matchmaking.openSlots || 0, 0), 2));
    const joinedUserIds = [];
    const nextParticipants = [...match.participants];
    const joinCandidateId = selectedInviteIds[0];

    if (joinCandidateId && !nextParticipants.includes(joinCandidateId) && nextParticipants.length < match.totalSlots) {
        nextParticipants.push(joinCandidateId);
        joinedUserIds.push(joinCandidateId);
    }

    const reasonLookup = buildReasonLookup(decision.rankedCandidates);
    const untouchedCandidates = (matchmaking.suggestions || []).filter((candidate) => candidate.status === 'joined' || nextParticipants.includes(candidate.userId));
    const pendingSuggestions = rankedIds.map((userId, index) => {
        const existingCandidate = candidateLookup[userId];
        const aiReason = reasonLookup[userId];

        if (!existingCandidate || nextParticipants.includes(userId)) {
            return null;
        }

        return {
            ...existingCandidate,
            status: selectedInviteIds.slice(1).includes(userId) ? 'invited' : 'queued',
            reasons: aiReason
                ? [aiReason, ...(existingCandidate.reasons || []).filter((reason) => reason !== aiReason)].slice(0, 4)
                : existingCandidate.reasons,
            aiReason: aiReason || existingCandidate.aiReason || '',
            rank: index + 1
        };
    }).filter(Boolean);
    const joinedSuggestions = (matchmaking.suggestions || []).map((candidate) => (
        nextParticipants.includes(candidate.userId)
            ? { ...candidate, status: 'joined' }
            : candidate
    )).filter((candidate) => candidate.status === 'joined');
    const seenIds = new Set(joinedSuggestions.map((candidate) => candidate.userId));
    const mergedJoinedSuggestions = [...joinedSuggestions, ...untouchedCandidates.filter((candidate) => !seenIds.has(candidate.userId))];
    const suggestions = [...mergedJoinedSuggestions, ...pendingSuggestions];
    const openSlots = Math.max(match.totalSlots - nextParticipants.length, 0);
    const summary = typeof decision.summary === 'string' && decision.summary.trim()
        ? decision.summary.trim()
        : (matchmaking.fitSummary || 'Gemini wave updated the candidate order.');
    const confidence = normalizeDecisionConfidence(decision.confidence, buildConfidenceFromSuggestions(suggestions));
    const nextMatchmaking = {
        ...matchmaking,
        suggestions,
        confidence,
        openSlots,
        inviteWave: (matchmaking.inviteWave || 1) + (selectedInviteIds.length > 0 ? 1 : 0),
        status: buildStatus({ enabled: matchmaking.enabled, openSlots, suggestions }),
        fitSummary: summary,
        lastRunLabel: selectedInviteIds.length > 0 ? 'Gemini wave just now' : 'Gemini paused invites',
        decisionMeta: buildDecisionMeta({
            phase: 'wave',
            source: 'gemini',
            modelName,
            guardrailNotes: safeArray(decision.guardrailNotes),
            summary
        })
    };

    nextMatchmaking.decisionLog = appendDecisionLog(matchmaking, buildDecisionEntry({
        phase: 'wave',
        source: 'gemini',
        summary,
        confidence,
        modelName,
        selectedUserIds: selectedInviteIds,
        guardrailNotes: safeArray(decision.guardrailNotes)
    }));

    return {
        updatedMatch: {
            ...match,
            participants: nextParticipants,
            matchmaking: nextMatchmaking
        },
        joinedUserIds,
        notifications: joinedUserIds.map((userId, index) => ({
            id: `${Date.now()}-${index}`,
            text: `${userId} accepted your Gemini matchmaking invitation.`,
            time: 'Now',
            read: false,
            type: 'ai_match_join',
            matchId: match.id
        }))
    };
};

const buildPrompt = ({ phase, promptContext }) => `Return valid JSON only with this shape:
{
  "summary": "string",
  "confidence": 0,
  "selectedUserIds": ["string"],
  "rankedCandidates": [
    {
      "userId": "string",
      "reason": "string"
    }
  ],
  "shouldPauseInvites": false,
  "guardrailNotes": ["string"]
}

Phase: ${phase}

Hard constraints:
- Only use candidate IDs already present in the pool.
- Never invent IDs.
- Never exceed open slots.
- Respect locked players, current participants, and availability context already summarized.
- Prefer fair, balanced squads over only maximizing raw strength.

Context:
${JSON.stringify(promptContext, null, 2)}`;

const buildPreviewPromptContext = ({
    currentUser,
    venue,
    sport,
    date,
    time,
    totalSlots,
    selectedPlayerIds,
    playStyle,
    inclusionFocus,
    baseState,
    users = {}
}) => ({
    currentUser: {
        id: currentUser.id,
        name: currentUser.name,
        district: currentUser.district || '',
        sports: currentUser.sports || [],
        playStyle: currentUser.playStyle || 'Balanced'
    },
    session: {
        sport,
        date,
        time,
        totalSlots,
        venue: venue ? {
            id: venue.id,
            name: venue.name,
            district: venue.location || '',
            sport: venue.sport || sport
        } : null,
        playStyle,
        inclusionFocus,
        lockedPlayerIds: selectedPlayerIds,
        openSlots: baseState.openSlots
    },
    candidates: (baseState.suggestions || []).map((candidate) => ({
        userId: candidate.userId,
        name: users[candidate.userId]?.name || candidate.name,
        district: candidate.district,
        availability: candidate.availability,
        sports: candidate.sports,
        baselineScore: candidate.score,
        reliability: candidate.reliability,
        compatibilityScore: candidate.compatibilityScore,
        squadScore: candidate.squadScore,
        reasons: candidate.reasons
    }))
});

const buildWavePromptContext = ({ match, users = {} }) => ({
    match: {
        id: match.id,
        sport: match.sport,
        date: match.date,
        time: match.time,
        totalSlots: match.totalSlots,
        openSlots: match.matchmaking?.openSlots || Math.max(match.totalSlots - match.participants.length, 0),
        inviteWave: match.matchmaking?.inviteWave || 1,
        preferences: match.matchmaking?.preferences || {},
        currentParticipants: match.participants.map((userId) => ({
            userId,
            name: users[userId]?.name || userId,
            district: users[userId]?.district || '',
            sports: users[userId]?.sports || [],
            playStyle: users[userId]?.playStyle || ''
        }))
    },
    candidates: buildWaveCandidatePool(match).map((candidate) => ({
        userId: candidate.userId,
        name: users[candidate.userId]?.name || candidate.name,
        status: candidate.status,
        district: candidate.district,
        availability: candidate.availability,
        sports: candidate.sports,
        baselineScore: candidate.score,
        reliability: candidate.reliability,
        compatibilityScore: candidate.compatibilityScore,
        squadScore: candidate.squadScore,
        reasons: candidate.reasons
    }))
});

const withTimeout = async (promise, timeoutMs = MATCHMAKING_TIMEOUT_MS) => {
    let timeoutId;

    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeoutId = globalThis.setTimeout(() => {
                    reject(new Error('Gemini matchmaking timed out.'));
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timeoutId) {
            globalThis.clearTimeout(timeoutId);
        }
    }
};

export const normalizeMatchmakingAiError = (error, preferredModelName = '') => {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    const resolvedModelName = getAssistantModelName(preferredModelName);

    if (message.includes('timed out')) {
        return 'Gemini matchmaking timed out before a safe decision was returned.';
    }

    if (code.includes('permission') || message.includes('permission')) {
        return 'Gemini matchmaking is blocked by Firebase AI Logic permissions or App Check validation.';
    }

    if (message.includes('app check')) {
        return 'App Check rejected the Gemini matchmaking request.';
    }

    if (message.includes('quota') || message.includes('rate')) {
        return 'Gemini matchmaking is rate limited for this Firebase project right now.';
    }

    if (message.includes('billing') || message.includes('blaze')) {
        return 'Gemini matchmaking needs the required Firebase AI billing or APIs enabled.';
    }

    if (message.includes('model')) {
        return `The configured Gemini matchmaking model "${resolvedModelName}" is not available for this project.`;
    }

    return 'Gemini matchmaking request failed, so the deterministic matcher stayed in control.';
};

const requestGeminiDecision = async ({ phase, promptContext, preferredModelName = '', userId = '' }) => {
    const model = await getFirebaseGenerativeModel({
        scope: MATCHMAKING_SCOPE,
        preferredModelName: preferredModelName || DEFAULT_MATCHMAKING_MODEL,
        userId,
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 700
        },
        systemInstruction: MATCHMAKING_SYSTEM_INSTRUCTION
    });
    const result = await withTimeout(model.generateContent(buildPrompt({ phase, promptContext })));
    return parseJsonBlock(result.response.text());
};

export const createGeminiMatchmakingState = async ({
    preferredModelName = '',
    ...input
} = {}) => {
    const baseState = createInitialMatchmakingState(input);

    if (!baseState.enabled || baseState.suggestions.length === 0) {
        return annotateDeterministicPreview(baseState, baseState.enabled ? '' : 'Manual mode is active.');
    }

    try {
        const decision = await requestGeminiDecision({
            phase: 'preview',
            promptContext: buildPreviewPromptContext({ ...input, baseState }),
            preferredModelName,
            userId: input.currentUser?.id || ''
        });

        return applyGeminiPreviewDecision({
            baseState,
            decision,
            modelName: getAssistantModelName(preferredModelName || DEFAULT_MATCHMAKING_MODEL, input.currentUser?.id || '')
        });
    } catch (error) {
        return annotateDeterministicPreview(baseState, normalizeMatchmakingAiError(error, preferredModelName));
    }
};

export const runGeminiMatchmakingWave = async ({ match, users = {}, preferredModelName = '' } = {}) => {
    if (!match?.matchmaking?.enabled) {
        return annotateDeterministicWave({ updatedMatch: match, joinedUserIds: [], fallbackReason: 'Manual mode is active.' });
    }

    const pendingCandidates = buildWaveCandidatePool(match);

    if (pendingCandidates.length === 0 || (match.matchmaking?.openSlots || 0) === 0) {
        return annotateDeterministicWave({ updatedMatch: match, joinedUserIds: [], fallbackReason: 'No eligible candidates remain for this wave.' });
    }

    try {
        const decision = await requestGeminiDecision({
            phase: 'wave',
            promptContext: buildWavePromptContext({ match, users }),
            preferredModelName,
            userId: match.creatorId || ''
        });

        return applyGeminiWaveDecision({
            match,
            decision,
            modelName: getAssistantModelName(preferredModelName || DEFAULT_MATCHMAKING_MODEL, match.creatorId || '')
        });
    } catch (error) {
        const fallback = runDeterministicWave(match);
        return annotateDeterministicWave({
            updatedMatch: fallback.updatedMatch,
            joinedUserIds: fallback.joinedUserIds,
            fallbackReason: normalizeMatchmakingAiError(error, preferredModelName)
        });
    }
};