const quickActions = [
    {
        id: 'join-group',
        label: 'Join A Group',
        prompt: 'Find a group I can join right now',
        description: 'Open matches first.'
    },
    {
        id: 'fill-team',
        label: 'Fill My Team',
        prompt: 'Help me fill my group with the best possible players',
        description: 'Complete my lineup.'
    },
    {
        id: 'find-players',
        label: 'Find Players',
        prompt: 'Help me find compatible teammates nearby',
        description: 'Show best nearby fits.'
    },
    {
        id: 'next-session',
        label: 'My Next Session',
        prompt: 'What is my next session?',
        description: 'See what is booked.'
    },
    {
        id: 'start-session',
        label: 'Start A Session',
        prompt: 'Start a new badminton session in Tseung Kwan O',
        description: 'Build from scratch.'
    },
    {
        id: 'plan-route',
        label: 'Plan A Route',
        prompt: 'Show me the best route to a venue',
        description: 'Open directions.'
    }
];

const quickActionSuggestions = quickActions.slice(0, 4).map((entry) => ({
    label: entry.label,
    action: { type: 'prompt', prompt: entry.prompt }
}));

const viewLabels = {
    home: 'home hub',
    clubs: 'clubs hub',
    explore: 'venue explorer',
    booking: 'booking flow',
    bookingLobbies: 'lobby dashboard',
    rewards: 'rewards board',
    friendsHub: 'friends hub',
    assistant: 'assistant panel'
};

const sportAliases = {
    tennis: 'Tennis',
    basketball: 'Basketball',
    badminton: 'Badminton',
    football: 'Football',
    soccer: 'Football',
    swimming: 'Swimming',
    swim: 'Swimming',
    rugby: 'Rugby',
    volleyball: 'Volleyball',
    athletics: 'Athletics',
    running: 'Running',
    run: 'Running',
    hiking: 'Hiking',
    hike: 'Hiking',
    cycling: 'Cycling',
    biking: 'Cycling',
    golf: 'Golf',
    'horse racing': 'Horse Racing',
    racing: 'Horse Racing',
    court: '',
    courts: ''
};

const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const bookingKeywords = ['book', 'reserve', 'court', 'courts', 'slot', 'game'];

const describeView = (view = {}) => viewLabels[view.page] || 'current screen';

const toCurrencyLabel = (amount) => (Number.isFinite(amount) ? `HKD ${amount}` : 'HKD');

const normalizeText = (value = '') => value.toLowerCase().replace(/[^a-z0-9: ]+/g, ' ').replace(/\s+/g, ' ').trim();

const buildAvailabilitySnapshot = (venues = []) => {
    const openVenue = venues.find((venue) => venue.availability === 'Open') || venues[0] || null;
    const cheapestVenue = [...venues].sort((first, second) => first.price - second.price)[0] || null;

    return { openVenue, cheapestVenue };
};

const navigationAction = (label, page, params = {}) => ({
    label,
    action: { type: 'navigate', page, params }
});

const promptAction = (label, prompt) => ({
    label,
    action: { type: 'prompt', prompt }
});

const addDays = (date, offset) => {
    const nextDate = new Date(date);
    nextDate.setHours(0, 0, 0, 0);
    nextDate.setDate(nextDate.getDate() + offset);
    return nextDate;
};

const toIsoDate = (date) => date.toISOString().slice(0, 10);

const formatBookingTime = (time = '') => {
    if (!time) {
        return 'flexible time';
    }

    const [hourString, minuteString = '00'] = time.split(':');
    const hour = Number.parseInt(hourString, 10);

    if (Number.isNaN(hour)) {
        return time;
    }

    const suffix = hour >= 12 ? 'PM' : 'AM';
    const normalizedHour = hour % 12 || 12;
    return `${normalizedHour}:${minuteString} ${suffix}`;
};

