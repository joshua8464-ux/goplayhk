export const loadRootApp = () => import('./app.jsx');

export const loadVenuePages = () => import('../app/sections/venue/index.jsx');

export const loadSocialPages = () => import('../app/sections/social/index.jsx');

export const loadAccountPages = () => import('../app/sections/account/index.jsx');

export const loadChatbotModule = () => import('../app/sections/assistant/Chatbot.jsx');

export const scheduleIdleTask = (task, timeout = 1200) => {
    if (typeof window === 'undefined') {
        return () => {};
    }

    if ('requestIdleCallback' in window) {
        const id = window.requestIdleCallback(task, { timeout });
        return () => window.cancelIdleCallback(id);
    }

    const id = window.setTimeout(() => task(), 180);
    return () => window.clearTimeout(id);
};

export const warmAuthenticatedShell = () => Promise.allSettled([
    loadChatbotModule(),
    loadVenuePages()
]);

export const warmDeferredExperience = () => Promise.allSettled([
    loadSocialPages(),
    loadAccountPages()
]);

export const preloadForView = (page) => {
    switch (page) {
        case 'booking':
        case 'venueDetail':
        case 'bookingLobbies':
            return loadVenuePages();
        case 'friendsHub':
        case 'friendsSquad':
        case 'friendsDiscover':
        case 'friendsInvites':
        case 'friendsRecurring':
            return loadSocialPages();
        case 'playerProfile':
        case 'notifications':
        case 'rewards':
            return loadAccountPages();
        case 'chatbot':
            return loadChatbotModule();
        default:
            return Promise.resolve();
    }
};