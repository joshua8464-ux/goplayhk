export const NAV_PAGE_ALIASES = {
    bookingLobbies: 'booking',
    clubDetail: 'clubs',
    friendsHub: 'friendsHub',
    friendsSquad: 'friendsHub',
    friendsDiscover: 'friendsHub',
    friendsInvites: 'friendsHub',
    friendsRecurring: 'friendsHub',
    map: 'explore',
    rewards: 'clubs'
};

export const normalizeNavPage = (page) => NAV_PAGE_ALIASES[page] || page;

export const createBottomNavItems = (currentUserId) => [
    { page: 'home', icon: 'fa-home', label: 'Home' },
    { page: 'explore', icon: 'fa-compass', label: 'Explore' },
    { page: 'booking', icon: 'fa-calendar-check', label: 'Bookings' },
    { page: 'friendsHub', icon: 'fa-user-group', label: 'Friends' },
    { page: 'clubs', icon: 'fa-medal', label: 'Clubs' },
    { page: 'playerProfile', icon: 'fa-user', label: 'Profile', params: currentUserId ? { playerId: currentUserId } : {} }
];