const formatBookingDate = (date = '') => {
    if (!date) {
        return 'a flexible date';
    }

    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
        return date;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = addDays(today, 1);
    if (toIsoDate(parsedDate) === toIsoDate(today)) {
        return 'today';
    }

    if (toIsoDate(parsedDate) === toIsoDate(tomorrow)) {
        return 'tomorrow';
    }

    return parsedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const detectSport = (normalizedInput, venues = []) => {
    const uniqueSports = [...new Set(venues.map((venue) => venue.sport).filter(Boolean))];
    const matchedSport = uniqueSports.find((sport) => normalizedInput.includes(sport.toLowerCase()));

    if (matchedSport) {
        return matchedSport;
    }

    const aliasEntry = Object.entries(sportAliases).find(([alias, value]) => value && normalizedInput.includes(alias));
    return aliasEntry?.[1] || '';
};

const detectDistrict = (normalizedInput, venues = []) => {
    const districts = [...new Set(venues.map((venue) => venue.location).filter(Boolean))]
        .sort((first, second) => second.length - first.length);

    const match = districts.find((district) => normalizedInput.includes(district.toLowerCase()));
    return match || '';
};

const detectVenue = (normalizedInput, venues = []) => {
    const candidates = [...venues].sort((first, second) => second.name.length - first.name.length);
    return candidates.find((venue) => normalizedInput.includes(venue.name.toLowerCase())) || null;
};

const detectPlayerCount = (normalizedInput) => {
    const playerMatch = normalizedInput.match(/(?:for|with)\s+(\d{1,2})\b|\b(\d{1,2})\s+(?:players|people|friends|slots)\b/);
    const value = Number.parseInt(playerMatch?.[1] || playerMatch?.[2] || '', 10);
    return Number.isFinite(value) ? value : null;
};

const parseTimeMatch = (hours, minutes = '00', meridiem = '') => {
    const parsedHours = Number.parseInt(hours, 10);
    const parsedMinutes = Number.parseInt(minutes, 10);

    if (Number.isNaN(parsedHours) || Number.isNaN(parsedMinutes) || parsedHours > 23 || parsedMinutes > 59) {
        return '';
    }

    let normalizedHours = parsedHours;

    if (meridiem === 'pm' && parsedHours < 12) {
        normalizedHours += 12;
    }

    if (meridiem === 'am' && parsedHours === 12) {
        normalizedHours = 0;
    }

    return `${String(normalizedHours).padStart(2, '0')}:${String(parsedMinutes).padStart(2, '0')}`;
};

const detectTime = (normalizedInput) => {
    const meridiemMatch = normalizedInput.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
    if (meridiemMatch) {
        return parseTimeMatch(meridiemMatch[1], meridiemMatch[2], meridiemMatch[3]);
    }

    const fullTimeMatch = normalizedInput.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (fullTimeMatch) {
        return parseTimeMatch(fullTimeMatch[1], fullTimeMatch[2], '');
    }

    if (normalizedInput.includes('tonight') || normalizedInput.includes('evening')) {
        return '18:00';
    }

    if (normalizedInput.includes('late')) {
        return '20:00';
    }

    if (normalizedInput.includes('noon') || normalizedInput.includes('lunch')) {
        return '12:00';
    }

    if (normalizedInput.includes('morning')) {
        return '09:00';
    }

    return '';
};

const detectDate = (normalizedInput) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (normalizedInput.includes('today')) {
        return toIsoDate(today);
    }

    if (normalizedInput.includes('tomorrow')) {
        return toIsoDate(addDays(today, 1));
    }

    if (normalizedInput.includes('weekend')) {
        const saturday = weekdayNames.indexOf('saturday');
        const offset = (saturday - today.getDay() + 7) % 7;
        return toIsoDate(addDays(today, offset));
    }

    const weekdayEntry = weekdayNames.find((weekday) => normalizedInput.includes(weekday));
    if (weekdayEntry) {
        const targetDay = weekdayNames.indexOf(weekdayEntry);
        const offset = (targetDay - today.getDay() + 7) % 7;
        return toIsoDate(addDays(today, offset));
    }

    const isoDateMatch = normalizedInput.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (isoDateMatch) {
        return isoDateMatch[1];
    }

    return '';
};

const buildSuggestedTime = (date = '') => {
    if (!date) {
        return '';
    }

    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
        return '18:00';
    }

    return [0, 6].includes(parsedDate.getDay()) ? '09:00' : '18:00';
};

const isBookingContinuation = (normalizedInput = '', existingDraft = null, venues = []) => {
    if (!existingDraft?.sessionActive) {
        return false;
    }

    if (!normalizedInput) {
        return false;
    }

    return Boolean(
        detectSport(normalizedInput, venues)
        || detectDistrict(normalizedInput, venues)
        || detectVenue(normalizedInput, venues)
        || detectDate(normalizedInput)
        || detectTime(normalizedInput)
        || detectPlayerCount(normalizedInput)
        || /(yes|yep|sure|okay|ok|works|sounds good|go ahead)/.test(normalizedInput)
    );
};

