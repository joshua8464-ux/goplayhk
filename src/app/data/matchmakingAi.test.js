import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../config/firebaseAi', () => ({
    getAssistantModelName: (preferredModelName = '') => preferredModelName || 'gemini-2.5-flash',
    getFirebaseGenerativeModel: vi.fn()
}));

let applyGeminiPreviewDecision;
let applyGeminiWaveDecision;

beforeAll(async () => {
    const module = await import('./matchmakingAi');
    applyGeminiPreviewDecision = module.applyGeminiPreviewDecision;
    applyGeminiWaveDecision = module.applyGeminiWaveDecision;
});

const basePreviewState = {
    enabled: true,
    status: 'searching',
    confidence: 81,
    fitSummary: 'Deterministic preview summary.',
    inviteWave: 1,
    openSlots: 2,
    preferences: { playStyle: 'Balanced', inclusionFocus: 'Open to All' },
    suggestions: [
        {
            userId: 'u2',
            name: 'Alex',
            score: 84,
            reasons: ['same district', '84 reliability'],
            reliability: 84,
            compatibilityScore: 82,
            squadScore: 76,
            district: 'Causeway Bay',
            availability: 'Evenings',
            sports: ['Tennis'],
            status: 'invited'
        },
        {
            userId: 'u3',
            name: 'Jamie',
            score: 80,
            reasons: ['schedule aligned', '80 reliability'],
            reliability: 80,
            compatibilityScore: 78,
            squadScore: 74,
            district: 'Kowloon City',
            availability: 'Evenings',
            sports: ['Tennis'],
            status: 'invited'
        },
        {
            userId: 'u4',
            name: 'Taylor',
            score: 75,
            reasons: ['shared sessions', '78 reliability'],
            reliability: 78,
            compatibilityScore: 73,
            squadScore: 70,
            district: 'Tsim Sha Tsui',
            availability: 'Weekends',
            sports: ['Tennis'],
            status: 'queued'
        }
    ]
};

describe('applyGeminiPreviewDecision', () => {
    it('reorders deterministic suggestions using valid Gemini candidate IDs', () => {
        const updated = applyGeminiPreviewDecision({
            baseState: basePreviewState,
            modelName: 'gemini-2.5-flash',
            decision: {
                summary: 'Gemini prefers Jamie first for schedule stability.',
                confidence: 88,
                selectedUserIds: ['u3', 'u4'],
                rankedCandidates: [
                    { userId: 'u3', reason: 'Best timing overlap with the locked group.' },
                    { userId: 'u4', reason: 'Strong shared-session history.' },
                    { userId: 'u2', reason: 'Reliable fallback option.' }
                ],
                shouldPauseInvites: false,
                guardrailNotes: ['Stayed inside deterministic pool.']
            }
        });

        expect(updated.suggestions[0].userId).toBe('u3');
        expect(updated.suggestions[1].userId).toBe('u4');
        expect(updated.suggestions[0].status).toBe('invited');
        expect(updated.suggestions[2].status).toBe('queued');
        expect(updated.fitSummary).toContain('Gemini prefers Jamie first');
        expect(updated.decisionMeta?.source).toBe('gemini');
    });
});

describe('applyGeminiWaveDecision', () => {
    it('joins the top Gemini-selected player and invites the second one', () => {
        const match = {
            id: 'm1',
            creatorId: 'u1',
            sport: 'Tennis',
            date: '2026-04-02',
            time: '18:00',
            totalSlots: 4,
            participants: ['u1', 'u5'],
            matchmaking: {
                ...basePreviewState,
                openSlots: 2,
                suggestions: [
                    { ...basePreviewState.suggestions[0], status: 'queued' },
                    { ...basePreviewState.suggestions[1], status: 'queued' },
                    { ...basePreviewState.suggestions[2], status: 'queued' }
                ]
            }
        };

        const result = applyGeminiWaveDecision({
            match,
            modelName: 'gemini-2.5-flash',
            decision: {
                summary: 'Invite Alex and Jamie next to keep the group balanced.',
                confidence: 86,
                selectedUserIds: ['u2', 'u3'],
                rankedCandidates: [
                    { userId: 'u2', reason: 'Closest district fit.' },
                    { userId: 'u3', reason: 'Best schedule backup.' },
                    { userId: 'u4', reason: 'Lower priority this wave.' }
                ],
                shouldPauseInvites: false,
                guardrailNotes: ['Kept invitations within 2 open slots.']
            }
        });

        expect(result.updatedMatch.participants).toContain('u2');
        expect(result.joinedUserIds).toEqual(['u2']);
        expect(result.updatedMatch.matchmaking.suggestions.find((candidate) => candidate.userId === 'u3')?.status).toBe('invited');
        expect(result.updatedMatch.matchmaking.decisionMeta?.source).toBe('gemini');
    });
});