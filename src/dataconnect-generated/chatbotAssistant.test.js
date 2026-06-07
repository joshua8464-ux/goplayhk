import { describe, it, expect } from 'vitest';
import { buildAssistantReply, buildBookingDraft, quickActions } from './chatbotAssistant';

const baseContext = {
    currentUser: {
        id: 'u1',
        name: 'You'
    },
    upcomingMatch: {
        id: 'm-test',
        sport: 'Basketball',
        venueId: 'v-test',
        date: '2026-04-01',
        time: '18:00',
        status: 'upcoming'
    },
    recommendedVenue: {
        id: 'v-test',
        name: 'Harbour Arena',
        location: 'Causeway Bay',
        sport: 'Basketball',
        availability: 'Open',
        price: 80
    },
    venues: [
        {
            id: 'v-test',
            name: 'Harbour Arena',
            location: 'Causeway Bay',
            sport: 'Basketball',
            availability: 'Open',
            price: 80,
            rating: 4.7
        },
        {
            id: 'v-tennis',
            name: 'Victoria Park',
            location: 'Causeway Bay',
            sport: 'Tennis',
            availability: 'Open',
            price: 60,
            rating: 4.8
        }
    ],
    currentView: { page: 'home' },
    currentUserId: 'u1'
};

describe('buildAssistantReply', () => {
    it('returns a navigation action for the next session intent', () => {
        const reply = buildAssistantReply('Tell me my next session', baseContext);
        const hasMatchAction = reply.actions.some(action => action.action?.page === 'matchDetail');
        expect(hasMatchAction).toBe(true);
    });

    it('keeps fallback quick actions when intent is unclear', () => {
        const reply = buildAssistantReply('Show me something random', baseContext);
        expect(reply.actions.length).toBeGreaterThan(0);
        const firstAction = reply.actions[0];
        expect(firstAction.action.type).toBe('prompt');
        expect(quickActions.map(item => item.label)).toContain(firstAction.label);
    });

    it('references the recommended venue in venue-focused intents', () => {
        const reply = buildAssistantReply('Show me a venue', baseContext);
        expect(reply.text).toContain(baseContext.recommendedVenue.name);
    });

    it('builds a direct booking draft from plain language', () => {
        const draft = buildBookingDraft('Book me a tennis court tomorrow at 6pm in Causeway Bay', baseContext);
        expect(draft.sport).toBe('Tennis');
        expect(draft.district).toBe('Causeway Bay');
        expect(draft.time).toBe('18:00');
        expect(draft.venue?.name).toBe('Victoria Park');
    });

    it('returns booking actions that open a filled reservation draft', () => {
        const reply = buildAssistantReply('Book tennis tomorrow at 6pm in Causeway Bay', baseContext);
        expect(reply.intent).toBe('booking');
        expect(reply.draft?.sport).toBe('Tennis');
        expect(reply.draft?.checkpoints).toHaveLength(4);
        expect(reply.draft?.readyToReserve).toBe(true);
        const reviewAction = reply.actions.find((action) => action.action?.type === 'booking-review');
        expect(reviewAction?.label).toBe('Open Booking Confirmation');
        const openDraftAction = reply.actions.find((action) => action.label === 'Open Reservation Draft');
        expect(openDraftAction?.action?.page).toBe('createMatch');
        expect(openDraftAction?.action?.params?.presetSport).toBe('Tennis');
        expect(openDraftAction?.action?.params?.presetTime).toBe('18:00');
    });

    it('marks incomplete booking drafts as not ready to reserve', () => {
        const reply = buildAssistantReply('Book tennis in Causeway Bay', baseContext);
        expect(reply.intent).toBe('booking');
        expect(reply.draft?.readyToReserve).toBe(false);
        expect(reply.draft?.missing).toContain('date');
        expect(reply.text).toContain('When do you want to play?');
    });

    it('continues a booking draft across follow-up answers', () => {
        const firstReply = buildAssistantReply('Book tennis in Causeway Bay', baseContext);
        const secondReply = buildAssistantReply('tomorrow', {
            ...baseContext,
            bookingDraft: firstReply.draft
        });
        const tomorrow = new Date();
        tomorrow.setHours(0, 0, 0, 0);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const expectedSuggestedTime = [0, 6].includes(tomorrow.getDay()) ? '09:00' : '18:00';

        expect(secondReply.intent).toBe('booking');
        expect(secondReply.draft?.readyToReserve).toBe(true);
        expect(secondReply.draft?.date).toBeTruthy();
        expect(secondReply.draft?.time).toBe(expectedSuggestedTime);
    });

    it('routes rewards requests into the clubs hub rewards tab', () => {
        const reply = buildAssistantReply('Show my rewards', baseContext);
        const rewardsAction = reply.actions.find((action) => action.label === 'Open Rewards');
        expect(rewardsAction?.action?.page).toBe('clubs');
        expect(rewardsAction?.action?.params?.tab).toBe('rewards');
    });
});