const recommendVenue = ({ venue, sport, district, venues = [] }) => {
    if (venue) {
        return venue;
    }

    const filteredVenues = venues
        .filter((entry) => !sport || entry.sport === sport)
        .filter((entry) => !district || entry.location === district)
        .sort((first, second) => {
            if (first.availability === second.availability) {
                return second.rating - first.rating;
            }

            return first.availability === 'Open' ? -1 : 1;
        });

    return filteredVenues[0] || null;
};

const buildBookingCheckpoints = (draft, context = {}) => {
    const selectedVenue = draft.venue || null;
    const playerCount = draft.playerCount || 0;

    return [
        {
            key: 'account',
            label: 'Account',
            detail: context.currentUser?.id ? `Signed in as ${context.currentUser.name || 'player'}` : 'You need to sign in before booking.',
            ready: Boolean(context.currentUser?.id)
        },
        {
            key: 'venueArea',
            label: 'Venue and area',
            detail: selectedVenue
                ? `${selectedVenue.name} in ${selectedVenue.location}`
                : (draft.district ? `${draft.district} selected, venue still missing` : 'Pick an area or venue.'),
            ready: Boolean(selectedVenue?.id)
        },
        {
            key: 'schedule',
            label: 'Date and time',
            detail: draft.date && draft.time
                ? `${formatBookingDate(draft.date)} at ${formatBookingTime(draft.time)}`
                : 'Date and time are still incomplete.',
            ready: Boolean(draft.date && draft.time)
        },
        {
            key: 'squad',
            label: 'Players and squad',
            detail: playerCount > 0
                ? `${playerCount} players requested`
                : 'No player count set, default review will use a standard squad size.',
            ready: true
        }
    ];
};

const buildBookingDraft = (rawInput = '', context = {}) => {
    const normalizedInput = normalizeText(rawInput);
    const venues = context.venues || [];
    const existingDraft = context.bookingDraft || null;
    const isBookingRequest = bookingKeywords.some((keyword) => normalizedInput.includes(keyword));
    const isContinuation = isBookingContinuation(normalizedInput, existingDraft, venues);

    if (!isBookingRequest && !isContinuation) {
        return null;
    }

    const venue = detectVenue(normalizedInput, venues) || existingDraft?.venue || null;
    const sport = detectSport(normalizedInput, venues) || existingDraft?.sport || venue?.sport || '';
    const district = detectDistrict(normalizedInput, venues) || existingDraft?.district || venue?.location || existingDraft?.venue?.location || '';
    const date = detectDate(normalizedInput) || existingDraft?.date || '';
    const detectedTime = detectTime(normalizedInput);
    const time = detectedTime || existingDraft?.time || buildSuggestedTime(date);
    const playerCount = detectPlayerCount(normalizedInput) || existingDraft?.playerCount || null;
    const suggestedVenue = recommendVenue({ venue, sport, district, venues }) || existingDraft?.venue || null;
    const summaryBits = [
        sport || suggestedVenue?.sport || 'sports session',
        date ? `for ${formatBookingDate(date)}` : 'with a flexible date',
        time ? `at ${formatBookingTime(time)}` : 'with a flexible time',
        district || suggestedVenue?.location ? `in ${district || suggestedVenue?.location}` : ''
    ].filter(Boolean);
    const missing = [];
    const autoSelections = {
        time: !detectedTime && Boolean(date && time),
        venue: !detectVenue(normalizedInput, venues) && Boolean(suggestedVenue?.id)
    };

    if (!sport && !suggestedVenue) {
        missing.push('sport');
    }

    if (!date) {
        missing.push('date');
    }

    if (!suggestedVenue) {
        missing.push('district');
    }

    return {
        intent: 'booking',
        isBookingRequest,
        sport,
        district,
        date,
        time,
        playerCount,
        venue: suggestedVenue,
        missing,
        summary: summaryBits.join(' '),
        autoSelections,
        sessionActive: true,
        params: {
            presetSport: sport || suggestedVenue?.sport || '',
            presetDate: date,
            presetTime: time,
            presetDistrict: district || suggestedVenue?.location || '',
            venueId: suggestedVenue?.id || ''
        }
    };
};

const buildBookingGuidanceActions = (draft, context = {}) => {
    const venues = context.venues || [];
    const uniqueSports = [...new Set(venues.map((venue) => venue.sport).filter(Boolean))].slice(0, 4);
    const uniqueDistricts = [...new Set(venues.map((venue) => venue.location).filter(Boolean))].slice(0, 4);
    const nextField = draft.missing[0];

    if (nextField === 'sport') {
        return uniqueSports.map((sport) => promptAction(sport, `Book ${sport}`));
    }

    if (nextField === 'date') {
        return [
            promptAction('Today', 'today'),
            promptAction('Tomorrow', 'tomorrow'),
            promptAction('This Weekend', 'this weekend')
        ];
    }

    if (nextField === 'district') {
        return uniqueDistricts.map((district) => promptAction(district, district));
    }

    return [];
};

const buildBookingReply = (draft, context = {}) => {
    if (!draft) {
        return null;
    }

    const coverage = 4 - draft.missing.length;
    const confidence = coverage >= 3 ? 'high' : coverage === 2 ? 'medium' : 'low';
    const venueSentence = draft.venue
        ? `${draft.venue.name} is the best current fit${draft.venue.price > 0 ? ` at ${toCurrencyLabel(draft.venue.price)}/hr` : ' and it is free to use'}.`
        : 'I still need a district to lock the right venue.';
    const autoSelectionNotes = [
        draft.autoSelections?.time && draft.time ? `I set ${formatBookingTime(draft.time)} as the best current slot.` : '',
        draft.autoSelections?.venue && draft.venue ? `I lined up ${draft.venue.name} as the strongest venue fit.` : ''
    ].filter(Boolean).join(' ');
    const checkpoints = buildBookingCheckpoints(draft, context);
    const readyToReserve = checkpoints.every((checkpoint) => checkpoint.ready);
    const actions = readyToReserve
        ? [
            {
                label: 'Open Booking Confirmation',
                action: {
                    type: 'booking-review',
                    draft: {
                        ...draft,
                        checkpoints,
                        readyToReserve
                    }
                }
            },
            navigationAction('Open Reservation Draft', 'createMatch', draft.params),
            navigationAction('Review Venues First', draft.venue ? 'venueDetail' : 'booking', draft.venue ? { venueId: draft.venue.id } : {}),
            draft.venue
                ? navigationAction('Open Route Options', 'explore', { venueId: draft.venue.id, search: draft.venue.name, autoRoute: true })
                : null
        ].filter(Boolean)
        : [
            ...buildBookingGuidanceActions(draft, context),
            navigationAction('Open Partial Draft', 'createMatch', draft.params)
        ].filter(Boolean);

    const nextPrompt = draft.missing[0] === 'sport'
        ? 'Which sport should I build this booking around?'
        : draft.missing[0] === 'date'
            ? 'When do you want to play?'
            : draft.missing[0] === 'district'
                ? 'Which district should I target for the venue?'
                : 'I can take this into confirmation now.';

    return {
        intent: 'booking',
        confidence,
        text: readyToReserve
            ? `I drafted a booking for ${draft.summary}. ${venueSentence} ${autoSelectionNotes}`.trim()
            : `I drafted the booking so far as ${draft.summary}. ${venueSentence} ${autoSelectionNotes} ${nextPrompt}`.trim(),
        actions,
        draft: {
            sport: draft.sport || draft.venue?.sport || 'Choose sport',
            district: draft.district || draft.venue?.location || 'Choose district',
            date: draft.date,
            time: draft.time,
            playerCount: draft.playerCount,
            venueName: draft.venue?.name || 'Venue to be chosen',
            venuePrice: draft.venue?.price,
            missing: draft.missing,
            checkpoints,
            readyToReserve,
            sessionActive: true,
            params: draft.params,
            venueId: draft.venue?.id || draft.params.venueId || ''
        }
    };
};

const intentHandlers = [
    {
        keywords: ['next session', 'next match', 'upcoming match', 'upcoming'],
        handler: (context) => {
            if (!context?.upcomingMatch) {
                return {
                    text: 'You do not have an upcoming session yet. I can launch a quick booking flow for you.',
                    actions: [navigationAction('Create Match', 'createMatch', {}), {
                        label: 'Copy invite text',
                        action: { type: 'copy', value: 'No upcoming session scheduled yet.' }
                    }]
                };
            }

            const match = context.upcomingMatch;
            return {
                text: `Your next session is ${match.sport} at ${match.date} · ${match.time}.`,
                actions: [
                    navigationAction('Open Match', 'matchDetail', { matchId: match.id }),
                    {
                        label: 'Copy session details',
                        action: { type: 'copy', value: `Next match: ${match.sport} on ${match.date} at ${match.time}` }
                    }
                ]
            };
        }
    },
    {
        keywords: ['venue', 'explore', 'map', 'location'],
        handler: (context) => {
            const venue = context?.recommendedVenue;
            const snapshot = buildAvailabilitySnapshot(context?.venues || []);
            if (!venue) {
                return {
                    text: 'I can open the venue explorer and highlight the best courts nearby.',
                    actions: [navigationAction('Open Explorer', 'explore', {}), navigationAction('View Booking Options', 'booking', {})]
                };
            }

            return {
                text: `Right now ${venue.name} is trending in ${venue.location}.${snapshot.cheapestVenue ? ` Lowest quick-start option: ${snapshot.cheapestVenue.name} at ${toCurrencyLabel(snapshot.cheapestVenue.price)}/hr.` : ''}`,
                actions: [
                    navigationAction('Open Venue', 'venueDetail', { venueId: venue.id }),
                    navigationAction('Open Explore', 'explore', { venueId: venue.id, search: venue.name }),
                    {
                        label: 'Copy venue info',
                        action: { type: 'copy', value: `${venue.name} • ${venue.location}` }
                    }
                ]
            };
        }
    },
    {
        keywords: ['reward', 'streak', 'points', 'level'],
        handler: () => ({
            text: 'Rewards now live inside the Clubs hub, alongside your active club circuit and upcoming community sessions.',
            actions: [navigationAction('Open Rewards', 'clubs', { tab: 'rewards' })]
        })
    },
    {
        keywords: ['friend', 'squad', 'invite', 'network'],
        handler: () => ({
            text: 'Friends and squads live in the Friends Hub and Invites sections.',
            actions: [navigationAction('Open Friends Hub', 'friendsHub', {}), navigationAction('Open Invites', 'friendsInvites', {}), navigationAction('Discover Players', 'friendsDiscover', {})]
        })
    },
    {
        keywords: ['player', 'teammate', 'partner', 'find teammates', 'find players'],
        handler: () => ({
            text: 'I can take you straight into player discovery or the squad area so you can fill a match faster.',
            actions: [navigationAction('Discover Players', 'friendsDiscover', {}), navigationAction('Open Squad Tools', 'friendsSquad', {})]
        })
    },
    {
        keywords: ['support', 'help', 'issue', 'problem'],
        handler: (context) => ({
            text: `Need help? Support is routed through support@goplayhk.com while you are on ${describeView(context.currentView)}.`,
            actions: [
                { label: 'Open Notifications', action: { type: 'navigate', page: 'notifications', params: {} } },
                navigationAction('Open Profile', 'playerProfile', { playerId: context.currentUserId })
            ]
        })
    },
    {
        keywords: ['route to venue', 'best route', 'plan route', 'directions'],
        handler: (context) => ({
            text: `Routing works best from the venue explorer. I can take you there and keep the handoff short from the ${describeView(context.currentView)}.`,
            actions: [navigationAction('Open Explore', 'explore', context.recommendedVenue ? { venueId: context.recommendedVenue.id } : {})]
        })
    }
];

const fallbackResponse = (context) => ({
    intent: 'fallback',
    text: `I can route you through bookings, squads, rewards, and the concierge view. You are currently in the ${describeView(context.currentView)}.`,
    actions: quickActionSuggestions
});

export const buildAssistantReply = (rawInput = '', context = {}) => {
    const normalized = normalizeText(rawInput);
    if (!normalized) {
        return fallbackResponse(context);
    }

    const bookingDraft = buildBookingDraft(rawInput, context);
    if (bookingDraft) {
        return buildBookingReply(bookingDraft, context);
    }

    const handlerEntry = intentHandlers.find((entry) => entry.keywords.some((keyword) => normalized.includes(keyword)));
    const reply = handlerEntry ? handlerEntry.handler(context) : null;
    const safeActions = (reply?.actions || quickActionSuggestions).filter(Boolean);

    return {
        intent: reply?.intent || 'general',
        text: reply?.text || fallbackResponse(context).text,
        actions: safeActions,
        draft: reply?.draft || null
    };
};

export const defaultGreetingMessages = [
    {
        id: 'bot-intro',
        text: 'Ask for a group, players, or a booking draft.',
        type: 'bot',
        actions: quickActionSuggestions
    }
];

export { buildBookingDraft, quickActions };
export default buildAssistantReply;