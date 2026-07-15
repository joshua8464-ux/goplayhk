// --- Voice Prompt Utility ---
const useVoicePrompt = () => {
    const { state } = useContext(AppStateContext);
    const speak = (text) => {
        if (state.accessibility.voicePrompts && window.speechSynthesis) {
            const utter = new window.SpeechSynthesisUtterance(text);
            utter.rate = 1;
            utter.pitch = 1;
            window.speechSynthesis.speak(utter);
        }
    };
    return speak;
};

// --- Modern Feedback Modal ---
const FeedbackModal = ({ isOpen, close, onSubmit, type = 'match', targetName = '', defaultRating = 0 }) => {
    const [rating, setRating] = useState(defaultRating);
    const [comment, setComment] = useState('');
    return (
        <Modal isOpen={isOpen} close={close} title={`Feedback for ${targetName}`}> 
            <div className="feedback-modal glass-card">
                <h4 className="font-semibold mb-2">{type === 'venue' ? 'Venue' : 'Match'} Feedback</h4>
                <div className="flex mb-2">
                    {[1,2,3,4,5].map(i => (
                        <i key={i} className={`fas fa-star mr-1 cursor-pointer ${i <= rating ? 'text-yellow-400' : 'text-gray-300'}`} onClick={() => setRating(i)}></i>
                    ))}
                </div>
                <textarea
                    className="input-field h-20 mb-2"
                    placeholder="Your feedback..."
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                />
                <button className="btn-primary w-full" onClick={() => { onSubmit(rating, comment); close(); }} disabled={rating === 0 || !comment.trim()}>
                    Submit Feedback
                </button>
            </div>
        </Modal>
    );
};
import React, { Suspense, lazy, useContext, createContext, useEffect, useMemo, useRef, useState } from 'react';
import { getRedirectResult, onAuthStateChanged, sendEmailVerification } from 'firebase/auth';
import { queueAuthenticatedLoading, queueNavigationWarmup } from '../boot/loadingTasks';
import { loadAccountPages, loadChatbotModule, loadSocialPages, loadVenuePages } from './prefetch';
import AppModal from '../app/components/AppModal';
import BottomNavigation from '../app/components/BottomNavigation';
import { AuthPage as ExtractedAuthPage, RegisterPage as ExtractedRegisterPage, ForgotPasswordPage as ExtractedForgotPasswordPage, VerificationPendingPage as ExtractedVerificationPendingPage } from '../app/sections/auth/AuthPages';
import HomePageView from '../app/sections/core/HomePage';
import PickupGamesPage from '../app/sections/pickup/PickupGamesPage';
import PickupGameDetailPage from '../app/sections/pickup/PickupGameDetailPage';
import HostGamePage from '../app/sections/pickup/HostGamePage';
import { submitBookingReservation } from '../app/data/bookingActions';
import { createGeminiMatchmakingState, runGeminiMatchmakingWave } from '../app/data/matchmakingAi';
import { buildUserCloudState, ensureUserCloudDocument, reconcileUserCloudState, saveUserCloudState, serializeUserCloudState, subscribeToUserCloudState } from '../app/data/cloudState';
import { createInitialMatchmakingState as sharedCreateInitialMatchmakingState } from '../app/data/matchmaking';
import { ensurePublicProfile, subscribeToFriendships, subscribeToPublicProfiles, updatePublicProfile } from '../app/data/publicProfiles';
import { acceptFriendRequest, declineFriendRequest, publishPresence, sendFriendRequest, subscribeToFriendRequests, subscribeToPresence, updatePresencePage } from '../app/data/realtimeSocial';
import { auth, enableAnalyticsIfConfigured, enableAppCheckIfConfigured } from '../app/config/firebase';
import { formatHourLabel, getLeafletTileLayerConfig, getNextSevenDayOptions } from '../app/utils/pageHelpers';
import { applyLanguagePreference, getStoredLanguagePreference } from '../app/utils/languagePreference';
import { buildAssistantReply, defaultGreetingMessages, quickActions } from './chatbotAssistant';

// If using Tailwind, import or configure it here (or in index.js)
// If you were using the CDN, install tailwindcss and configure it in your project.

// Import your styles.css (assuming it's in the same folder or src)
// At the top of src/App.jsx
import './styles.css'; // ← This is correct (same folder as App.jsx)

    const GOOGLE_AUTH_INTENT_KEY = 'goplayhk_google_auth_intent';
    const GOOGLE_AUTH_PROFILE_KEY = 'goplayhk_google_auth_profile';

        const readGoogleRedirectState = () => {
            if (typeof window === 'undefined') {
                return { intent: null, profile: {} };
            }

            const intent = window.sessionStorage.getItem(GOOGLE_AUTH_INTENT_KEY)
                || window.localStorage.getItem(GOOGLE_AUTH_INTENT_KEY);
            const rawProfile = window.sessionStorage.getItem(GOOGLE_AUTH_PROFILE_KEY)
                || window.localStorage.getItem(GOOGLE_AUTH_PROFILE_KEY);

            if (intent !== 'login' && intent !== 'register') {
                return { intent: null, profile: {} };
            }

            if (!rawProfile) {
                return { intent, profile: {} };
            }

            try {
                return { intent, profile: JSON.parse(rawProfile) };
            } catch {
                return { intent, profile: {} };
            }
        };

        const clearGoogleRedirectState = () => {
            if (typeof window === 'undefined') {
                return;
            }

            window.sessionStorage.removeItem(GOOGLE_AUTH_INTENT_KEY);
            window.sessionStorage.removeItem(GOOGLE_AUTH_PROFILE_KEY);
            window.localStorage.removeItem(GOOGLE_AUTH_INTENT_KEY);
            window.localStorage.removeItem(GOOGLE_AUTH_PROFILE_KEY);
        };

        const LazyBookingLobbiesPage = lazy(() => loadVenuePages().then((module) => ({ default: module.BookingLobbiesPage })));
        const LazyVenueDetailPage = lazy(() => loadVenuePages().then((module) => ({ default: module.VenueDetailPage })));
        const LazyExplorePageView = lazy(() => import('../app/sections/core/ExplorePage'));
        const LazyBookingPageView = lazy(() => import('../app/sections/core/BookingPage'));
        const LazyFriendsHubPage = lazy(() => loadSocialPages().then((module) => ({ default: module.FriendsHubPage })));
        const LazyFriendsSquadPage = lazy(() => loadSocialPages().then((module) => ({ default: module.FriendsSquadPage })));
        const LazyFriendsRecurringPage = lazy(() => loadSocialPages().then((module) => ({ default: module.FriendsRecurringPage })));
        const LazyFriendsDiscoverPage = lazy(() => loadSocialPages().then((module) => ({ default: module.FriendsDiscoverPage })));
        const LazyFriendsInvitesPage = lazy(() => loadSocialPages().then((module) => ({ default: module.FriendsInvitesPage })));
        const LazyPlayerProfilePage = lazy(() => loadAccountPages().then((module) => ({ default: module.PlayerProfilePage })));
        const LazyNotificationsPage = lazy(() => loadAccountPages().then((module) => ({ default: module.NotificationsPage })));
        const LazyClubsPage = lazy(() => loadAccountPages().then((module) => ({ default: module.ClubsPage })));
        const LazyClubDetailPage = lazy(() => loadAccountPages().then((module) => ({ default: module.ClubDetailPage })));
        const LazyRewardsPage = lazy(() => loadAccountPages().then((module) => ({ default: module.RewardsPage })));
        const LazyChatbot = lazy(() => loadChatbotModule());

        const DeferredPageShell = ({ title, detail = 'Preparing this section without blocking your main flow.' }) => (
            <div className="page-content tech-page">
                <section className="hero-panel fade-in surface-tier-3">
                    <span className="section-kicker">Loading</span>
                    <h2 className="section-title">{title}</h2>
                    <p>{detail}</p>
                </section>
            </div>
        );

        const AiOrbitLoader = ({ title = 'AI is shaping the match', detail = 'Reading venue fit, timing, and squad chemistry before opening the next step.' }) => (
            <div className="ai-matchmaking-overlay" role="status" aria-live="polite" aria-atomic="true">
                <div className="ai-matchmaking-loader surface-tier-2">
                    <div className="ai-orbit-loader" aria-hidden="true">
                        <span className="ai-orbit-glow ai-orbit-glow-primary"></span>
                        <span className="ai-orbit-glow ai-orbit-glow-secondary"></span>
                        <span className="ai-orbit-particle ai-orbit-particle-one"></span>
                        <span className="ai-orbit-particle ai-orbit-particle-two"></span>
                        <span className="ai-orbit-particle ai-orbit-particle-three"></span>
                        <span className="ai-orbit-ring ai-orbit-ring-outer"></span>
                        <span className="ai-orbit-ring ai-orbit-ring-middle"></span>
                        <span className="ai-orbit-ring ai-orbit-ring-inner"></span>
                        <span className="ai-orbit-core">AI</span>
                    </div>
                    <span className="section-kicker">Matchmaking in motion</span>
                    <h3>{title}</h3>
                    <p>{detail}</p>
                    <div className="ai-loader-progress" aria-hidden="true">
                        <span></span>
                    </div>
                </div>
            </div>
        );

        const renderDeferredPage = (node, title, detail) => (
            <Suspense fallback={<DeferredPageShell title={title} detail={detail} />}>
                {node}
            </Suspense>
        );

        const ThemeContext = createContext({ theme: 'light', themePreference: 'system', toggleTheme: () => {}, applySystemTheme: () => {} });
        const ToastContext = createContext(() => {});
        const AppStateContext = createContext();

        const ThemeProvider = ({ children }) => {
            const THEME_PREFERENCE_KEY = 'themePreference';
            const LEGACY_THEME_KEY = 'theme';
            const getSystemTheme = () => (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
            const getStoredThemePreference = () => {
                if (typeof window === 'undefined') {
                    return 'system';
                }

                try {
                    const savedPreference = localStorage.getItem(THEME_PREFERENCE_KEY);
                    if (savedPreference === 'system' || savedPreference === 'light' || savedPreference === 'dark') {
                        return savedPreference;
                    }

                    const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
                    if (legacyTheme === 'light' || legacyTheme === 'dark') {
                        return legacyTheme;
                    }
                } catch (error) {}

                return 'system';
            };

            const [themePreference, setThemePreference] = useState(getStoredThemePreference);
            const [systemTheme, setSystemTheme] = useState(getSystemTheme);
            const theme = themePreference === 'system' ? systemTheme : themePreference;

            const toggleTheme = () => {
                const nextTheme = theme === 'dark' ? 'light' : 'dark';

                try {
                    localStorage.setItem(THEME_PREFERENCE_KEY, nextTheme);
                    localStorage.setItem(LEGACY_THEME_KEY, nextTheme);
                } catch (error) {}

                setThemePreference(nextTheme);
            };

            const applySystemTheme = () => {
                try {
                    localStorage.setItem(THEME_PREFERENCE_KEY, 'system');
                    localStorage.removeItem(LEGACY_THEME_KEY);
                } catch (error) {}

                setThemePreference('system');
            };

            useEffect(() => {
                if (typeof window === 'undefined' || !window.matchMedia) {
                    return undefined;
                }

                const mq = window.matchMedia('(prefers-color-scheme: dark)');
                const handleSystemThemeChange = (event) => {
                    setSystemTheme(event.matches ? 'dark' : 'light');
                };

                setSystemTheme(mq.matches ? 'dark' : 'light');

                try {
                    if (mq.addEventListener) mq.addEventListener('change', handleSystemThemeChange);
                    else mq.addListener(handleSystemThemeChange);
                } catch (error) {}

                return () => {
                    try {
                        if (mq.removeEventListener) mq.removeEventListener('change', handleSystemThemeChange);
                        else mq.removeListener(handleSystemThemeChange);
                    } catch (error) {}
                };
            }, []);

            useEffect(() => {
                document.body.classList.remove('light', 'dark');
                document.body.classList.add(theme);
                document.documentElement.style.colorScheme = theme;
            }, [theme]);

            return <ThemeContext.Provider value={{ theme, themePreference, toggleTheme, applySystemTheme }}>{children}</ThemeContext.Provider>;
        };

        const ToastProvider = ({ children }) => {
            const [toasts, setToasts] = useState([]);
            const showToast = (message, type = 'info') => {
                const id = Date.now();
                setToasts(prev => [...prev, { id, message, type }]);
                setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
            };
            return (
                <ToastContext.Provider value={showToast}>
                    {children}
                    <div className="toast-container" aria-live="polite" aria-atomic="true">
                        {toasts.map(toast => <div key={toast.id} className="toast-item">{toast.message}</div>)}
                    </div>
                </ToastContext.Provider>
            );
        };

        const IntroPage = ({ setView }) => (
            <div className="auth-container auth-shell intro-shell">
                <section className="intro-hero-panel fade-in">
                    <span className="auth-chip">GoPlayHK Network</span>
                    <h1 className="auth-title">Sports booking that feels like a real city app, not a prototype.</h1>
                    <p className="auth-copy">Find venues, fill squads, coordinate match day, and move between booking, routing, and team management without losing context.</p>
                    <div className="intro-stat-grid">
                        <div className="intro-stat-card">
                            <strong>420+</strong>
                            <span>bookable venues</span>
                        </div>
                        <div className="intro-stat-card">
                            <strong>3.4k</strong>
                            <span>matches coordinated</span>
                        </div>
                        <div className="intro-stat-card">
                            <strong>AI-ready</strong>
                            <span>smart fill and routing</span>
                        </div>
                    </div>
                </section>
                <section className="card auth-card intro-card fade-in surface-tier-2">
                    <div className="intro-card-copy">
                        <span className="section-kicker">Start here</span>
                        <h2 className="auth-form-title">Enter the app the right way</h2>
                        <p className="quick-guide-intro">Choose an action first, then continue into the focused authentication screen instead of mixing introduction and login together.</p>
                    </div>
                    <div className="intro-action-stack">
                        <button className="btn-primary" onClick={() => setView('login')}>
                            Continue to Login
                        </button>
                        <button className="btn-secondary" onClick={() => setView('register')}>
                            Create a New Account
                        </button>
                    </div>
                    <div className="quick-guide-grid intro-guide-grid">
                        {[
                            { icon: 'fa-calendar-check', title: 'Book Faster', description: 'Pick venues on the map first, then confirm date, time, and squad flow.' },
                            { icon: 'fa-user-group', title: 'Coordinate Better', description: 'Keep friends, bookings, invites, and lobbies in one linked system.' },
                            { icon: 'fa-map-location-dot', title: 'Navigate Clearly', description: 'Switch into routing when you need transit, walking, or driving guidance.' }
                        ].map((item) => (
                            <div key={item.title} className="quick-guide-card intro-guide-card">
                                <span className="quick-guide-icon"><i className={`fas ${item.icon}`}></i></span>
                                <div>
                                    <strong>{item.title}</strong>
                                    <p>{item.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        );

        const venueArtworkThemes = {
            Tennis: { start: '#0b8f8c', end: '#13d2c2', accent: '#f8ff7d', icon: 'T' },
            Basketball: { start: '#ff8c2f', end: '#ffb24c', accent: '#fff0da', icon: 'B' },
            Badminton: { start: '#3049b0', end: '#6f86ff', accent: '#ffffff', icon: 'D' },
            Football: { start: '#0f6a4b', end: '#25ba7e', accent: '#e5fff4', icon: 'F' },
            Swimming: { start: '#0f6db2', end: '#56c3ff', accent: '#eff9ff', icon: 'S' },
            Rugby: { start: '#6f3d14', end: '#c5792d', accent: '#fff0d9', icon: 'R' },
            Volleyball: { start: '#7b3ff2', end: '#b26cff', accent: '#f4e9ff', icon: 'V' },
            Athletics: { start: '#0d7a61', end: '#1bc59a', accent: '#ebfff9', icon: 'A' },
            'Horse Racing': { start: '#5d3610', end: '#b46b28', accent: '#fff2df', icon: 'H' },
            'Multi-sport': { start: '#124b8a', end: '#2ca8d8', accent: '#e7f7ff', icon: 'M' },
            Running: { start: '#c85c19', end: '#ff9d45', accent: '#fff3df', icon: 'R' },
            Hiking: { start: '#446c1f', end: '#85c748', accent: '#f4ffe2', icon: 'H' },
            Cycling: { start: '#3b4bc0', end: '#6887ff', accent: '#edf0ff', icon: 'C' },
            Golf: { start: '#2d7d46', end: '#8bd36e', accent: '#f1ffe9', icon: 'G' }
        };

        const escapeSvgText = (value = '') => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        const createProfileAvatar = (seed = 'player') => {
            const label = String(seed || 'player').trim() || 'player';
            const initials = label
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((segment) => segment[0]?.toUpperCase() || '')
                .join('') || label.slice(0, 2).toUpperCase();
            const safeLabel = escapeSvgText(label);
            const safeInitials = escapeSvgText(initials);
            const svg = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="${safeLabel}">
                    <defs>
                        <linearGradient id="avatarGradient" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stop-color="#0f4c81" />
                            <stop offset="52%" stop-color="#178a8a" />
                            <stop offset="100%" stop-color="#ffc94d" />
                        </linearGradient>
                    </defs>
                    <rect width="160" height="160" rx="80" fill="url(#avatarGradient)" />
                    <circle cx="122" cy="34" r="24" fill="#ffffff" fill-opacity="0.16" />
                    <circle cx="38" cy="132" r="34" fill="#061321" fill-opacity="0.14" />
                    <text x="80" y="96" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="52" font-weight="800" fill="#ffffff">${safeInitials}</text>
                </svg>`;

            return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
        };

        const createVenueArtwork = ({ name, sport, location }) => {
            const theme = venueArtworkThemes[sport] || { start: '#144c80', end: '#2cb9bb', accent: '#fff4de', icon: 'G' };
            const safeName = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeSport = String(sport).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').toUpperCase();
            const safeLocation = String(location).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const svg = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" role="img" aria-label="${safeName}">
                    <defs>
                        <linearGradient id="venueGradient" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stop-color="${theme.start}" />
                            <stop offset="100%" stop-color="${theme.end}" />
                        </linearGradient>
                        <radialGradient id="venueGlow" cx="0.2" cy="0.15" r="0.8">
                            <stop offset="0%" stop-color="rgba(255,255,255,0.75)" />
                            <stop offset="100%" stop-color="rgba(255,255,255,0)" />
                        </radialGradient>
                    </defs>
                    <rect width="1200" height="720" rx="36" fill="url(#venueGradient)" />
                    <rect width="1200" height="720" rx="36" fill="url(#venueGlow)" opacity="0.65" />
                    <circle cx="980" cy="110" r="170" fill="${theme.accent}" opacity="0.18" />
                    <circle cx="180" cy="610" r="220" fill="#ffffff" opacity="0.08" />
                    <path d="M0 530 C210 430 360 640 570 560 S910 380 1200 520 L1200 720 L0 720 Z" fill="rgba(4, 30, 66, 0.18)" />
                    <path d="M0 470 C220 350 400 540 620 470 S940 300 1200 420" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="8" stroke-linecap="round" />
                    <rect x="72" y="76" width="132" height="132" rx="32" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.28)" stroke-width="4" />
                    <text x="138" y="160" text-anchor="middle" font-size="72" font-family="Poppins, Inter, sans-serif" font-weight="700" fill="#ffffff">${theme.icon}</text>
                    <text x="72" y="292" font-size="42" font-family="Inter, sans-serif" letter-spacing="8" fill="rgba(255,255,255,0.76)">${safeSport}</text>
                    <text x="72" y="388" font-size="78" font-family="Poppins, Inter, sans-serif" font-weight="700" fill="#ffffff">${safeName}</text>
                    <text x="72" y="450" font-size="34" font-family="Inter, sans-serif" fill="rgba(255,255,255,0.88)">${safeLocation}</text>
                    <text x="72" y="612" font-size="28" font-family="Inter, sans-serif" letter-spacing="6" fill="rgba(255,255,255,0.68)">GoPlayHK venue preview</text>
                </svg>`;

            return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
        };

        const createClubArtwork = ({ name, sport, district }) => {
            const theme = venueArtworkThemes[sport] || { start: '#124b8a', end: '#2ca8d8', accent: '#e7f7ff', icon: 'C' };
            const safeName = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeSport = String(sport).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').toUpperCase();
            const safeDistrict = String(district).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const clubMark = String(name || '')
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((segment) => segment[0])
                .join('')
                .toUpperCase() || theme.icon;
            const svg = `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" role="img" aria-label="${safeName}">
                    <defs>
                        <linearGradient id="clubGradient" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stop-color="${theme.start}" />
                            <stop offset="100%" stop-color="${theme.end}" />
                        </linearGradient>
                        <radialGradient id="clubGlow" cx="0.82" cy="0.18" r="0.75">
                            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.58" />
                            <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
                        </linearGradient>
                    </defs>
                    <rect width="1200" height="720" rx="42" fill="url(#clubGradient)" />
                    <rect width="1200" height="720" rx="42" fill="url(#clubGlow)" opacity="0.72" />
                    <rect x="48" y="48" width="1104" height="624" rx="34" fill="#030d18" fill-opacity="0.14" stroke="#ffffff" stroke-opacity="0.18" stroke-width="4" />
                    <circle cx="1032" cy="118" r="172" fill="${theme.accent}" opacity="0.16" />
                    <circle cx="176" cy="612" r="210" fill="#ffffff" fill-opacity="0.08" />
                    <path d="M0 560 C220 420 360 660 590 552 S940 346 1200 470 L1200 720 L0 720 Z" fill="#060f1c" fill-opacity="0.18" />
                    <path d="M88 520 C240 408 392 576 562 476 S852 356 1098 420" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="18" stroke-linecap="round" />
                    <path d="M106 598 H1094" stroke="#ffffff" stroke-opacity="0.22" stroke-width="12" stroke-linecap="round" />
                    <g transform="translate(94 96)">
                        <circle cx="110" cy="110" r="110" fill="#060f1c" fill-opacity="0.28" stroke="#ffffff" stroke-opacity="0.28" stroke-width="6" />
                        <circle cx="110" cy="110" r="78" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.2" stroke-width="4" />
                        <text x="110" y="130" text-anchor="middle" font-size="96" font-family="Aptos Display, Segoe UI, sans-serif" font-weight="800" fill="#ffffff">${clubMark}</text>
                    </g>
                    <rect x="94" y="386" width="292" height="72" rx="24" fill="#060f1c" fill-opacity="0.34" stroke="#ffffff" stroke-opacity="0.16" stroke-width="3" />
                    <text x="240" y="432" text-anchor="middle" font-size="34" font-family="Aptos Display, Segoe UI, sans-serif" font-weight="700" fill="#ffffff">${safeSport}</text>
                    <rect x="94" y="478" width="352" height="58" rx="20" fill="#060f1c" fill-opacity="0.28" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2" />
                    <text x="270" y="515" text-anchor="middle" font-size="22" font-family="Aptos, Segoe UI, sans-serif" letter-spacing="5" fill="#ffffff" fill-opacity="0.8">${safeDistrict}</text>
                    <text x="94" y="610" font-size="28" font-family="Aptos, Segoe UI, sans-serif" letter-spacing="8" fill="#ffffff" fill-opacity="0.74">GOPLAYHK CLUB CIRCUIT</text>
                </svg>`;

            return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
        };

        const withClubPresentation = (club = {}) => ({
            ...club,
            heroImage: club.heroImage || createClubArtwork(club)
        });

        const mergeClubPresentation = (clubs = [], fallbackClubs = []) => clubs.map((club) => {
            const fallbackClub = fallbackClubs.find((entry) => entry.id === club.id) || {};
            return withClubPresentation({ ...fallbackClub, ...club });
        });

        const samsungSupportedModels = ['Galaxy Watch Ultra', 'Galaxy Watch7', 'Galaxy Watch6 Classic', 'Galaxy Watch5 Pro'];

        const defaultPaceBySport = {
            Running: 318,
            Athletics: 304,
            Cycling: 214,
            Hiking: 552,
            Tennis: 348,
            Badminton: 332,
            Basketball: 338,
            Football: 326,
            Swimming: 168,
            Volleyball: 334,
            Rugby: 344,
            Golf: 492
        };

        const buildActivityMetrics = (user = {}, overrides = {}) => {
            const primarySport = overrides.primarySport || user.sports?.[0] || 'Tennis';
            const matchesPlayed = Number(user.matchesPlayed || 0);
            const totalDistanceKm = overrides.totalDistanceKm ?? Number((matchesPlayed * 4.6 + (primarySport === 'Running' ? 28.4 : 14.2)).toFixed(1));
            const activeMinutes = overrides.activeMinutes ?? Math.round(totalDistanceKm * 7.8);
            const sessionsCompleted = overrides.sessionsCompleted ?? Math.max(matchesPlayed, 4);
            const weeklyDistanceKm = overrides.weeklyDistanceKm ?? Number(Math.max(totalDistanceKm / 10, 6.2).toFixed(1));
            const averagePaceSecPerKm = overrides.averagePaceSecPerKm ?? defaultPaceBySport[primarySport] ?? 336;
            const caloriesBurned = overrides.caloriesBurned ?? Math.round(totalDistanceKm * 58);
            const elevationGainM = overrides.elevationGainM ?? Math.round(totalDistanceKm * 5.5);

            return {
                primarySport,
                totalDistanceKm,
                activeMinutes,
                sessionsCompleted,
                weeklyStreak: overrides.weeklyStreak ?? 3,
                weeklyDistanceKm,
                averagePaceSecPerKm,
                caloriesBurned,
                elevationGainM,
                lastSyncedAt: overrides.lastSyncedAt ?? '',
                syncCount: overrides.syncCount ?? 0
            };
        };

        const buildWatchSyncState = (overrides = {}) => ({
            provider: 'Samsung Health',
            linked: false,
            model: '',
            status: 'disconnected',
            batteryLevel: null,
            lastSyncedAt: '',
            latestRunDistanceKm: 0,
            latestRunPaceSecPerKm: 0,
            syncCount: 0,
            fallbackMode: true,
            ...overrides,
            supportedModels: samsungSupportedModels
        });

        const withPerformanceProfile = (user = {}, options = {}) => {
            const activityMetrics = {
                ...buildActivityMetrics(user),
                ...(user.activityMetrics || {}),
                ...(options.activityMetrics || {})
            };
            const watchSync = buildWatchSyncState({
                ...(user.watchSync || {}),
                ...(options.watchSync || {})
            });

            return {
                ...user,
                activityMetrics,
                watchSync
            };
        };

        const getVenueDisplayImage = (venue, revealedVenueImageIds) => {
            if (!venue) {
                return '';
            }

            return revealedVenueImageIds.has(venue.id) ? venue.img : venue.placeholderImg;
        };

        const seededClubs = [
            {
                id: 'club-running-harbour',
                name: 'Harbour Pace Collective',
                sport: 'Running',
                district: 'Tsim Sha Tsui',
                tags: ['Sunrise Runs', 'Beginner Friendly', 'Waterfront'],
                requirements: 'Open pace groups from first 5K runners to negative-split tempo crews.',
                description: 'A waterfront running club built around early starts, progression blocks, and city-race preparation without losing the social energy after the final rep.',
                memberIds: ['u1', 'u4', 'u7'],
                upcomingSessions: [
                    { id: 'club-run-1', title: 'Sunrise Harbour Tempo', date: '2026-03-24', time: '06:30', venue: 'Victoria Harbour Waterfront', spotsLeft: 14 },
                    { id: 'club-run-2', title: 'Saturday Long Run', date: '2026-03-28', time: '07:00', venue: 'Lantau Trail Meetup', spotsLeft: 22 }
                ]
            },
            {
                id: 'club-badminton-east',
                name: 'East Side Shuttle Lab',
                sport: 'Badminton',
                district: 'Tseung Kwan O',
                tags: ['After Work', 'Intermediate', 'Fast Rotation'],
                requirements: 'Intermediate and above. Bring indoor shoes and be ready for rotating doubles ladders.',
                description: 'An evening badminton club tuned for quick court rotations, coaching cues between games, and reliable weeknight sessions in the east side district cluster.',
                memberIds: ['u3', 'u5'],
                upcomingSessions: [
                    { id: 'club-bad-1', title: 'Weeknight Doubles Ladder', date: '2026-03-25', time: '19:30', venue: 'Tseung Kwan O Sports Centre', spotsLeft: 6 },
                    { id: 'club-bad-2', title: 'Precision Drill Block', date: '2026-03-29', time: '11:00', venue: 'Tseung Kwan O Sports Centre', spotsLeft: 8 }
                ]
            },
            {
                id: 'club-tennis-central',
                name: 'Victoria Baseline Club',
                sport: 'Tennis',
                district: 'Causeway Bay',
                tags: ['Matchplay', 'League Prep', 'Evenings'],
                requirements: 'Comfortable rallying and scoring. Best fit for players preparing for ladder or league matchplay.',
                description: 'A tennis club centered on tactical matchplay, consistency under pressure, and city-circuit competition nights at high-demand courts.',
                memberIds: ['u1', 'u2', 'u6'],
                upcomingSessions: [
                    { id: 'club-tennis-1', title: 'Baseline Pressure Set', date: '2026-03-26', time: '18:00', venue: 'Victoria Park', spotsLeft: 4 },
                    { id: 'club-tennis-2', title: 'Sunday Ladder Challenge', date: '2026-03-29', time: '16:00', venue: 'Victoria Park', spotsLeft: 3 }
                ]
            },
            {
                id: 'club-football-city',
                name: 'City Lights Football Club',
                sport: 'Football',
                district: 'Mong Kok',
                tags: ['11-a-side', 'Competitive', 'Night Fixtures'],
                requirements: 'Suitable for players comfortable with structured fixtures, positional roles, and full-pitch sessions.',
                description: 'A football club for high-energy evening fixtures, small tactical units, and weekly squad selection that feels closer to a real club environment.',
                memberIds: ['u2', 'u6'],
                upcomingSessions: [
                    { id: 'club-foot-1', title: 'Night Pressing Session', date: '2026-03-27', time: '20:00', venue: 'Mong Kok Stadium', spotsLeft: 9 },
                    { id: 'club-foot-2', title: 'Weekend Match Simulation', date: '2026-03-30', time: '18:30', venue: 'Hong Kong Stadium', spotsLeft: 7 }
                ]
            },
            {
                id: 'club-basketball-kowloon',
                name: 'Kowloon Flight Squad',
                sport: 'Basketball',
                district: 'Kowloon City',
                tags: ['Open Runs', 'Mixed Levels', 'Weekend Hoops'],
                requirements: 'Open to all who can run half-court and full-court rotations. New members start in mixed-level open runs.',
                description: 'A basketball club that keeps the energy high with structured open runs, skill pods, and a strong weekend presence across Kowloon courts.',
                memberIds: ['u3', 'u5', 'u7'],
                upcomingSessions: [
                    { id: 'club-hoops-1', title: 'Saturday Open Run', date: '2026-03-28', time: '10:00', venue: 'Kowloon Tsai Park', spotsLeft: 11 },
                    { id: 'club-hoops-2', title: 'Finishing and Pace Clinic', date: '2026-03-31', time: '19:00', venue: 'Hong Kong Coliseum', spotsLeft: 10 }
                ]
            }
        ].map((club) => withClubPresentation(club));

        const initialState = {
            currentUser: withPerformanceProfile({ id: 'u1', name: 'You', avatar: createProfileAvatar('You'), mmr: 1500, matchesPlayed: 12, availability: 'Evenings & Weekends', friends: ['u2', 'u3'], sports: ['Tennis', 'Badminton', 'Running'], district: 'Causeway Bay', playStyle: 'Balanced', matchmakingTags: ['open-to-all', 'beginner-friendly'], joinedClubIds: ['club-running-harbour', 'club-tennis-central'], emailVerified: true }, {
                activityMetrics: { primarySport: 'Running', totalDistanceKm: 286.4, activeMinutes: 1985, sessionsCompleted: 34, weeklyStreak: 6, weeklyDistanceKm: 26.8, averagePaceSecPerKm: 314, caloriesBurned: 16240, elevationGainM: 1480, lastSyncedAt: '2026-03-21T06:40:00.000Z', syncCount: 8 },
                watchSync: { linked: true, model: 'Galaxy Watch7', status: 'ready', batteryLevel: 82, lastSyncedAt: '2026-03-21T06:40:00.000Z', latestRunDistanceKm: 10.2, latestRunPaceSecPerKm: 311, syncCount: 8, fallbackMode: false }
            }),
            users: {
                u1: withPerformanceProfile({ id: 'u1', name: 'You', avatar: createProfileAvatar('You'), mmr: 1500, matchesPlayed: 12, availability: 'Evenings & Weekends', friends: ['u2', 'u3'], sports: ['Tennis', 'Badminton', 'Running'], district: 'Causeway Bay', playStyle: 'Balanced', matchmakingTags: ['open-to-all', 'beginner-friendly'], joinedClubIds: ['club-running-harbour', 'club-tennis-central'], emailVerified: true }, {
                    activityMetrics: { primarySport: 'Running', totalDistanceKm: 286.4, activeMinutes: 1985, sessionsCompleted: 34, weeklyStreak: 6, weeklyDistanceKm: 26.8, averagePaceSecPerKm: 314, caloriesBurned: 16240, elevationGainM: 1480, lastSyncedAt: '2026-03-21T06:40:00.000Z', syncCount: 8 },
                    watchSync: { linked: true, model: 'Galaxy Watch7', status: 'ready', batteryLevel: 82, lastSyncedAt: '2026-03-21T06:40:00.000Z', latestRunDistanceKm: 10.2, latestRunPaceSecPerKm: 311, syncCount: 8, fallbackMode: false }
                }),
                u2: withPerformanceProfile({ id: 'u2', name: 'Alex', avatar: createProfileAvatar('Alex'), mmr: 1450, matchesPlayed: 8, availability: 'Weekends', friends: ['u1'], sports: ['Tennis', 'Football'], district: 'Causeway Bay', playStyle: 'Social', matchmakingTags: ['open-to-all', 'youth-friendly'], joinedClubIds: ['club-tennis-central', 'club-football-city'], emailVerified: true }, {
                    activityMetrics: { primarySport: 'Football', totalDistanceKm: 172.1, activeMinutes: 1328, sessionsCompleted: 22, weeklyStreak: 4, weeklyDistanceKm: 18.6, averagePaceSecPerKm: 324, caloriesBurned: 10120, elevationGainM: 940, lastSyncedAt: '2026-03-19T20:15:00.000Z', syncCount: 4 }
                }),
                u3: withPerformanceProfile({ id: 'u3', name: 'Jamie', avatar: createProfileAvatar('Jamie'), mmr: 1600, matchesPlayed: 15, availability: 'Evenings', friends: ['u1'], sports: ['Basketball', 'Badminton'], district: 'Kowloon City', playStyle: 'Competitive', matchmakingTags: ['open-to-all', 'adaptive-support'], joinedClubIds: ['club-badminton-east', 'club-basketball-kowloon'], emailVerified: true }, {
                    activityMetrics: { primarySport: 'Basketball', totalDistanceKm: 205.7, activeMinutes: 1492, sessionsCompleted: 29, weeklyStreak: 5, weeklyDistanceKm: 16.4, averagePaceSecPerKm: 336, caloriesBurned: 11840, elevationGainM: 760, lastSyncedAt: '2026-03-20T18:10:00.000Z', syncCount: 3 }
                }),
                u4: withPerformanceProfile({ id: 'u4', name: 'Taylor', avatar: createProfileAvatar('Taylor'), mmr: 1550, matchesPlayed: 10, availability: 'Mornings', friends: [], sports: ['Swimming', 'Running', 'Tennis'], district: 'Tsim Sha Tsui', playStyle: 'Balanced', matchmakingTags: ['senior-friendly', 'open-to-all'], joinedClubIds: ['club-running-harbour'], emailVerified: true }, {
                    activityMetrics: { primarySport: 'Running', totalDistanceKm: 224.6, activeMinutes: 1580, sessionsCompleted: 27, weeklyStreak: 5, weeklyDistanceKm: 21.3, averagePaceSecPerKm: 322, caloriesBurned: 12910, elevationGainM: 1320, lastSyncedAt: '2026-03-21T05:55:00.000Z', syncCount: 5 },
                    watchSync: { linked: true, model: 'Galaxy Watch6 Classic', status: 'ready', batteryLevel: 69, lastSyncedAt: '2026-03-21T05:55:00.000Z', latestRunDistanceKm: 8.4, latestRunPaceSecPerKm: 320, syncCount: 5, fallbackMode: false }
                }),
                u5: withPerformanceProfile({ id: 'u5', name: 'Morgan', avatar: createProfileAvatar('Morgan'), mmr: 1525, matchesPlayed: 13, availability: 'Weekday Lunch', friends: [], sports: ['Badminton', 'Basketball'], district: 'Kowloon City', playStyle: 'Social', matchmakingTags: ['beginner-friendly', 'open-to-all'], joinedClubIds: ['club-badminton-east', 'club-basketball-kowloon'], emailVerified: true }, {
                    activityMetrics: { primarySport: 'Badminton', totalDistanceKm: 168.2, activeMinutes: 1214, sessionsCompleted: 24, weeklyStreak: 3, weeklyDistanceKm: 12.1, averagePaceSecPerKm: 330, caloriesBurned: 9620, elevationGainM: 540, lastSyncedAt: '2026-03-18T12:20:00.000Z', syncCount: 2 }
                }),
                u6: withPerformanceProfile({ id: 'u6', name: 'Casey', avatar: createProfileAvatar('Casey'), mmr: 1490, matchesPlayed: 9, availability: 'Late Evenings', friends: [], sports: ['Football', 'Volleyball', 'Tennis'], district: 'Yau Ma Tei', playStyle: 'Balanced', matchmakingTags: ['adaptive-support', 'open-to-all'], joinedClubIds: ['club-tennis-central', 'club-football-city'], emailVerified: true }, {
                    activityMetrics: { primarySport: 'Football', totalDistanceKm: 154.9, activeMinutes: 1130, sessionsCompleted: 20, weeklyStreak: 4, weeklyDistanceKm: 14.7, averagePaceSecPerKm: 326, caloriesBurned: 8850, elevationGainM: 680, lastSyncedAt: '2026-03-20T22:05:00.000Z', syncCount: 3 }
                }),
                u7: withPerformanceProfile({ id: 'u7', name: 'Jordan', avatar: createProfileAvatar('Jordan'), mmr: 1575, matchesPlayed: 16, availability: 'Sunday Afternoons', friends: [], sports: ['Athletics', 'Basketball', 'Running'], district: 'Happy Valley', playStyle: 'Competitive', matchmakingTags: ['youth-friendly', 'open-to-all'], joinedClubIds: ['club-running-harbour', 'club-basketball-kowloon'], emailVerified: true }, {
                    activityMetrics: { primarySport: 'Athletics', totalDistanceKm: 310.8, activeMinutes: 2106, sessionsCompleted: 38, weeklyStreak: 7, weeklyDistanceKm: 28.3, averagePaceSecPerKm: 304, caloriesBurned: 17690, elevationGainM: 1585, lastSyncedAt: '2026-03-21T07:05:00.000Z', syncCount: 7 }
                }),
            },
            venues: [
                { id: 'v1', name: 'Victoria Park', location: 'Causeway Bay', sport: 'Tennis', img: 'https://i.ibb.co/bRzJkQyj/04a0110f-3f08-4481-97e2-9f23c3c58220-c59b5e28-11zon-1.webp', rating: 4.5, availability: 'Open', price: 60, checkInCode: 'VP123', lat: 22.2757, lng: 114.1867, facilities: ['Showers', 'Lockers', 'Parking'], reviews: [], description: 'Popular park with tennis courts.' },
                { id: 'v2', name: 'Kowloon Tsai Park', location: 'Kowloon City', sport: 'Basketball', img: 'https://ibb.co/bgWfrxcs%22%3E%3Cimg%20src=%22https://i.ibb.co/xSC4Myx1/COTW-Kowloon-Tsai-Park-1244759867-1.webp', rating: 4.2, availability: 'Limited', price: 50, checkInCode: 'KT456', lat: 22.3263, lng: 114.1833, facilities: ['Showers', 'Lockers'], reviews: [], description: 'Outdoor basketball courts.' },
                { id: 'v3', name: 'Tseung Kwan O Sports Centre', location: 'Tseung Kwan O', sport: 'Badminton', img: 'https://i.ibb.co/vxTXHXzW/Tseung-Kwan-O-Sports-Ground-1-11zon.jpg', rating: 4.7, availability: 'Open', price: 70, checkInCode: 'TKO789', lat: 22.3068, lng: 114.255, facilities: ['Showers', 'Lockers', 'Parking', 'Cafe'], reviews: [], description: 'Indoor sports centre with badminton courts.' },
                { id: 'v4', name: 'Hong Kong Stadium', location: 'Causeway Bay', sport: 'Football', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Hong_Kong_Stadium-1.jpg/1200px-Hong_Kong_Stadium-1.jpg', rating: 4.8, availability: 'Limited', price: 100, checkInCode: 'HKS123', lat: 22.2704, lng: 114.1864, facilities: ['Showers', 'Lockers', 'Parking', 'Cafe'], reviews: [], description: 'Major stadium for football matches.' },
                { id: 'v5', name: 'South China Athletic Association', location: 'Causeway Bay', sport: 'Swimming', img: 'https://cdn.prod.website-files.com/65a51d44afb837ad70195a0b/6788a5584d2771d3f9ee47f0_South%20China%20Athletic%20Association.jpg', rating: 4.3, availability: 'Open', price: 40, checkInCode: 'SCAA456', lat: 22.2756, lng: 114.1875, facilities: ['Showers', 'Lockers'], reviews: [], description: 'Swimming pool and athletic facilities.' },
                { id: 'v6', name: 'King\'s Park Sports Ground', location: 'Yau Ma Tei', sport: 'Rugby', img: 'https://static.wixstatic.com/media/9c7e66_d16f46d96cb541efbe5cca95deff82e0.jpg/v1/fill/w_1342,h_884,al_c,q_85,usm_0.66_1.00_0.01,enc_auto/9c7e66_d16f46d96cb541efbe5cca95deff82e0.jpg', rating: 4.4, availability: 'Open', price: 80, checkInCode: 'KPSG789', lat: 22.313, lng: 114.174, facilities: ['Showers', 'Lockers', 'Parking'], reviews: [], description: 'Ground for rugby and other sports.' },
                { id: 'v7', name: 'Tai Hang Tung Recreation Ground', location: 'Shek Kip Mei', sport: 'Volleyball', img: 'https://avatars.mds.yandex.net/get-altay/5473371/2a0000017d4c007fe25651ca74fc29e5c229/L_height', rating: 4.1, availability: 'Limited', price: 55, checkInCode: 'THT123', lat: 22.328, lng: 114.169, facilities: ['Showers', 'Lockers'], reviews: [], description: 'Recreation ground with volleyball courts.' },
                { id: 'v8', name: 'Sham Shui Po Sports Ground', location: 'Sham Shui Po', sport: 'Athletics', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Sham_Shui_Po_Sports_Ground_201707.jpg/1200px-Sham_Shui_Po_Sports_Ground_201707.jpg', rating: 4.6, availability: 'Open', price: 65, checkInCode: 'SSPS456', lat: 22.3371, lng: 114.1524, facilities: ['Showers', 'Lockers', 'Parking', 'Cafe'], reviews: [], description: 'Sports ground for athletics events.' },
                { id: 'v9', name: 'Happy Valley Racecourse', location: 'Happy Valley', sport: 'Horse Racing', img: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Happy_Valley_Racecourse_1.jpg/1200px-Happy_Valley_Racecourse_1.jpg', rating: 4.9, availability: 'Open', price: 120, checkInCode: 'HVR789', lat: 22.2703, lng: 114.1760, facilities: ['Showers', 'Lockers', 'Parking', 'Cafe'], reviews: [], description: 'Famous racecourse for horse racing.' },
                { id: 'v10', name: 'Aberdeen Sports Ground', location: 'Aberdeen', sport: 'Multi-sport', img: 'https://upload.wikimedia.org/wikipedia/commons/d/d3/Aberdeen_Sports_Ground_viewed_from_Bennet%27s_Hill.jpg', rating: 4.2, availability: 'Limited', price: 70, checkInCode: 'ASG123', lat: 22.25, lng: 114.17, facilities: ['Showers', 'Lockers', 'Parking'], reviews: [], description: 'Multi-sport ground in Aberdeen.' },
                { id: 'v11', name: 'Mong Kok Stadium', location: 'Mong Kok', sport: 'Football', img: 'https://upload.wikimedia.org/wikipedia/commons/9/9f/Mong_Kok_Stadium_201504.jpg', rating: 4.5, availability: 'Open', price: 90, checkInCode: 'MKS456', lat: 22.3261, lng: 114.1729, facilities: ['Showers', 'Lockers', 'Parking', 'Cafe'], reviews: [], description: 'Stadium for football in Mong Kok.' },
                { id: 'v12', name: 'Victoria Harbour Waterfront', location: 'Tsim Sha Tsui', sport: 'Running', img: 'https://coastaltrailchallenge.hk/wp-content/uploads/2022/10/Western-Harbour-Walk-1.png', rating: 4.7, availability: 'Open', price: 0, checkInCode: 'VHW789', lat: 22.293291, lng: 114.161133, facilities: [], reviews: [], description: 'Waterfront path for running.' },
                { id: 'v13', name: 'Tai Po Sports Ground', location: 'Tai Po', sport: 'Athletics', img: 'https://upload.wikimedia.org/wikipedia/commons/1/17/Tai_Po_Sport_Ground.jpg', rating: 4.4, availability: 'Limited', price: 60, checkInCode: 'TPS123', lat: 22.447, lng: 114.163, facilities: ['Showers', 'Lockers'], reviews: [], description: 'Sports ground in Tai Po.' },
                { id: 'v14', name: 'Sha Tin Racecourse', location: 'Sha Tin', sport: 'Horse Racing', img: 'https://entertainment.hkjc.com//consvc.hkjc.com/-/media/Sites/JCEW/Entertainment/images/Plan-Your-Visit/STRC/visit-STRC-01.jpg?rev=b43b9436f7f84ea1881ebae90a5fff92&sc_lang=en-US', rating: 4.8, availability: 'Open', price: 120, checkInCode: 'STR456', lat: 22.3924, lng: 114.2039, facilities: ['Showers', 'Lockers', 'Parking', 'Cafe'], reviews: [], description: 'Racecourse in Sha Tin.' },
                { id: 'v15', name: 'Kowloon Park Swimming Pool', location: 'Tsim Sha Tsui', sport: 'Swimming', img: 'https://upload.wikimedia.org/wikipedia/commons/5/58/Kowloon_Park_Swimming_Pool_Overview_201404.jpg', rating: 4.5, availability: 'Open', price: 40, checkInCode: 'KPSP789', lat: 22.300, lng: 114.172, facilities: ['Showers', 'Lockers'], reviews: [], description: 'Public swimming pool in Kowloon Park.' },
                { id: 'v16', name: 'Lantau Trail', location: 'Lantau Island', sport: 'Hiking', img: 'https://www.discoverhongkong.com/content/dam/dhk/gohk/2023/sunset-peak/poi-2-960x720-b.jpg', rating: 4.9, availability: 'Open', price: 0, checkInCode: 'LT123', lat: 22.27, lng: 113.95, facilities: [], reviews: [], description: 'Scenic hiking trail on Lantau Island.' },
                { id: 'v17', name: 'Kwai Tsing Velodrome', location: 'Kwai Tsing', sport: 'Cycling', img: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Hong_Kong_Velodrome_front.jpg', rating: 4.6, availability: 'Open', price: 50, checkInCode: 'KTV456', lat: 22.3569, lng: 114.1056, facilities: ['Showers', 'Lockers', 'Parking'], reviews: [], description: 'Velodrome for cycling.' },
                { id: 'v18', name: 'Siu Sai Wan Sports Ground', location: 'Siu Sai Wan', sport: 'Athletics', img: 'https://upload.wikimedia.org/wikipedia/commons/7/7e/Siu_Sai_Wan_Sports_Ground_2015.jpg', rating: 4.3, availability: 'Limited', price: 55, checkInCode: 'SSWS123', lat: 22.2683, lng: 114.2458, facilities: ['Showers', 'Lockers'], reviews: [], description: 'Sports ground in Siu Sai Wan.' },
                { id: 'v19', name: 'Hong Kong Coliseum', location: 'Hung Hom', sport: 'Basketball', img: 'https://upload.wikimedia.org/wikipedia/commons/5/54/Hong_Kong_Coliseum_2022_05_part1.jpg', rating: 4.7, availability: 'Open', price: 80, checkInCode: 'HKC789', lat: 22.3014, lng: 114.1822, facilities: ['Showers', 'Lockers', 'Parking', 'Cafe'], reviews: [], description: 'Indoor arena for basketball and events.' },
                { id: 'v20', name: 'Tai Wan Shan Swimming Pool', location: 'Hung Hom', sport: 'Swimming', img: 'https://media.timeout.com/images/105912802/image.jpg', rating: 4.4, availability: 'Open', price: 40, checkInCode: 'TWSSP123', lat: 22.307, lng: 114.187, facilities: ['Showers', 'Lockers'], reviews: [], description: 'Public swimming pool in Hung Hom.' },
                { id: 'v21', name: 'Yuen Long Stadium', location: 'Yuen Long', sport: 'Football', img: 'https://upload.wikimedia.org/wikipedia/commons/2/25/Yuen_Long_Stadium.jpg', rating: 4.2, availability: 'Limited', price: 70, checkInCode: 'YLS456', lat: 22.444, lng: 114.022, facilities: ['Showers', 'Lockers', 'Parking'], reviews: [], description: 'Stadium in Yuen Long.' },
                { id: 'v22', name: 'Tsuen Wan Golf Driving Range', location: 'Tsuen Wan', sport: 'Golf', img: 'https://www.goparksaisha.hk/wp-content/uploads/2024/10/DSC8071.jpg', rating: 4.5, availability: 'Open', price: 50, checkInCode: 'TWGDR789', lat: 22.372, lng: 114.111, facilities: ['Showers', 'Lockers'], reviews: [], description: 'Golf driving range in Tsuen Wan.' },
                { id: 'v23', name: 'Shek Kip Mei Park', location: 'Shek Kip Mei', sport: 'Basketball', img: 'https://upload.wikimedia.org/wikipedia/commons/e/e2/Shek_Kip_Mei_Park_Sports_Centre.jpg', rating: 4.1, availability: 'Open', price: 0, checkInCode: 'SKMP123', lat: 22.331, lng: 114.166, facilities: [], reviews: [], description: 'Park with basketball courts.' },
                { id: 'v24', name: 'Tsing Yi Sports Ground', location: 'Tsing Yi', sport: 'Athletics', img: 'https://upload.wikimedia.org/wikipedia/commons/c/ce/Tsing_Yi_Sports_Ground.jpg', rating: 4.3, availability: 'Limited', price: 60, checkInCode: 'TYSG456', lat: 22.355, lng: 114.107, facilities: ['Showers', 'Lockers'], reviews: [], description: 'Sports ground in Tsing Yi.' },
            ].map((venue) => ({
                ...venue,
                placeholderImg: createVenueArtwork(venue)
            })),
            matches: [
                { id: 'm1', sport: 'Tennis', venueId: 'v1', date: '2025-10-25', time: '18:00', skill: 'Intermediate', totalSlots: 4, participants: ['u1', 'u2'], creatorId: 'u1', status: 'upcoming', isLeague: false, isPrivate: false, cost: 60, comments: [{ userId: 'u2', text: 'Looking forward!', time: '2h ago' }], result: null },
                { id: 'm2', sport: 'Basketball', venueId: 'v2', date: '2025-10-26', time: '10:00', skill: 'Beginner', totalSlots: 10, participants: ['u3'], creatorId: 'u3', status: 'upcoming', isLeague: true, isPrivate: false, cost: 50, comments: [], result: null },
            ],
            notifications: [
                { id: 'n1', text: 'Alex joined your Tennis match!', time: '1h ago', read: false, type: 'match_join', matchId: 'm1' },
                { id: 'n2', text: 'New venue available in your area.', time: '3h ago', read: true, type: 'venue_new', venueId: 'v3' },
            ],
            friendRequests: [
                { id: 'fr1', fromUserId: 'u4', toUserId: 'u1', message: 'Want to build a regular morning squad?', time: '35m ago', status: 'pending' },
                { id: 'fr2', fromUserId: 'u1', toUserId: 'u6', message: 'Let\'s set up an after-work session sometime.', time: 'Yesterday', status: 'pending' }
            ],
            recurringSquads: [
                { id: 'sq1', ownerId: 'u1', name: 'Harbour After Work', cadence: 'Weekly', memberIds: ['u2', 'u3'] }
            ],
            clubs: seededClubs,
            globalStats: { users: 1250, matches: 3450, courts: 420 },
            lastCheckIn: null,
            accessibility: {
                largeFont: false,
                colorblind: false,
                voicePrompts: false
            },
            languagePreference: getStoredLanguagePreference(),
        };

        const addUniqueFriendId = (friendIds = [], friendId) => (friendIds.includes(friendId) ? friendIds : [...friendIds, friendId]);

        const updateTrackedUser = (state, userId, updates) => {
            const currentRecord = state.users[userId] || state.currentUser;
            const nextUser = {
                ...currentRecord,
                ...updates
            };

            return {
                ...state,
                users: {
                    ...state.users,
                    [userId]: nextUser
                },
                currentUser: userId === state.currentUser.id
                    ? { ...state.currentUser, ...updates }
                    : state.currentUser
            };
        };

        const linkUsersAsFriends = (users, firstUserId, secondUserId) => {
            const firstUser = users[firstUserId];
            const secondUser = users[secondUserId];

            if (!firstUser || !secondUser) {
                return users;
            }

            return {
                ...users,
                [firstUserId]: { ...firstUser, friends: addUniqueFriendId(firstUser.friends, secondUserId) },
                [secondUserId]: { ...secondUser, friends: addUniqueFriendId(secondUser.friends, firstUserId) }
            };
        };

        const buildFriendRequestRecord = (state, payload) => {
            const fromUser = state.users[payload.fromUserId] || (state.currentUser.id === payload.fromUserId ? state.currentUser : null);
            const toUser = state.users[payload.toUserId] || null;

            return {
                id: `fr-${Date.now()}`,
                fromUserId: payload.fromUserId,
                toUserId: payload.toUserId,
                message: payload.message || 'Want to connect and play sometime?',
                time: 'Now',
                status: 'pending',
                senderName: fromUser?.name,
                senderAvatar: fromUser?.avatar,
                receiverName: toUser?.name,
                receiverAvatar: toUser?.avatar
            };
        };

        const getTimeBucket = (time = '') => {
            const hour = Number.parseInt((time || '').split(':')[0], 10);

            if (Number.isNaN(hour)) {
                return 'flexible';
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

        const normalizeMatchmakingTag = (value = '') => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        const availabilityMatchesSession = (availability = '', date = '', time = '') => {
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

        const buildMatchmakingSuggestions = ({ users, currentUser, selectedPlayerIds, sport, venue, date, time, playStyle, inclusionFocus }) => {
            const excludedIds = new Set(selectedPlayerIds);
            const inclusionTag = normalizeMatchmakingTag(inclusionFocus);

            return Object.values(users)
                .filter(candidate => !excludedIds.has(candidate.id))
                .map(candidate => {
                    const reasons = [];
                    let score = 45;
                    const mmrGap = Math.abs((candidate.mmr || 1500) - (currentUser.mmr || 1500));

                    if ((candidate.sports || []).includes(sport)) {
                        score += 24;
                        reasons.push(`${sport} fit`);
                    }

                    if (venue && candidate.district === venue.location) {
                        score += 14;
                        reasons.push(`near ${venue.location}`);
                    }

                    if (mmrGap <= 60) {
                        score += 16;
                        reasons.push('similar skill level');
                    } else if (mmrGap <= 150) {
                        score += 8;
                        reasons.push('compatible skill range');
                    }

                    if (availabilityMatchesSession(candidate.availability, date, time)) {
                        score += 12;
                        reasons.push('schedule overlap');
                    }

                    if (candidate.playStyle === playStyle) {
                        score += 10;
                        reasons.push(`${playStyle.toLowerCase()} style`);
                    }

                    if ((currentUser.friends || []).includes(candidate.id)) {
                        score += 8;
                        reasons.push('trusted connection');
                    }

                    if (inclusionFocus !== 'Open to All' && (candidate.matchmakingTags || []).includes(inclusionTag)) {
                        score += 12;
                        reasons.push(inclusionFocus.toLowerCase());
                    }

                    return {
                        userId: candidate.id,
                        score: Math.min(score, 98),
                        reasons: reasons.slice(0, 3),
                        status: 'queued'
                    };
                })
                .sort((firstCandidate, secondCandidate) => secondCandidate.score - firstCandidate.score)
                .slice(0, 6)
                .map((candidate, index) => ({
                    ...candidate,
                    status: index < 2 ? 'invited' : 'queued'
                }));
        };

        const createInitialMatchmakingState = ({ users, currentUser, selectedPlayerIds, totalSlots, sport, venue, date, time, playStyle, inclusionFocus, enabled }) => {
            if (!enabled) {
                return {
                    enabled: false,
                    status: 'manual',
                    confidence: 0,
                    fitSummary: 'Manual invitations only.',
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
                sport,
                venue,
                date,
                time,
                playStyle,
                inclusionFocus
            });
            const confidence = suggestions.length
                ? Math.round(suggestions.slice(0, 3).reduce((total, candidate) => total + candidate.score, 0) / Math.min(suggestions.length, 3))
                : 0;
            const leadCandidate = suggestions[0];

            return {
                enabled: true,
                status: selectedPlayerIds.length >= totalSlots ? 'filled' : (suggestions.some(candidate => candidate.status === 'invited') ? 'searching' : 'awaiting-pool'),
                confidence,
                fitSummary: leadCandidate
                    ? `Top fits align on ${leadCandidate.reasons.join(', ')}.`
                    : 'No strong partners yet. Try widening the time or venue radius.',
                inviteWave: 1,
                openSlots: Math.max(totalSlots - selectedPlayerIds.length, 0),
                preferences: { playStyle, inclusionFocus },
                suggestions
            };
        };

        const syncMatchmakingForMatch = (match) => {
            if (!match?.matchmaking) {
                return match;
            }

            const participantIds = new Set(match.participants);
            const suggestions = (match.matchmaking.suggestions || []).map((candidate) => (
                participantIds.has(candidate.userId)
                    ? { ...candidate, status: 'joined' }
                    : candidate
            ));
            const openSlots = Math.max(match.totalSlots - match.participants.length, 0);
            const hasInvited = suggestions.some((candidate) => candidate.status === 'invited');
            const hasQueued = suggestions.some((candidate) => candidate.status === 'queued');
            const status = match.matchmaking.enabled
                ? (openSlots === 0 ? 'filled' : (hasInvited ? 'searching' : (hasQueued ? 'ready' : 'manual-review')))
                : 'manual';

            return {
                ...match,
                matchmaking: {
                    ...match.matchmaking,
                    suggestions,
                    openSlots,
                    status
                }
            };
        };

        const runMatchmakingWave = (match) => {
            if (!match?.matchmaking?.enabled) {
                return { updatedMatch: syncMatchmakingForMatch(match), joinedUserIds: [] };
            }

            let inviteWave = match.matchmaking.inviteWave || 1;
            let suggestions = [...(match.matchmaking.suggestions || [])];
            let participants = [...match.participants];
            const joinedUserIds = [];

            if (participants.length >= match.totalSlots) {
                return { updatedMatch: syncMatchmakingForMatch(match), joinedUserIds };
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

            return {
                updatedMatch: syncMatchmakingForMatch({
                    ...match,
                    participants,
                    matchmaking: {
                        ...match.matchmaking,
                        suggestions,
                        inviteWave,
                        lastRunLabel: 'Just now'
                    }
                }),
                joinedUserIds
            };
        };

        const appReducer = (state, action) => {
            switch (action.type) {
                case 'SET_ACCESSIBILITY':
                    return {
                        ...state,
                        accessibility: {
                            ...state.accessibility,
                            ...action.payload
                        }
                    };
                case 'SET_LANGUAGE_PREFERENCE':
                    return {
                        ...state,
                        languagePreference: action.payload || 'en'
                    };
                case 'ADD_USER':
                    return {
                        ...state,
                        users: {
                            ...state.users,
                            [action.payload.id]: action.payload
                        }
                    };
                case 'SET_CURRENT_USER':
                    return {
                        ...state,
                        currentUser: action.payload
                    };
                case 'HYDRATE_PERSISTED_STATE':
                    return {
                        ...state,
                        currentUser: action.payload.currentUser
                            ? { ...state.currentUser, ...action.payload.currentUser }
                            : state.currentUser,
                        clubs: Array.isArray(action.payload.clubs) && action.payload.clubs.length > 0
                            ? mergeClubPresentation(action.payload.clubs, state.clubs)
                            : state.clubs,
                        users: Object.entries(action.payload.users || {}).reduce((mergedUsers, [userId, nextUser]) => ({
                            ...mergedUsers,
                            [userId]: {
                                ...(mergedUsers[userId] || {}),
                                ...nextUser
                            }
                        }), { ...state.users }),
                        matches: action.payload.matches || state.matches,
                        notifications: action.payload.notifications || state.notifications,
                        friendRequests: action.payload.friendRequests || state.friendRequests,
                        recurringSquads: action.payload.recurringSquads || state.recurringSquads,
                        lastCheckIn: action.payload.lastCheckIn || null,
                        accessibility: action.payload.accessibility || state.accessibility,
                        languagePreference: typeof action.payload.languagePreference === 'string'
                            ? action.payload.languagePreference
                            : state.languagePreference
                    };
                case 'UPDATE_USER':
                    return {
                        ...state,
                        users: {
                            ...state.users,
                            [action.payload.id]: {
                                ...state.users[action.payload.id],
                                ...action.payload.updates
                            }
                        },
                        currentUser: action.payload.id === state.currentUser.id
                            ? { ...state.currentUser, ...action.payload.updates }
                            : state.currentUser
                    };
                case 'SYNC_WATCH_CONNECTION': {
                    const userId = action.payload.userId || state.currentUser.id;
                    const baseUser = state.users[userId] || state.currentUser;

                    return updateTrackedUser(state, userId, {
                        watchSync: buildWatchSyncState({
                            ...(baseUser.watchSync || {}),
                            ...(action.payload.watchSync || {})
                        })
                    });
                }
                case 'SYNC_WATCH_ACTIVITY': {
                    const userId = action.payload.userId || state.currentUser.id;
                    const baseUser = state.users[userId] || state.currentUser;
                    const nextState = updateTrackedUser(state, userId, {
                        activityMetrics: {
                            ...buildActivityMetrics(baseUser),
                            ...(baseUser.activityMetrics || {}),
                            ...(action.payload.activityMetrics || {})
                        },
                        watchSync: buildWatchSyncState({
                            ...(baseUser.watchSync || {}),
                            ...(action.payload.watchSync || {})
                        })
                    });

                    return {
                        ...nextState,
                        notifications: [
                            ...nextState.notifications,
                            {
                                id: Date.now(),
                                text: 'Samsung watch activity synced into your Explore profile.',
                                time: 'Now',
                                read: false,
                                type: 'watch_sync'
                            }
                        ]
                    };
                }
                case 'DISCONNECT_WATCH': {
                    const userId = action.payload.userId || state.currentUser.id;
                    const baseUser = state.users[userId] || state.currentUser;

                    return updateTrackedUser(state, userId, {
                        watchSync: buildWatchSyncState({
                            ...(baseUser.watchSync || {}),
                            linked: false,
                            status: 'disconnected',
                            batteryLevel: null,
                            fallbackMode: true,
                            ...action.payload.watchSync
                        })
                    });
                }
                case 'CREATE_MATCH':
                    return {
                        ...state,
                        matches: [...state.matches, syncMatchmakingForMatch(action.payload.newMatch)],
                        notifications: [
                            ...state.notifications,
                            {
                                id: Date.now(),
                                text: `Venue secured for your ${action.payload.newMatch.sport} session.`,
                                time: 'Now',
                                read: false,
                                type: 'booking_confirmed',
                                matchId: action.payload.newMatch.id
                            }
                        ]
                    };
                case 'JOIN_MATCH': {
                    const matches = state.matches.map((match) => (
                        match.id !== action.payload.matchId || match.participants.includes(state.currentUser.id)
                            ? match
                            : syncMatchmakingForMatch({
                                ...match,
                                participants: [...match.participants, state.currentUser.id],
                                matchmaking: match.matchmaking
                                    ? { ...match.matchmaking, lastRunLabel: 'Manual join just now' }
                                    : match.matchmaking
                            })
                    ));

                    return {
                        ...state,
                        matches,
                        notifications: [
                            ...state.notifications,
                            {
                                id: Date.now(),
                                text: `${state.currentUser.name} joined the match!`,
                                time: 'Now',
                                read: false,
                                type: 'match_join',
                                matchId: action.payload.matchId
                            }
                        ]
                    };
                }
                case 'LEAVE_MATCH':
                    return {
                        ...state,
                        matches: state.matches.map((match) => (
                            match.id === action.payload.matchId
                                ? syncMatchmakingForMatch({
                                    ...match,
                                    participants: match.participants.filter((participantId) => participantId !== state.currentUser.id),
                                    matchmaking: match.matchmaking
                                        ? { ...match.matchmaking, lastRunLabel: 'Player left just now' }
                                        : match.matchmaking
                                })
                                : match
                        ))
                    };
                case 'CANCEL_MATCH':
                    return {
                        ...state,
                        matches: state.matches.map((match) => (
                            match.id === action.payload.matchId
                                ? {
                                    ...syncMatchmakingForMatch({ ...match, status: 'cancelled' }),
                                    booking: match.booking
                                        ? { ...match.booking, status: 'cancelled' }
                                        : match.booking,
                                    matchmaking: match.matchmaking
                                        ? { ...match.matchmaking, status: 'stopped' }
                                        : match.matchmaking
                                }
                                : match
                        ))
                    };
                case 'ADD_MATCH_COMMENT':
                    return {
                        ...state,
                        matches: state.matches.map((match) => (
                            match.id === action.payload.matchId
                                ? {
                                    ...match,
                                    comments: [
                                        ...match.comments,
                                        {
                                            userId: state.currentUser.id,
                                            text: action.payload.text,
                                            time: 'Now'
                                        }
                                    ]
                                }
                                : match
                        ))
                    };
                case 'REPORT_RESULT':
                    return {
                        ...state,
                        matches: state.matches.map((match) => (
                            match.id === action.payload.matchId
                                ? { ...match, result: action.payload.result, status: 'completed' }
                                : match
                        ))
                    };
                case 'CHECK_IN':
                    return {
                        ...state,
                        lastCheckIn: action.payload
                    };
                case 'CHECK_OUT':
                    return {
                        ...state,
                        lastCheckIn: null
                    };
                case 'ADD_FRIEND': {
                    const users = linkUsersAsFriends(state.users, state.currentUser.id, action.payload.friendId);

                    return {
                        ...state,
                        users,
                        currentUser: users[state.currentUser.id]
                    };
                }
                case 'SEND_FRIEND_REQUEST': {
                    const { fromUserId, toUserId } = action.payload;

                    if (!fromUserId || !toUserId || fromUserId === toUserId) {
                        return state;
                    }

                    const fromUser = state.users[fromUserId] || (state.currentUser.id === fromUserId ? state.currentUser : null);
                    const toUser = state.users[toUserId];
                    const existingPendingRequest = state.friendRequests.some((request) => (
                        request.status === 'pending'
                        && ((request.fromUserId === fromUserId && request.toUserId === toUserId)
                            || (request.fromUserId === toUserId && request.toUserId === fromUserId))
                    ));

                    if (!fromUser || !toUser || existingPendingRequest || (fromUser.friends || []).includes(toUserId)) {
                        return state;
                    }

                    return {
                        ...state,
                        friendRequests: [...state.friendRequests, buildFriendRequestRecord(state, action.payload)],
                        notifications: [
                            ...state.notifications,
                            {
                                id: Date.now(),
                                text: `Invite sent to ${toUser.name}.`,
                                time: 'Now',
                                read: false,
                                type: 'friend_request_sent'
                            }
                        ]
                    };
                }
                case 'ACCEPT_FRIEND_REQUEST': {
                    const request = state.friendRequests.find((entry) => entry.id === action.payload.requestId);

                    if (!request || request.status !== 'pending') {
                        return state;
                    }

                    const users = linkUsersAsFriends(state.users, request.fromUserId, request.toUserId);
                    const requesterName = users[request.fromUserId]?.name || request.senderName || 'Player';

                    return {
                        ...state,
                        users,
                        currentUser: users[state.currentUser.id] || state.currentUser,
                        friendRequests: state.friendRequests.map((entry) => (
                            entry.id === action.payload.requestId
                                ? { ...entry, status: 'accepted', time: 'Now' }
                                : entry
                        )),
                        notifications: [
                            ...state.notifications,
                            {
                                id: Date.now(),
                                text: `You are now connected with ${requesterName}.`,
                                time: 'Now',
                                read: false,
                                type: 'friend_request_accepted'
                            }
                        ]
                    };
                }
                case 'DECLINE_FRIEND_REQUEST': {
                    const request = state.friendRequests.find((entry) => entry.id === action.payload.requestId);

                    if (!request || request.status !== 'pending') {
                        return state;
                    }

                    return {
                        ...state,
                        friendRequests: state.friendRequests.map((entry) => (
                            entry.id === action.payload.requestId
                                ? { ...entry, status: 'declined', time: 'Now' }
                                : entry
                        ))
                    };
                }
                case 'JOIN_CLUB': {
                    const club = state.clubs.find((entry) => entry.id === action.payload.clubId);

                    if (!club || club.memberIds.includes(state.currentUser.id)) {
                        return state;
                    }

                    const nextJoinedClubIds = [...new Set([...(state.currentUser.joinedClubIds || []), club.id])];

                    return {
                        ...state,
                        clubs: state.clubs.map((entry) => (
                            entry.id === club.id
                                ? { ...entry, memberIds: [...entry.memberIds, state.currentUser.id] }
                                : entry
                        )),
                        users: {
                            ...state.users,
                            [state.currentUser.id]: {
                                ...state.users[state.currentUser.id],
                                joinedClubIds: nextJoinedClubIds
                            }
                        },
                        currentUser: {
                            ...state.currentUser,
                            joinedClubIds: nextJoinedClubIds
                        },
                        notifications: [
                            ...state.notifications,
                            {
                                id: Date.now(),
                                text: `You joined ${club.name}.`,
                                time: 'Now',
                                read: false,
                                type: 'club_join',
                                clubId: club.id
                            }
                        ]
                    };
                }
                case 'ADD_RECURRING_SQUAD':
                    return {
                        ...state,
                        recurringSquads: [
                            ...state.recurringSquads,
                            {
                                id: Date.now().toString(),
                                name: action.payload.name,
                                cadence: action.payload.cadence,
                                memberIds: action.payload.memberIds
                            }
                        ]
                    };
                case 'MARK_NOTIFICATION_READ':
                    return {
                        ...state,
                        notifications: state.notifications.map((notification) => (
                            notification.id === action.payload.id
                                ? { ...notification, read: true }
                                : notification
                        ))
                    };
                case 'MARK_NOTIFICATIONS_READ':
                    return {
                        ...state,
                        notifications: state.notifications.map((notification) => ({
                            ...notification,
                            read: true
                        }))
                    };
                case 'ADD_VENUE_REVIEW':
                    return {
                        ...state,
                        venues: state.venues.map((venue) => (
                            venue.id === action.payload.venueId
                                ? {
                                    ...venue,
                                    reviews: [
                                        ...venue.reviews,
                                        {
                                            userId: state.currentUser.id,
                                            rating: action.payload.rating,
                                            text: action.payload.text,
                                            time: 'Now'
                                        }
                                    ]
                                }
                                : venue
                        ))
                    };
                case 'ADD_MATCH_FEEDBACK':
                    return {
                        ...state,
                        matches: state.matches.map((match) => (
                            match.id === action.payload.matchId
                                ? {
                                    ...match,
                                    feedback: [
                                        ...(match.feedback || []),
                                        {
                                            userId: state.currentUser.id,
                                            targetUserId: action.payload.targetUserId || null,
                                            rating: action.payload.rating,
                                            text: action.payload.text,
                                            time: 'Now'
                                        }
                                    ]
                                }
                                : match
                        ))
                    };
                case 'RUN_MATCHMAKING_WAVE': {
                    const joinedUserIds = [];
                    const matches = state.matches.map((match) => {
                        if (match.id !== action.payload.matchId) {
                            return match;
                        }

                        const { updatedMatch, joinedUserIds: newJoinedUserIds } = runMatchmakingWave(match);
                        joinedUserIds.push(...newJoinedUserIds);
                        return updatedMatch;
                    });
                    const notifications = [...state.notifications];

                    joinedUserIds.forEach((userId, index) => {
                        notifications.push({
                            id: Date.now() + index,
                            text: `${state.users[userId]?.name || 'A player'} accepted your AI match invitation.`,
                            time: 'Now',
                            read: false,
                            type: 'ai_match_join',
                            matchId: action.payload.matchId
                        });
                    });

                    return {
                        ...state,
                        matches,
                        notifications
                    };
                }
                case 'APPLY_MATCHMAKING_RESULT': {
                    const updatedMatch = action.payload.updatedMatch;

                    if (!updatedMatch?.id) {
                        return state;
                    }

                    const joinedUserIds = action.payload.joinedUserIds || [];
                    const sourceLabel = updatedMatch.matchmaking?.decisionMeta?.source === 'gemini' ? 'Gemini' : 'AI';
                    const notifications = [...state.notifications];

                    joinedUserIds.forEach((userId, index) => {
                        notifications.push({
                            id: Date.now() + index,
                            text: `${state.users[userId]?.name || 'A player'} accepted your ${sourceLabel} match invitation.`,
                            time: 'Now',
                            read: false,
                            type: 'ai_match_join',
                            matchId: updatedMatch.id
                        });
                    });

                    return {
                        ...state,
                        matches: state.matches.map((match) => (
                            match.id === updatedMatch.id
                                ? updatedMatch
                                : match
                        )),
                        notifications
                    };
                }
                default:
                    return state;
            }
        };

        const AppStateProvider = ({ children }) => {
            const [state, dispatch] = React.useReducer(appReducer, initialState);
            const [revealedVenueImageIds, setRevealedVenueImageIds] = useState(() => new Set());
            // Accessibility: update body classes on state change
            useEffect(() => {
                document.body.classList.toggle('large-font', state.accessibility.largeFont);
                document.body.classList.remove('colorblind');
            }, [state.accessibility.largeFont, state.accessibility.colorblind]);

            useEffect(() => {
                applyLanguagePreference(state.languagePreference).catch(() => undefined);
            }, [state.languagePreference]);

            const revealVenueImage = (venueId) => {
                if (!venueId) {
                    return;
                }

                setRevealedVenueImageIds((currentIds) => {
                    if (currentIds.has(venueId)) {
                        return currentIds;
                    }

                    const nextIds = new Set(currentIds);
                    nextIds.add(venueId);
                    return nextIds;
                });
            };

            return <AppStateContext.Provider value={{ state, dispatch, revealedVenueImageIds, revealVenueImage }}>{children}</AppStateContext.Provider>;
        };

        const Modal = AppModal;

        const Header = ({ title, onBack, actionIcon, actionOnClick, onNavigate, hideNotifications = false }) => {
            const { state } = useContext(AppStateContext);
            const unreadNotifications = state.notifications.filter(n => !n.read).length;
            return (
                <header className="app-header">
                    <div className="header-side header-side-left">
                        {onBack ? (
                            <button type="button" className="header-button" onClick={onBack} aria-label="Go back">
                                <i className="fas fa-arrow-left" aria-hidden="true"></i>
                            </button>
                        ) : (
                            <span className="header-spacer" aria-hidden="true"></span>
                        )}
                    </div>
                    <div className="header-main">
                        <span className="header-kicker">GoPlayHK Network</span>
                        <h1 className="header-logo">{title}</h1>
                    </div>
                    <div className="header-side header-side-right">
                        {actionIcon ? (
                            <button type="button" className="header-button" onClick={actionOnClick} aria-label="Page action">
                                <i className={`fas ${actionIcon}`} aria-hidden="true"></i>
                            </button>
                        ) : onNavigate && !hideNotifications ? (
                            <button
                                type="button"
                                className="header-button header-notification-button"
                                onClick={() => onNavigate({ page: 'notifications', params: {} })}
                                aria-label={unreadNotifications > 0 ? `${unreadNotifications} unread notifications` : 'Open notifications'}
                            >
                                <i className="fas fa-bell" aria-hidden="true"></i>
                                {unreadNotifications > 0 && <span className="header-notification-badge">{unreadNotifications}</span>}
                            </button>
                        ) : (
                            <span className="header-sport-emblem" aria-hidden="true">
                                <i className="fas fa-bolt"></i>
                            </span>
                        )}
                    </div>
                </header>
            );
        };

        const VenueDetailPage = ({ venueId, onBack, onNavigate }) => {
            const { state, dispatch, revealedVenueImageIds, revealVenueImage } = useContext(AppStateContext);
            const showToast = useContext(ToastContext);
            const speak = useVoicePrompt();
            const venue = state.venues.find(v => v.id === venueId);
            const [modal, setModal] = useState(null);
            const [weather, setWeather] = useState(null);
            const lastCheckIn = state.lastCheckIn;
            if (!venueId || !venue) {
                showToast('Error: Venue not found');
                return <div className="page-content"><p>Loading error. Go back and try again.</p></div>;
            }
            useEffect(() => {
                revealVenueImage(venueId);
            }, [revealVenueImage, venueId]);

            useEffect(() => {
                const fetchWeather = async () => {
                    const apiKey = '37ff70b0145421b1aa91710a6822f4db';
                    try {
                        const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${venue.lat}&lon=${venue.lng}&appid=${apiKey}&units=metric`);
                        const data = await res.json();
                        setWeather(data);
                    } catch (error) {
                        showToast('Failed to fetch weather.');
                    }
                };
                fetchWeather();
            }, [venue]);
            const handleSubmitReview = (rating, text) => {
                dispatch({ type: 'ADD_VENUE_REVIEW', payload: { venueId, rating, text } });
                showToast('Review submitted!');
                speak('Thank you for your feedback!');
            };
            const handleCheckIn = (code) => {
                if (code === venue.checkInCode) {
                    dispatch({ type: 'CHECK_IN', payload: { venueId: venue.id, time: Date.now() } });
                    showToast('Checked in successfully!');
                    speak('Checked in successfully!');
                    setModal(null);
                } else {
                    showToast('Invalid code. Try again.');
                    speak('Invalid code. Try again.');
                }
            };
            const handleCheckOut = () => {
                dispatch({ type: 'CHECK_OUT' });
                showToast('Checked out successfully!');
                speak('Checked out successfully!');
                setModal(null);
            };
            const weatherDesc = weather?.weather?.[0]?.description || 'Loading...';
            const temp = weather?.main?.temp || '';
            const freeCourts = Math.floor(Math.random() * 5) + 1;
            const venueFitScore = Math.min(98, Math.round((venue.rating * 18) + freeCourts * 3));
            return (
                <div className="page-content tech-page venue-page-shell">
                    <Header title={venue.name} onBack={onBack} onNavigate={onNavigate} />
                    <div className="fade-in">
                        <section className="hero-panel venue-hero-panel">
                            <img key={getVenueDisplayImage(venue, revealedVenueImageIds)} src={getVenueDisplayImage(venue, revealedVenueImageIds)} className="venue-hero-image venue-image-fade" alt={venue.name} />
                            <span className="section-kicker">Venue dossier</span>
                            <h2 className="section-title">{venue.name}</h2>
                            <p className="text-sm mb-4">{venue.description}</p>
                            <div className="signal-badge-row">
                                <span className="signal-badge"><i className="fas fa-map-marker-alt"></i>{venue.location}</span>
                                <span className="signal-badge"><i className="fas fa-dollar-sign"></i>HKD ${venue.price}/hr</span>
                                <span className="signal-badge"><i className="fas fa-star"></i>{venue.rating}</span>
                                <span className="signal-badge"><i className="fas fa-clock"></i>{venue.availability}</span>
                                <span className="signal-badge"><i className="fas fa-table-cells"></i>{freeCourts} free courts</span>
                            </div>
                            <div className="glass-metric-grid venue-metric-grid mt-4">
                                <div className="glass-metric-card">
                                    <span className="glass-metric-label">Rating</span>
                                    <strong>{venue.rating}</strong>
                                    <p>Community score</p>
                                </div>
                                <div className="glass-metric-card">
                                    <span className="glass-metric-label">Price</span>
                                    <strong>HKD {venue.price}</strong>
                                    <p>Per hour</p>
                                </div>
                                <div className="glass-metric-card">
                                    <span className="glass-metric-label">Open Slots</span>
                                    <strong>{freeCourts}</strong>
                                    <p>Courts free now</p>
                                </div>
                                <div className="glass-metric-card">
                                    <span className="glass-metric-label">AI Fit</span>
                                    <strong>{venueFitScore}%</strong>
                                    <p>Strong for social play</p>
                                </div>
                            </div>
                            <div className="cta-button-row mt-4">
                                <button className="btn-primary" onClick={() => onNavigate({ page: 'createMatch', params: { venueId } })}>Reserve Venue</button>
                                <button className="btn-secondary" onClick={() => onNavigate({ page: 'explore', params: { venueId: venue.id } })}>View in Explore</button>
                            </div>
                        </section>
                        <div className="weather-card mt-4">
                            <i className="fas fa-cloud-sun mr-4 text-3xl"></i>
                            <div>
                                <h4 className="font-semibold">Current Weather</h4>
                                <p>{weatherDesc} - {temp}°C</p>
                            </div>
                        </div>
                        <section className="card surface-tier-2 mt-4 venue-overview-panel">
                            <div className="section-heading-row compact-heading-row">
                                <div>
                                    <span className="section-kicker">Why this venue works</span>
                                    <h3 className="section-title">Fast read before you reserve</h3>
                                </div>
                            </div>
                            <div className="signal-badge-row">
                                <span className="signal-badge"><i className="fas fa-bolt"></i>{venue.availability} booking state</span>
                                <span className="signal-badge"><i className="fas fa-people-group"></i>{venue.sport} community fit</span>
                                <span className="signal-badge"><i className="fas fa-shield-heart"></i>Inclusive access friendly</span>
                            </div>
                        </section>
                        <section className="command-section mt-4">
                        <h3 className="section-title">Facilities</h3>
                        <div className="signal-badge-row mt-3 mb-4">
                            {venue.facilities.map(f => <span key={f} className="signal-badge">{f}</span>)}
                        </div>
                        </section>
                        <section className="command-section">
                        <h3 className="section-title">Reviews</h3>
                        {venue.reviews.length === 0 ? (
                            <p className="text-sm text-gray-500">No reviews yet.</p>
                        ) : (
                            venue.reviews.map((r, i) => (
                                <div key={i} className="card mb-2">
                                    <div className="flex justify-between">
                                        <span className="font-semibold text-sm">{state.users[r.userId].name}</span>
                                        <span className="text-xs text-gray-500">{r.time}</span>
                                    </div>
                                    <p className="text-sm">{'★'.repeat(r.rating)} {'☆'.repeat(5 - r.rating)}</p>
                                    <p className="text-sm">{r.text}</p>
                                </div>
                            ))
                        )}
                        </section>
                        <div className="cta-button-row mt-4">
                            <button className="btn-secondary" onClick={() => setModal('feedback')}>Leave Feedback</button>
                            <button className="btn-primary" onClick={() => onNavigate({ page: 'createMatch', params: { venueId } })}>Start AI Session</button>
                        </div>
                        <button className="btn-secondary mt-2" onClick={() => setModal('safetyCheckIn')}>Safety Check-In</button>
                    </div>
                    {modal === 'feedback' && (
                        <FeedbackModal
                            isOpen={true}
                            close={() => setModal(null)}
                            onSubmit={handleSubmitReview}
                            type="venue"
                            targetName={venue.name}
                        />
                    )}
                    {modal === 'safetyCheckIn' && (
                        <Modal isOpen={true} close={() => setModal(null)} title="Safety Check-In">
                            {lastCheckIn ? (
                                <>
                                    <p className="text-sm mb-4">
                                        Checked in at {new Date(lastCheckIn.time).toLocaleString()}.
                                    </p>
                                    <button className="btn-primary" onClick={handleCheckOut}>
                                        Check Out
                                    </button>
                                </>
                            ) : (
                                <>
                                    <p className="text-sm mb-4">Enter venue check-in code:</p>
                                    <div className="input-group">
                                        <input
                                            type="text"
                                            placeholder="e.g., VP123"
                                            className="input-field"
                                            onKeyPress={e => e.key === 'Enter' && handleCheckIn(e.target.value)}
                                        />
                                    </div>
                                    <button
                                        className="btn-primary"
                                        onClick={() => handleCheckIn(document.querySelector('input').value)}
                                    >
                                        Check In
                                    </button>
                                </>
                            )}
                        </Modal>
                    )}
                </div>
            );
        };

        const StripeService = {
            calculateSplit: (total, participants) => Math.ceil(total / participants)
        };

        const MatchDetailPage = ({ matchId, onBack, onNavigate }) => {
            const { state, dispatch } = useContext(AppStateContext);
            const showToast = useContext(ToastContext);
            const speak = useVoicePrompt();
            const [modal, setModal] = useState(null);
            const [feeModal, setFeeModal] = useState(false);
            const [commentText, setCommentText] = useState('');
            const [isLaunchingMatchmaking, setIsLaunchingMatchmaking] = useState(false);
            const match = state.matches.find(m => m.id === matchId);
            const lastCheckIn = state.lastCheckIn;
            if (!matchId || !match) {
                showToast('Error: Match not found');
                return <div className="page-content"><p>Loading error. Go back and try again.</p></div>;
            }
            const venue = state.venues.find(v => v.id === match.venueId);
            const participants = match.participants.map(pId => state.users[pId]);
            const isJoined = match.participants.includes(state.currentUser.id);
            const isCreator = match.creatorId === state.currentUser.id;
            const isCompleted = match.status === 'completed';
            const canJoin = !isJoined && match.participants.length < match.totalSlots && !isCompleted;
            const bookingLocked = !state.currentUser.emailVerified;
            const pendingCandidates = (match.matchmaking?.suggestions || []).filter(candidate => candidate.status === 'invited' || candidate.status === 'queued');
            const fillRate = Math.round((match.participants.length / match.totalSlots) * 100);
            const handleJoin = () => {
                if (bookingLocked) {
                    showToast('Verify your email before joining or reserving sessions.');
                    onNavigate({ page: 'verificationPending', params: { blockedPage: 'matchDetail' } });
                    return;
                }

                if (match.cost > 0) {
                    setFeeModal(true);
                } else {
                    dispatch({ type: 'JOIN_MATCH', payload: { matchId } });
                    showToast('Joined match!');
                    speak('You have joined the match!');
                }
            };
            const handleConfirmJoin = () => {
                if (bookingLocked) {
                    showToast('Verify your email before joining or reserving sessions.');
                    onNavigate({ page: 'verificationPending', params: { blockedPage: 'matchDetail' } });
                    return;
                }

                dispatch({ type: 'JOIN_MATCH', payload: { matchId } });
                setFeeModal(false);
                showToast('Joined match!');
                speak('You have joined the match!');
            };
            const handleLeave = () => {
                dispatch({ type: 'LEAVE_MATCH', payload: { matchId } });
                showToast('Left match!');
                speak('You have left the match.');
            };
            const handleCancel = () => {
                dispatch({ type: 'CANCEL_MATCH', payload: { matchId } });
                showToast('Match cancelled!');
                speak('Match cancelled.');
            };
            const handleAddComment = () => {
                if (commentText.trim()) {
                    dispatch({ type: 'ADD_MATCH_COMMENT', payload: { matchId, text: commentText } });
                    setCommentText('');
                    showToast('Comment added!');
                    speak('Comment added.');
                }
            };
            const handleReportResult = (result) => {
                dispatch({ type: 'REPORT_RESULT', payload: { matchId, result } });
                setModal(null);
                showToast('Result reported!');
                speak('Result reported.');
            };
            const handleCheckIn = (code) => {
                if (code === venue.checkInCode) {
                    dispatch({ type: 'CHECK_IN', payload: { venueId: venue.id, time: Date.now() } });
                    showToast('Checked in successfully!');
                    speak('Checked in successfully!');
                    setModal(null);
                } else {
                    showToast('Invalid code. Try again.');
                    speak('Invalid code. Try again.');
                }
            };
            const handleCheckOut = () => {
                dispatch({ type: 'CHECK_OUT' });
                showToast('Checked out successfully!');
                speak('Checked out successfully!');
                setModal(null);
            };
            const handleRunMatchmaking = async () => {
                if (isLaunchingMatchmaking) {
                    return;
                }

                setIsLaunchingMatchmaking(true);

                try {
                    await new Promise((resolve) => window.setTimeout(resolve, 1100));
                    const result = await runGeminiMatchmakingWave({
                        match,
                        users: state.users
                    });

                    dispatch({
                        type: 'APPLY_MATCHMAKING_RESULT',
                        payload: {
                            updatedMatch: result.updatedMatch,
                            joinedUserIds: result.joinedUserIds
                        }
                    });

                    const source = result.updatedMatch.matchmaking?.decisionMeta?.source === 'gemini' ? 'Gemini' : 'deterministic fallback';
                    const fallbackReason = result.updatedMatch.matchmaking?.decisionMeta?.fallbackReason;
                    showToast(fallbackReason ? `${source} wave completed: ${fallbackReason}` : `${source} matchmaking wave completed.`);
                    speak('Matchmaking wave completed.');
                } catch (error) {
                    showToast(error?.message || 'The AI matchmaking wave could not be completed.');
                } finally {
                    setIsLaunchingMatchmaking(false);
                }
            };

            return (
                <div className="page-content tech-page match-page-shell">
                    {isLaunchingMatchmaking && (
                        <AiOrbitLoader
                            title="Launching the next AI wave"
                            detail="Scanning the live player graph and timing fit to pull in the strongest candidates."
                        />
                    )}
                    <Header title={`${match.sport} Match`} onBack={onBack} onNavigate={onNavigate} />
                    <div className="fade-in">
                        <section className="hero-panel match-hero-panel">
                            <span className="section-kicker">Match control room</span>
                            <h2 className="section-title">{match.sport} at {venue.name}</h2>
                            <div className="signal-badge-row mt-3">
                                <span className="signal-badge"><i className="fas fa-map-marker-alt"></i>{venue.location}</span>
                                <span className="signal-badge"><i className="fas fa-calendar-alt"></i>{match.date} • {formatHourLabel(match.time)}</span>
                                <span className="signal-badge"><i className="fas fa-users"></i>{match.participants.length}/{match.totalSlots}</span>
                                <span className="signal-badge"><i className="fas fa-dollar-sign"></i>HKD ${match.cost}</span>
                            </div>
                            <div className="glass-metric-grid match-metric-grid mt-4">
                                <div className="glass-metric-card">
                                    <span className="glass-metric-label">Confirmed</span>
                                    <strong>{match.participants.length}/{match.totalSlots}</strong>
                                    <p>Players locked in</p>
                                </div>
                                <div className="glass-metric-card">
                                    <span className="glass-metric-label">AI confidence</span>
                                    <strong>{match.matchmaking?.confidence || 0}%</strong>
                                    <p>Current fill confidence</p>
                                </div>
                                <div className="glass-metric-card">
                                    <span className="glass-metric-label">Price split</span>
                                    <strong>HKD {StripeService.calculateSplit(match.cost || 0, Math.max(match.totalSlots, 1))}</strong>
                                    <p>Per expected player</p>
                                </div>
                            </div>
                        </section>
                        {match.booking && (
                            <section className="card booking-lobby-card booking-lobby-shell surface-tier-2 mt-4">
                                <div className="section-heading-row compact-heading-row">
                                    <div>
                                        <span className="section-kicker">Post-booking lobby</span>
                                        <h3 className="section-title">Venue is confirmed, squad is filling</h3>
                                    </div>
                                    <span className="signal-badge"><i className="fas fa-building-circle-check"></i>{match.booking.status}</span>
                                </div>
                                <div className="glass-metric-grid match-lobby-grid mt-3">
                                    <div className="glass-metric-card">
                                        <span className="glass-metric-label">Reservation</span>
                                        <strong>{match.booking.status}</strong>
                                        <p>{match.booking.reservedAt}</p>
                                    </div>
                                    <div className="glass-metric-card">
                                        <span className="glass-metric-label">Payment</span>
                                        <strong>{match.booking.paymentStatus}</strong>
                                        <p>Split prepared</p>
                                    </div>
                                    <div className="glass-metric-card">
                                        <span className="glass-metric-label">AI mode</span>
                                        <strong>{match.matchmaking?.status || 'manual'}</strong>
                                        <p>Wave {match.matchmaking?.inviteWave || 0}</p>
                                    </div>
                                </div>
                                <div className="booking-progress-track mt-3">
                                    <div className="booking-progress-fill" style={{ width: `${fillRate}%` }}></div>
                                </div>
                                <div className="signal-badge-row mt-3">
                                    <span className="signal-badge"><i className="fas fa-users"></i>{match.participants.length}/{match.totalSlots} confirmed</span>
                                    <span className="signal-badge"><i className="fas fa-user-clock"></i>{match.matchmaking?.openSlots || 0} open</span>
                                    <span className="signal-badge"><i className="fas fa-wave-square"></i>Wave {match.matchmaking?.inviteWave || 0}</span>
                                    <span className="signal-badge"><i className="fas fa-brain"></i>{match.matchmaking?.decisionMeta?.source === 'gemini' ? 'Gemini assisted' : 'Deterministic fallback'}</span>
                                </div>
                                {match.matchmaking?.fitSummary && <p className="text-sm mt-3">{match.matchmaking.fitSummary}</p>}
                                {match.matchmaking?.decisionMeta?.modelName && (
                                    <p className="text-xs mt-2">Model: {match.matchmaking.decisionMeta.modelName}</p>
                                )}
                                <div className="cta-button-row mt-4">
                                    {isCreator && match.matchmaking?.enabled && match.matchmaking?.openSlots > 0 && match.status !== 'cancelled' && (
                                        <button className="btn-primary" onClick={handleRunMatchmaking} disabled={isLaunchingMatchmaking}>
                                            {isLaunchingMatchmaking ? 'Launching AI Wave...' : 'Run Next AI Match Wave'}
                                        </button>
                                    )}
                                    <button className="btn-secondary" onClick={() => onNavigate({ page: 'venueDetail', params: { venueId: venue.id } })}>
                                        Venue Detail
                                    </button>
                                </div>
                            </section>
                        )}
                        <div className="card mt-4">
                            <h4 className="font-semibold">Weather Forecast</h4>
                            <p className="text-sm text-gray-500">Sunny, 25°C (simulated)</p>
                        </div>
                        {match.matchmaking?.enabled && pendingCandidates.length > 0 && (
                            <section className="card surface-tier-1 mt-4">
                                <div className="section-heading-row compact-heading-row">
                                    <div>
                                        <span className="section-kicker">AI matchmaking</span>
                                        <h3 className="section-title">Candidate pipeline</h3>
                                    </div>
                                </div>
                                {pendingCandidates.slice(0, 4).map(candidate => (
                                    <div key={candidate.userId} className="matchmaking-candidate-row">
                                        <div>
                                            <strong>{state.users[candidate.userId]?.name}</strong>
                                            <p className="text-sm">{candidate.reasons.join(' • ')}</p>
                                        </div>
                                        <span className="signal-badge">{candidate.status} • {candidate.score}%</span>
                                    </div>
                                ))}
                            </section>
                        )}
                        <h3 className="section-title mt-4">Participants</h3>
                        <div className="flex flex-wrap mt-2 participant-roster">
                            {participants.map(p => (
                                <img
                                    key={p.id}
                                    src={p.avatar}
                                    className="w-10 h-10 rounded-full mr-2 mb-2 cursor-pointer"
                                    alt={p.name}
                                    onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: p.id } })}
                                />
                            ))}
                        </div>
                        {!isJoined && canJoin && <button className="btn-primary mt-4" onClick={handleJoin}>Join Match</button>}
                        {isJoined && !isCompleted && (
                            <button
                                className="btn-primary mt-4"
                                onClick={handleLeave}
                                style={{ backgroundColor: '#EF4444', boxShadow: '0 3px 0 #B91C1C' }}
                            >
                                Leave Match
                            </button>
                        )}
                        {isCreator && !isCompleted && (
                            <button
                                className="btn-primary mt-4"
                                onClick={handleCancel}
                                style={{ backgroundColor: '#FBBF24', boxShadow: '0 3px 0 #D97706' }}
                            >
                                Cancel Match
                            </button>
                        )}
                        {isJoined && isCompleted && !match.result && (
                            <button className="btn-primary mt-4" onClick={() => setModal('reportResult')}>
                                Report Result
                            </button>
                        )}
                        {match.result && (
                            <div className="card mt-4">
                                <h3 className="text-base font-semibold">Result</h3>
                                <p className="text-sm">Winner: {state.users[match.result.winner].name}</p>
                                <p className="text-sm">Score: {match.result.score}</p>
                            </div>
                        )}
                        <h3 className="section-title mt-4">Comments</h3>
                        <div className="mt-2">
                            {match.comments.map((c, i) => (
                                <div key={i} className="card mb-2">
                                    <div className="flex justify-between">
                                        <span className="font-semibold text-sm">{state.users[c.userId].name}</span>
                                        <span className="text-xs text-gray-500">{c.time}</span>
                                    </div>
                                    <p className="text-sm mt-1">{c.text}</p>
                                </div>
                            ))}
                            <div className="input-group">
                                <input
                                    type="text"
                                    value={commentText}
                                    onChange={e => setCommentText(e.target.value)}
                                    placeholder="Add a comment..."
                                    className="input-field"
                                    onKeyPress={e => { if (e.key === 'Enter') handleAddComment(); }}
                                />
                            </div>
                        </div>
                        <button className="btn-primary mt-4" onClick={() => setModal('feedback')}>Leave Feedback</button>
                        <button className="btn-secondary mt-4" onClick={() => setModal('safetyCheckIn')}>
                            Safety Check-In
                        </button>
                    </div>
                    {feeModal && (
                        <Modal isOpen={true} close={() => setFeeModal(false)} title="Fee Split">
                            <p className="text-sm mb-4">
                                Joining this match requires a fee of HKD $
                                {StripeService.calculateSplit(match.cost, match.participants.length + 1)} (split among
                                participants).
                            </p>
                            <button className="btn-primary" onClick={handleConfirmJoin}>
                                Confirm & Pay
                            </button>
                        </Modal>
                    )}
                    {modal === 'feedback' && (
                        <FeedbackModal
                            isOpen={true}
                            close={() => setModal(null)}
                            onSubmit={(rating, comment) => {
                                dispatch({
                                    type: 'ADD_MATCH_FEEDBACK',
                                    payload: {
                                        matchId,
                                        rating,
                                        text: comment,
                                        targetUserId: match.participants.find((participantId) => participantId !== state.currentUser.id) || null
                                    }
                                });
                                showToast('Feedback submitted!');
                                speak('Thank you for your feedback!');
                            }}
                            type="match"
                            targetName={venue.name}
                        />
                    )}
                    {modal === 'reportResult' && (
                        <Modal isOpen={true} close={() => setModal(null)} title="Report Result">
                            <p className="text-sm mb-4">Who won?</p>
                            <button
                                className="btn-primary mb-2"
                                onClick={() => handleReportResult({ winner: state.currentUser.id, score: 'Win' })}
                            >
                                I Won
                            </button>
                            <button
                                className="btn-secondary"
                                onClick={() =>
                                    handleReportResult({
                                        winner: match.participants.find(p => p !== state.currentUser.id),
                                        score: 'Loss'
                                    })
                                }
                            >
                                Opponent Won
                            </button>
                        </Modal>
                    )}
                    {modal === 'safetyCheckIn' && (
                        <Modal isOpen={true} close={() => setModal(null)} title="Safety Check-In">
                            {lastCheckIn ? (
                                <>
                                    <p className="text-sm mb-4">
                                        Checked in at {new Date(lastCheckIn.time).toLocaleString()}.
                                    </p>
                                    <button className="btn-primary" onClick={handleCheckOut}>
                                        Check Out
                                    </button>
                                </>
                            ) : (
                                <>
                                    <p className="text-sm mb-4">Enter venue check-in code:</p>
                                    <div className="input-group">
                                        <input
                                            type="text"
                                            placeholder="e.g., VP123"
                                            className="input-field"
                                            onKeyPress={e => e.key === 'Enter' && handleCheckIn(e.target.value)}
                                        />
                                    </div>
                                    <button
                                        className="btn-primary"
                                        onClick={() => handleCheckIn(document.querySelector('input').value)}
                                    >
                                        Check In
                                    </button>
                                </>
                            )}
                        </Modal>
                    )}
                </div>
            );
        };

        const CreateMatchProcess = ({ onBack, onNavigate, presetPlayers = [], presetSport = '', presetVenueId = '', venueId = '', presetDate = '', presetTime = '', presetDistrict = '', presetTotalSlots = 0, presetMatchMode = 'smart', presetInclusionFocus = 'Open to All', startAtReview = false }) => {
            const { state, dispatch, revealedVenueImageIds, revealVenueImage } = useContext(AppStateContext);
            const showToast = useContext(ToastContext);
            const [isSubmittingMatch, setIsSubmittingMatch] = useState(false);
            const resolvedVenueId = presetVenueId || venueId || '';
            const resolvedVenue = state.venues.find((venue) => venue.id === resolvedVenueId);
            const resolvedSport = presetSport || resolvedVenue?.sport || '';
            const districtOptions = [...new Set(state.venues.map((venue) => venue.location))];
            const dateOptions = getNextSevenDayOptions();
            const defaultTimeByWindow = {
                morning: '09:00',
                lunch: '12:00',
                evening: '18:00',
                late: '20:00'
            };
            const hourOptionsByWindow = {
                morning: ['07:00', '08:00', '09:00', '10:00', '11:00'],
                lunch: ['11:00', '12:00', '13:00', '14:00'],
                evening: ['17:00', '18:00', '19:00', '20:00'],
                late: ['20:00', '21:00', '22:00']
            };
            const initialStep = startAtReview ? 4 : (resolvedVenueId ? ((presetDate && presetTime) ? 3 : 2) : 1);
            const [step, setStep] = useState(initialStep);
            const [formData, setFormData] = useState({
                sport: resolvedSport,
                district: presetDistrict || resolvedVenue?.location || districtOptions[0] || '',
                date: presetDate || dateOptions[0]?.value || '',
                timeWindow: getTimeBucket(presetTime || (resolvedVenue ? '18:00' : defaultTimeByWindow.evening)),
                time: presetTime || defaultTimeByWindow.evening,
                venueId: resolvedVenueId,
                players: [state.currentUser.id, ...presetPlayers.filter((playerId) => playerId !== state.currentUser.id)],
                totalSlots: Math.max(4, presetTotalSlots || (2 + presetPlayers.length)),
                playStyle: state.currentUser.playStyle || 'Balanced',
                matchMode: presetMatchMode,
                inclusionFocus: presetInclusionFocus
            });

            const sports = ['Tennis', 'Basketball', 'Badminton', 'Football', 'Swimming', 'Rugby', 'Volleyball', 'Athletics', 'Horse Racing', 'Multi-sport'];
            const allPlayers = Object.values(state.users).filter((user) => user.id !== state.currentUser.id);
            const selectedVenue = state.venues.find((venue) => venue.id === formData.venueId) || null;
            const filteredVenues = state.venues
                .filter((venue) => !formData.sport || venue.sport === formData.sport)
                .filter((venue) => !formData.district || venue.location === formData.district)
                .sort((firstVenue, secondVenue) => secondVenue.rating - firstVenue.rating);
            const hourOptions = hourOptionsByWindow[formData.timeWindow] || hourOptionsByWindow.evening;
            const autoMatchEnabled = formData.matchMode !== 'friends';
            const inclusionFocus = formData.matchMode === 'inclusive' ? formData.inclusionFocus : 'Open to All';
            const deterministicMatchmakingPreview = useMemo(() => (selectedVenue
                ? sharedCreateInitialMatchmakingState({
                    users: state.users,
                    currentUser: state.currentUser,
                    selectedPlayerIds: formData.players,
                    totalSlots: formData.totalSlots,
                    sport: formData.sport,
                    venue: selectedVenue,
                    date: formData.date,
                    time: formData.time,
                    playStyle: formData.playStyle,
                    inclusionFocus,
                    enabled: autoMatchEnabled,
                    matches: state.matches
                })
                : null), [selectedVenue, state.users, state.currentUser, formData.players, formData.totalSlots, formData.sport, formData.date, formData.time, formData.playStyle, inclusionFocus, autoMatchEnabled, state.matches]);
            const [matchmakingPreview, setMatchmakingPreview] = useState(deterministicMatchmakingPreview);
            const [isRefreshingMatchmakingPreview, setIsRefreshingMatchmakingPreview] = useState(false);
            const perPlayerPrice = selectedVenue ? StripeService.calculateSplit(selectedVenue.price || 0, formData.totalSlots) : 0;
            const guidanceCandidates = (matchmakingPreview?.suggestions || [])
                .filter((candidate) => candidate.status !== 'joined' && !formData.players.includes(candidate.userId) && state.users[candidate.userId])
                .slice(0, Math.max(formData.totalSlots - formData.players.length, 0));
            const openPlayerSlots = Math.max(formData.totalSlots - formData.players.length, 0);

            useEffect(() => {
                let isCancelled = false;

                if (!selectedVenue) {
                    setMatchmakingPreview(null);
                    setIsRefreshingMatchmakingPreview(false);
                    return () => {
                        isCancelled = true;
                    };
                }

                setMatchmakingPreview(deterministicMatchmakingPreview);

                if (!autoMatchEnabled) {
                    setIsRefreshingMatchmakingPreview(false);
                    return () => {
                        isCancelled = true;
                    };
                }

                setIsRefreshingMatchmakingPreview(true);

                const timerId = window.setTimeout(() => {
                    createGeminiMatchmakingState({
                        users: state.users,
                        currentUser: state.currentUser,
                        selectedPlayerIds: formData.players,
                        totalSlots: formData.totalSlots,
                        sport: formData.sport,
                        venue: selectedVenue,
                        date: formData.date,
                        time: formData.time,
                        playStyle: formData.playStyle,
                        inclusionFocus,
                        enabled: autoMatchEnabled,
                        matches: state.matches
                    }).then((nextPreview) => {
                        if (!isCancelled) {
                            setMatchmakingPreview(nextPreview);
                        }
                    }).catch(() => {
                        if (!isCancelled) {
                            setMatchmakingPreview(deterministicMatchmakingPreview);
                        }
                    }).finally(() => {
                        if (!isCancelled) {
                            setIsRefreshingMatchmakingPreview(false);
                        }
                    });
                }, 300);

                return () => {
                    isCancelled = true;
                    window.clearTimeout(timerId);
                };
            }, [selectedVenue, deterministicMatchmakingPreview, autoMatchEnabled, state.users, state.currentUser, formData.players, formData.totalSlots, formData.sport, formData.date, formData.time, formData.playStyle, inclusionFocus, state.matches]);

            const updateFormData = (updates) => {
                setFormData((current) => ({ ...current, ...updates }));
            };

            const handleSportSelect = (sport) => {
                const shouldResetVenue = selectedVenue && selectedVenue.sport !== sport;
                updateFormData({
                    sport,
                    venueId: shouldResetVenue ? '' : formData.venueId
                });
            };

            const handleDistrictSelect = (district) => {
                const shouldResetVenue = selectedVenue && selectedVenue.location !== district;
                updateFormData({
                    district,
                    venueId: shouldResetVenue ? '' : formData.venueId
                });
            };

            const handleTimeWindowSelect = (timeWindow) => {
                const nextHourOptions = hourOptionsByWindow[timeWindow] || hourOptionsByWindow.evening;
                updateFormData({
                    timeWindow,
                    time: nextHourOptions.includes(formData.time) ? formData.time : defaultTimeByWindow[timeWindow]
                });
            };

            const togglePlayer = (playerId) => {
                if (formData.players.includes(playerId)) {
                    updateFormData({ players: formData.players.filter((selectedPlayerId) => selectedPlayerId !== playerId) });
                    return;
                }

                if (formData.players.length >= formData.totalSlots) {
                    showToast('Increase the player count before adding more teammates.');
                    return;
                }

                updateFormData({ players: [...formData.players, playerId] });
            };

            const handleApplySuggestedPlayers = () => {
                if (!autoMatchEnabled) {
                    return;
                }

                if (openPlayerSlots <= 0) {
                    showToast('All player slots are already filled.');
                    return;
                }

                if (guidanceCandidates.length === 0) {
                    showToast('No additional AI fits are ready to stage right now.');
                    return;
                }

                updateFormData({
                    players: [...formData.players, ...guidanceCandidates.map((candidate) => candidate.userId)]
                });
                showToast(`Added ${guidanceCandidates.length} AI-fit player${guidanceCandidates.length > 1 ? 's' : ''} to the draft roster.`);
            };

            const handleVenueSelect = (venue) => {
                revealVenueImage(venue.id);
                updateFormData({
                    venueId: venue.id,
                    sport: venue.sport,
                    district: venue.location
                });
            };

            const handleSubmit = async () => {
                if (isSubmittingMatch) {
                    return;
                }

                if (!state.currentUser.emailVerified) {
                    showToast('Verify your email before confirming a booking.');
                    onNavigate({ page: 'verificationPending', params: { blockedPage: 'createMatch' } });
                    return;
                }

                setIsSubmittingMatch(true);

                try {
                    const { matchId, newMatch } = await submitBookingReservation({
                        currentUser: state.currentUser,
                        usersById: state.users,
                        venues: state.venues,
                        selectedVenue,
                        formData,
                        autoMatchEnabled,
                        createMatchmakingState: createGeminiMatchmakingState,
                        inclusionFocus,
                        matches: state.matches
                    });

                    dispatch({
                        type: 'CREATE_MATCH',
                        payload: { newMatch }
                    });

                    if (autoMatchEnabled) {
                        const waveResult = await runGeminiMatchmakingWave({
                            match: newMatch,
                            users: state.users
                        });

                        dispatch({
                            type: 'APPLY_MATCHMAKING_RESULT',
                            payload: {
                                updatedMatch: waveResult.updatedMatch,
                                joinedUserIds: waveResult.joinedUserIds
                            }
                        });
                    }

                    showToast('Venue reserved. Route options are ready for review.');
                    onNavigate({
                        page: 'explore',
                        params: {
                            venueId: formData.venueId,
                            sport: formData.sport,
                            search: selectedVenue?.name || '',
                            autoRoute: true,
                            matchId,
                            routeSource: 'booking',
                            openGuidance: true
                        }
                    });
                } catch (error) {
                    showToast(error?.message || 'The live booking layer could not secure a slot.');
                } finally {
                    setIsSubmittingMatch(false);
                }
            };

            const handleNext = () => {
                if (step < 4) {
                    setStep(step + 1);
                }
            };

            const handlePrev = () => {
                if (step > 1) {
                    setStep(step - 1);
                }
            };

            const searchStepReady = Boolean(formData.sport && formData.district && formData.date && formData.time);
            const venueStepReady = Boolean(formData.venueId);
            const squadStepReady = Boolean(formData.totalSlots >= formData.players.length);

            return (
                <div className="page-content tech-page create-page-shell booking-flow-shell">
                    {isSubmittingMatch && (
                        <AiOrbitLoader
                            title="Securing the venue and fixing the squad"
                            detail="Locking the court, preparing route guidance, and staging your AI-filled lobby."
                        />
                    )}
                    <Header title="Reserve a Session" onBack={onBack} onNavigate={onNavigate} />
                    <section className="hero-panel create-hero-panel fade-in">
                        <span className="section-kicker">Reservation flow</span>
                        <h2 className="section-title">Secure the venue, then fill the perfect squad</h2>
                        <p>Search like a modern booking app, compare the best venue options, and let AI handle the partner hunt after checkout.</p>
                    </section>

                    <section className="booking-summary-bar surface-tier-2 fade-in">
                        <div className="booking-summary-main">
                            <span className="section-kicker">Current reservation</span>
                            <h3>{selectedVenue ? selectedVenue.name : (formData.sport ? `${formData.sport} session` : 'Start your search')}</h3>
                            <p>{formData.date || 'Select a date'} • {formData.time ? formatHourLabel(formData.time) : 'Pick an hour'} • {formData.district || 'Choose district'}</p>
                        </div>
                        <div className="booking-summary-badges">
                            <span className="signal-badge"><i className="fas fa-location-dot"></i>{formData.district || 'Area'}</span>
                            <span className="signal-badge"><i className="fas fa-users"></i>{formData.players.length}/{formData.totalSlots}</span>
                            <span className="signal-badge"><i className="fas fa-dollar-sign"></i>{selectedVenue ? `HKD ${perPlayerPrice}/player` : 'Price later'}</span>
                        </div>
                    </section>

                    <div className="booking-stepper mb-8">
                        {['Search', 'Choose Venue', 'Fill Squad', 'Review'].map((label, index) => (
                            <button key={label} className={`booking-step-pill ${step === index + 1 ? 'active' : ''}`} onClick={() => setStep(index + 1)}>
                                <span>{index + 1}</span>
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="panel-stack">
                        {step === 1 && (
                            <section className="card surface-tier-2 booking-panel fade-in">
                                <div className="section-heading-row">
                                    <div>
                                        <span className="section-kicker">Search intent</span>
                                        <h3 className="section-title">Tell us what kind of session you want</h3>
                                    </div>
                                </div>

                                <div className="booking-chip-grid">
                                    {sports.map((sport) => (
                                        <button
                                            key={sport}
                                            className={`booking-chip ${formData.sport === sport ? 'active' : ''}`}
                                            onClick={() => handleSportSelect(sport)}
                                        >
                                            {sport}
                                        </button>
                                    ))}
                                </div>

                                <div className="booking-chip-grid mt-4">
                                    {districtOptions.map((district) => (
                                        <button
                                            key={district}
                                            className={`booking-chip ${formData.district === district ? 'active' : ''}`}
                                            onClick={() => handleDistrictSelect(district)}
                                        >
                                            {district}
                                        </button>
                                    ))}
                                </div>

                                <div className="booking-field-grid mt-5">
                                    <div className="input-group">
                                        <label>Session date</label>
                                        <div className="booking-date-strip booking-date-strip-compact">
                                            {dateOptions.map((dateOption) => (
                                                <button
                                                    key={dateOption.value}
                                                    className={`booking-date-pill ${formData.date === dateOption.value ? 'active' : ''}`}
                                                    onClick={() => updateFormData({ date: dateOption.value })}
                                                >
                                                    <span>{dateOption.dayLabel}</span>
                                                    <strong>{dateOption.dateLabel}</strong>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="input-group">
                                        <label>Start time</label>
                                        <div className="booking-chip-grid booking-hour-grid">
                                            {hourOptions.map((hour) => (
                                                <button
                                                    key={hour}
                                                    className={`booking-chip booking-chip-soft ${formData.time === hour ? 'active' : ''}`}
                                                    onClick={() => updateFormData({ time: hour })}
                                                >
                                                    {formatHourLabel(hour)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="booking-chip-grid mt-4">
                                    {[
                                        { value: 'morning', label: 'Morning' },
                                        { value: 'lunch', label: 'Lunch' },
                                        { value: 'evening', label: 'Evening' },
                                        { value: 'late', label: 'Late Night' }
                                    ].map((slot) => (
                                        <button
                                            key={slot.value}
                                            className={`booking-chip booking-chip-soft ${formData.timeWindow === slot.value ? 'active' : ''}`}
                                            onClick={() => handleTimeWindowSelect(slot.value)}
                                        >
                                            {slot.label}
                                        </button>
                                    ))}
                                </div>
                            </section>
                        )}

                        {step === 2 && (
                            <section className="panel-stack fade-in">
                                <div className="section-heading-row">
                                    <div>
                                        <span className="section-kicker">Best matches</span>
                                        <h3 className="section-title">Pick a venue from live-style results</h3>
                                    </div>
                                    <span className="signal-badge"><i className="fas fa-layer-group"></i>{filteredVenues.length} options</span>
                                </div>

                                {filteredVenues.length === 0 ? (
                                    <div className="card surface-tier-1 booking-panel">
                                        <p className="text-sm">No venues match this search yet. Try a different district or sport.</p>
                                    </div>
                                ) : (
                                    filteredVenues.map((venue) => {
                                        const isSelected = formData.venueId === venue.id;
                                        return (
                                            <button key={venue.id} className={`booking-result-card ${isSelected ? 'active' : ''}`} onClick={() => handleVenueSelect(venue)}>
                                                                    <img key={getVenueDisplayImage(venue, revealedVenueImageIds)} src={getVenueDisplayImage(venue, revealedVenueImageIds)} alt={venue.name} className="booking-result-image venue-image-fade" />
                                                <div className="booking-result-copy">
                                                    <div className="section-heading-row compact-heading-row">
                                                        <div>
                                                            <span className="section-kicker">{venue.location}</span>
                                                            <h3 className="section-title">{venue.name}</h3>
                                                        </div>
                                                        <span className="signal-badge"><i className="fas fa-star"></i>{venue.rating}</span>
                                                    </div>
                                                    <p>{venue.description}</p>
                                                    <div className="signal-badge-row mt-3">
                                                        <span className="signal-badge"><i className="fas fa-table-tennis-paddle-ball"></i>{venue.sport}</span>
                                                        <span className="signal-badge"><i className="fas fa-bolt"></i>{venue.availability}</span>
                                                        <span className="signal-badge"><i className="fas fa-dollar-sign"></i>HKD {venue.price}</span>
                                                    </div>
                                                    <div className="signal-badge-row mt-3">
                                                        {venue.facilities.slice(0, 3).map((facility) => (
                                                            <span key={facility} className="signal-badge">{facility}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </section>
                        )}

                        {step === 3 && (
                            <section className="card surface-tier-2 booking-panel fade-in">
                                <div className="section-heading-row">
                                    <div>
                                        <span className="section-kicker">Squad strategy</span>
                                        <h3 className="section-title">Choose how the session gets filled</h3>
                                    </div>
                                </div>

                                <div className="booking-mode-grid">
                                    {[
                                        { value: 'friends', title: 'Friends only', detail: 'You fill the roster manually and keep the session private.', icon: 'fa-user-group' },
                                        { value: 'smart', title: 'Smart auto-fill', detail: 'GoPlayHK invites the best-fit players based on skill, location, and timing.', icon: 'fa-wand-magic-sparkles' },
                                        { value: 'inclusive', title: 'Inclusive auto-fill', detail: 'AI prioritizes inclusive preferences like beginner, adaptive, youth, or senior fit.', icon: 'fa-shield-heart' }
                                    ].map((mode) => (
                                        <button
                                            key={mode.value}
                                            className={`booking-mode-card ${formData.matchMode === mode.value ? 'active' : ''}`}
                                            onClick={() => updateFormData({ matchMode: mode.value })}
                                        >
                                            <i className={`fas ${mode.icon}`}></i>
                                            <strong>{mode.title}</strong>
                                            <p>{mode.detail}</p>
                                        </button>
                                    ))}
                                </div>

                                <div className="booking-chip-grid mt-4">
                                    {[4, 6, 8, 10].map((slotCount) => (
                                        <button
                                            key={slotCount}
                                            className={`booking-chip ${formData.totalSlots === slotCount ? 'active' : ''}`}
                                            onClick={() => updateFormData({ totalSlots: slotCount })}
                                        >
                                            {slotCount} players
                                        </button>
                                    ))}
                                </div>

                                <div className="booking-chip-grid mt-4">
                                    {['Balanced', 'Social', 'Competitive'].map((style) => (
                                        <button
                                            key={style}
                                            className={`booking-chip booking-chip-soft ${formData.playStyle === style ? 'active' : ''}`}
                                            onClick={() => updateFormData({ playStyle: style })}
                                        >
                                            {style}
                                        </button>
                                    ))}
                                </div>

                                {formData.matchMode === 'inclusive' && (
                                    <div className="booking-chip-grid mt-4">
                                        {['Beginner Friendly', 'Adaptive Support', 'Senior Friendly', 'Youth Friendly'].map((option) => (
                                            <button
                                                key={option}
                                                className={`booking-chip booking-chip-soft ${formData.inclusionFocus === option ? 'active' : ''}`}
                                                onClick={() => updateFormData({ inclusionFocus: option })}
                                            >
                                                {option}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <div className="section-heading-row mt-5">
                                    <div>
                                        <span className="section-kicker">Invite friends</span>
                                        <h3 className="section-title">Lock in the players you already know</h3>
                                    </div>
                                    <span className="signal-badge"><i className="fas fa-users"></i>{formData.players.length}/{formData.totalSlots} locked</span>
                                </div>

                                <div className="friend-select-grid">
                                    {allPlayers.map((player) => {
                                        const isSelected = formData.players.includes(player.id);
                                        return (
                                            <button key={player.id} className={`friend-select-card ${isSelected ? 'active' : ''}`} onClick={() => togglePlayer(player.id)}>
                                                <img src={player.avatar} alt={player.name} className="friend-signal-avatar" />
                                                <div className="signal-card-copy">
                                                    <h4>{player.name}</h4>
                                                    <p>{player.playStyle} • {player.availability}</p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>

                                {matchmakingPreview && autoMatchEnabled && (
                                    <div className="card surface-tier-1 mt-5 booking-preview-card booking-guidance-card">
                                        <span className="section-kicker">AI preview</span>
                                        <h3 className="section-title">How the app will auto-fill after reservation</h3>
                                        <p>{matchmakingPreview.fitSummary}</p>
                                        <div className="signal-badge-row mt-3">
                                            <span className="signal-badge"><i className="fas fa-brain"></i>{matchmakingPreview.confidence}% confidence</span>
                                            <span className="signal-badge"><i className="fas fa-user-plus"></i>{matchmakingPreview.openSlots} slots to fill</span>
                                            <span className="signal-badge"><i className="fas fa-bolt"></i>{openPlayerSlots} manual slots open</span>
                                            <span className="signal-badge"><i className="fas fa-microchip"></i>{matchmakingPreview.decisionMeta?.source === 'gemini' ? 'Gemini assisted' : 'Deterministic fallback'}</span>
                                        </div>
                                        {isRefreshingMatchmakingPreview && <p className="text-xs mt-3">Gemini is refining the candidate order.</p>}
                                        {matchmakingPreview.decisionMeta?.modelName && <p className="text-xs mt-2">Model: {matchmakingPreview.decisionMeta.modelName}</p>}
                                        <div className="booking-guidance-actions mt-4">
                                            <button className="btn-primary" onClick={handleApplySuggestedPlayers} disabled={guidanceCandidates.length === 0 || openPlayerSlots === 0}>
                                                Apply Top AI Fits
                                            </button>
                                            <p className="booking-guidance-note">
                                                {guidanceCandidates.length > 0
                                                    ? `Stage ${guidanceCandidates.length} suggested player${guidanceCandidates.length > 1 ? 's' : ''} into the draft now, then review before checkout.`
                                                    : 'AI will keep the rest of the guidance as post-booking suggestions until you free up more slots.'}
                                            </p>
                                        </div>
                                        {(matchmakingPreview.suggestions || []).slice(0, 3).map((candidate) => (
                                            <div key={candidate.userId} className="matchmaking-candidate-row">
                                                <div>
                                                    <strong>{state.users[candidate.userId]?.name}</strong>
                                                    <p>{candidate.reasons.join(' • ')}</p>
                                                </div>
                                                <span className="signal-badge">{candidate.score}%</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {!autoMatchEnabled && (
                                    <div className="card surface-tier-1 mt-5 booking-preview-card booking-guidance-card booking-guidance-card-manual">
                                        <span className="section-kicker">Friends-only mode</span>
                                        <h3 className="section-title">You control the full roster</h3>
                                        <p>AI auto-fill is disabled for this session, so add confirmed players manually until the lineup is complete.</p>
                                    </div>
                                )}
                            </section>
                        )}

                        {step === 4 && (
                            <section className="card surface-tier-2 booking-panel fade-in">
                                <div className="section-heading-row">
                                    <div>
                                        <span className="section-kicker">Checkout review</span>
                                        <h3 className="section-title">Review the reservation before locking it in</h3>
                                    </div>
                                </div>

                                <div className="booking-review-grid">
                                    <div className="booking-review-row"><span>Sport</span><strong>{formData.sport}</strong></div>
                                    <div className="booking-review-row"><span>Venue</span><strong>{selectedVenue?.name || 'Not selected'}</strong></div>
                                    <div className="booking-review-row"><span>District</span><strong>{formData.district}</strong></div>
                                    <div className="booking-review-row"><span>Start</span><strong>{formData.date} • {formatHourLabel(formData.time)}</strong></div>
                                    <div className="booking-review-row"><span>Session style</span><strong>{formData.playStyle}</strong></div>
                                    <div className="booking-review-row"><span>Fill mode</span><strong>{formData.matchMode === 'friends' ? 'Friends only' : formData.matchMode === 'smart' ? 'Smart auto-fill' : `Inclusive auto-fill • ${formData.inclusionFocus}`}</strong></div>
                                    <div className="booking-review-row"><span>Players locked</span><strong>{formData.players.map((playerId) => state.users[playerId]?.name || 'You').join(', ')}</strong></div>
                                    <div className="booking-review-row"><span>Projected split</span><strong>{selectedVenue ? `HKD ${perPlayerPrice}/player` : 'Select venue first'}</strong></div>
                                </div>

                                {matchmakingPreview && autoMatchEnabled && (
                                    <div className="booking-review-callout mt-4">
                                        <strong>{matchmakingPreview.confidence}% AI confidence</strong>
                                        <p>{matchmakingPreview.openSlots} slots will be filled after reservation confirmation.</p>
                                    </div>
                                )}
                            </section>
                        )}
                    </div>

                    <div className="booking-flow-actions mt-6">
                        {step > 1 && <button className="btn-secondary" onClick={handlePrev}>Back</button>}
                        {step === 1 && <button className="btn-primary" onClick={handleNext} disabled={!searchStepReady}>See Venue Options</button>}
                        {step === 2 && <button className="btn-primary" onClick={handleNext} disabled={!venueStepReady}>Continue to Squad Plan</button>}
                        {step === 3 && <button className="btn-primary" onClick={handleNext} disabled={!squadStepReady}>Review Reservation</button>}
                        {step === 4 && (
                            <button
                                className="btn-primary"
                                onClick={handleSubmit}
                                disabled={isSubmittingMatch || !searchStepReady || !venueStepReady || !squadStepReady}
                            >
                                {isSubmittingMatch ? 'Building AI Lobby...' : 'Confirm Venue and Open Lobby'}
                            </button>
                        )}
                    </div>
                </div>
            );
        };

        const FriendsHubPage = ({ onBack, onNavigate }) => {
            const { state } = useContext(AppStateContext);
            const squad = state.currentUser.friends.map(friendId => state.users[friendId]).filter(Boolean);
            const incomingRequests = state.friendRequests.filter(request => request.toUserId === state.currentUser.id && request.status === 'pending');
            const outgoingRequests = state.friendRequests.filter(request => request.fromUserId === state.currentUser.id && request.status === 'pending');
            const recommendations = Object.values(state.users).filter(user => user.id !== state.currentUser.id && !state.currentUser.friends.includes(user.id)).slice(0, 3);
            const upcomingWithFriends = state.matches.filter(match => match.status === 'upcoming' && match.participants.some(participantId => state.currentUser.friends.includes(participantId)));
            const panels = [
                { page: 'friendsSquad', kicker: 'Squad board', title: 'Manage your core players', detail: `${squad.length} connected teammates.`, icon: 'fa-user-group' },
                { page: 'friendsDiscover', kicker: 'Discovery', title: 'Find new players nearby', detail: `${recommendations.length} suggested profiles.`, icon: 'fa-compass' },
                { page: 'friendsInvites', kicker: 'Invites', title: 'Process pending requests', detail: `${incomingRequests.length} in • ${outgoingRequests.length} out.`, icon: 'fa-envelope-open-text' },
                { page: 'friendsRecurring', kicker: 'Recurring squads', title: 'Save regular teams', detail: `${state.recurringSquads.length} repeat squads.`, icon: 'fa-people-group' }
            ];

            return (
                <div className="page-content tech-page friends-page-shell">
                    <Header title="Friends" onBack={onBack} onNavigate={onNavigate} />
                    <section className="hero-panel friends-hero-panel fade-in surface-tier-3">
                        <span className="section-kicker">Community graph</span>
                        <h2 className="section-title">Run your sports circle like a real network</h2>
                        <p>Manage your squad, invites, and repeat groups here.</p>
                        <div className="signal-badge-row mt-3">
                            <span className="signal-badge"><i className="fas fa-user-group"></i>{squad.length} active friends</span>
                            <span className="signal-badge"><i className="fas fa-envelope"></i>{incomingRequests.length} pending invites</span>
                            <span className="signal-badge"><i className="fas fa-calendar-check"></i>{upcomingWithFriends.length} sessions with friends</span>
                        </div>
                    </section>
                    <section className="friends-nav-grid fade-in">
                        {panels.map(panel => (
                            <button key={panel.page} className="signal-card friends-nav-card surface-tier-2" onClick={() => onNavigate({ page: panel.page, params: {} })}>
                                <span className="metric-icon"><i className={`fas ${panel.icon}`}></i></span>
                                <span className="section-kicker">{panel.kicker}</span>
                                <h3>{panel.title}</h3>
                                <p>{panel.detail}</p>
                            </button>
                        ))}
                    </section>
                    <section className="card friends-overview-panel surface-tier-2 fade-in">
                        <div className="section-heading-row compact-heading-row">
                            <div>
                                <span className="section-kicker">Live squad preview</span>
                                <h3 className="section-title">Who you can coordinate with right now</h3>
                            </div>
                        </div>
                        <div className="panel-stack">
                            {squad.slice(0, 3).map(friend => (
                                <button
                                    key={friend.id}
                                    type="button"
                                    className="signal-card friend-signal-card friend-preview-button surface-tier-1"
                                    onClick={() => {
                                        console.log('FriendsHub: preview click', friend.id);
                                        onNavigate({ page: 'playerProfile', params: { playerId: friend.id } });
                                    }}
                                >
                                    <img src={friend.avatar} className="friend-signal-avatar" alt={friend.name} />
                                    <div className="signal-card-copy">
                                        <h4>{friend.name}</h4>
                                        <p>{friend.availability}</p>
                                    </div>
                                    <span className="presence-pill">Available</span>
                                </button>
                            ))}
                        </div>
                    </section>
                </div>
            );
        };

        const FriendsSquadPage = ({ onBack, onNavigate }) => {
            const { state } = useContext(AppStateContext);
            const squad = state.currentUser.friends.map(friendId => state.users[friendId]).filter(Boolean);
            const matchesWithFriends = state.matches.filter(match => match.participants.includes(state.currentUser.id) && match.participants.some(participantId => state.currentUser.friends.includes(participantId)));

            return (
                <div className="page-content tech-page friends-page-shell">
                    <Header title="My Squad" onBack={onBack} onNavigate={onNavigate} />
                    <section className="hero-panel friends-subpage-hero fade-in surface-tier-3">
                        <span className="section-kicker">Squad board</span>
                        <h2 className="section-title">Keep your most reliable players close</h2>
                        <p>Jump into profiles, start a session with a preset squadmate, and track which matches already include friends.</p>
                    </section>
                    <section className="panel-stack fade-in">
                        {squad.map(friend => (
                            <div key={friend.id} className="card friends-member-card surface-tier-2">
                                <div className="friends-member-main" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: friend.id } })}>
                                    <img src={friend.avatar} className="friend-signal-avatar large-avatar" alt={friend.name} />
                                    <div className="signal-card-copy">
                                        <h4>{friend.name}</h4>
                                        <p>{friend.availability}</p>
                                        <div className="signal-badge-row">
                                            <span className="signal-badge"><i className="fas fa-chart-line"></i>{friend.mmr} MMR</span>
                                            <span className="signal-badge"><i className="fas fa-medal"></i>{friend.matchesPlayed} matches</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="friends-card-actions">
                                    <button className="btn-secondary" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: friend.id } })}>Open Profile</button>
                                    <button className="btn-primary" onClick={() => onNavigate({ page: 'createMatch', params: { presetPlayers: [friend.id] } })}>Start Session</button>
                                </div>
                            </div>
                        ))}
                    </section>
                    <button className="btn-secondary w-full mt-4" onClick={() => onNavigate({ page: 'friendsRecurring', params: {} })}>Open Recurring Squads</button>
                    <section className="card friends-overview-panel surface-tier-2 fade-in">
                        <div className="section-heading-row compact-heading-row">
                            <div>
                                <span className="section-kicker">Shared schedule</span>
                                <h3 className="section-title">Upcoming sessions with friends</h3>
                            </div>
                        </div>
                        {matchesWithFriends.length === 0 ? (
                            <div className="friends-empty-state surface-tier-1">
                                <h4>No shared sessions yet</h4>
                                <p>Use Start Session on a squadmate card to spin up a match with a pre-filled roster.</p>
                            </div>
                        ) : (
                            matchesWithFriends.map(match => (
                                <div key={match.id} className="booking-item tech-booking-item surface-tier-1" onClick={() => onNavigate({ page: 'matchDetail', params: { matchId: match.id } })}>
                                    <div className="booking-details">
                                        <h4>{match.sport} • {match.date}</h4>
                                        <p>{match.participants.filter(participantId => state.currentUser.friends.includes(participantId)).length} friends in this session</p>
                                    </div>
                                    <span className="presence-pill">Live roster</span>
                                </div>
                            ))
                        )}
                    </section>
                </div>
            );
        };

        const FriendsRecurringPage = ({ onBack, onNavigate }) => {
            const { state, dispatch } = useContext(AppStateContext);
            const showToast = useContext(ToastContext);
            const squadMates = state.currentUser.friends.map(friendId => state.users[friendId]).filter(Boolean);
            const recurringSquads = state.recurringSquads.filter(squad => squad.ownerId === state.currentUser.id);
            const [squadName, setSquadName] = useState('');
            const [cadence, setCadence] = useState('Weekly');
            const [selectedMemberIds, setSelectedMemberIds] = useState([]);

            const toggleMember = (friendId) => {
                setSelectedMemberIds(current => current.includes(friendId) ? current.filter(id => id !== friendId) : [...current, friendId]);
            };

            const handleCreateRecurringSquad = () => {
                if (!squadName.trim() || selectedMemberIds.length === 0) {
                    showToast('Add a squad name and at least one squadmate.');
                    return;
                }

                dispatch({
                    type: 'CREATE_RECURRING_SQUAD',
                    payload: {
                        name: squadName.trim(),
                        cadence,
                        memberIds: selectedMemberIds
                    }
                });
                setSquadName('');
                setCadence('Weekly');
                setSelectedMemberIds([]);
                showToast('Recurring squad created.');
            };

            return (
                <div className="page-content tech-page friends-page-shell">
                    <Header title="Recurring Squads" onBack={onBack} onNavigate={onNavigate} />
                    <section className="hero-panel friends-subpage-hero fade-in surface-tier-3">
                        <span className="section-kicker">Repeat coordination</span>
                        <h2 className="section-title">Save your regular teams and relaunch them fast</h2>
                        <p>Keep repeat groups ready for one-tap match setup.</p>
                    </section>
                    <section className="card friends-overview-panel surface-tier-2 fade-in">
                        <div className="section-heading-row compact-heading-row">
                            <div>
                                <span className="section-kicker">Create squad</span>
                                <h3 className="section-title">Build a recurring lineup</h3>
                            </div>
                        </div>
                        <div className="input-group">
                            <label>Squad Name</label>
                            <input className="input-field" value={squadName} onChange={e => setSquadName(e.target.value)} placeholder="e.g. Harbour Tuesday Crew" />
                        </div>
                        <div className="input-group">
                            <label>Cadence</label>
                            <select className="input-field" value={cadence} onChange={e => setCadence(e.target.value)}>
                                <option value="Weekly">Weekly</option>
                                <option value="Biweekly">Biweekly</option>
                                <option value="Monthly">Monthly</option>
                            </select>
                        </div>
                        <div className="recurring-squad-selector">
                            {squadMates.map(friend => (
                                <button key={friend.id} className={`map-venue-chip ${selectedMemberIds.includes(friend.id) ? 'active' : ''}`} onClick={() => toggleMember(friend.id)}>
                                    {friend.name}
                                </button>
                            ))}
                        </div>
                        <button className="btn-primary mt-4" onClick={handleCreateRecurringSquad}>Save Recurring Squad</button>
                    </section>
                    <section className="panel-stack fade-in">
                        {recurringSquads.length === 0 ? (
                            <div className="friends-empty-state surface-tier-1">
                                <h4>No recurring squads yet</h4>
                                <p>Save a regular lineup here so you can relaunch the same group without rebuilding the roster each time.</p>
                            </div>
                        ) : (
                            recurringSquads.map(squad => (
                                <div key={squad.id} className="card friends-member-card surface-tier-2">
                                    <div className="signal-card-copy">
                                        <span className="section-kicker">{squad.cadence}</span>
                                        <h4>{squad.name}</h4>
                                        <p>{squad.memberIds.map(memberId => state.users[memberId]?.name).filter(Boolean).join(', ')}</p>
                                    </div>
                                    <div className="friends-card-actions">
                                        <button className="btn-secondary" onClick={() => onNavigate({ page: 'friendsSquad', params: {} })}>View Squad</button>
                                        <button className="btn-primary" onClick={() => onNavigate({ page: 'createMatch', params: { presetPlayers: squad.memberIds } })}>Launch Session</button>
                                    </div>
                                </div>
                            ))
                        )}
                    </section>
                </div>
            );
        };

        const FriendsDiscoverPage = ({ onBack, onNavigate }) => {
            const { state, dispatch } = useContext(AppStateContext);
            const showToast = useContext(ToastContext);
            const pendingRequestUserIds = state.friendRequests
                .filter(request => request.status === 'pending' && (request.fromUserId === state.currentUser.id || request.toUserId === state.currentUser.id))
                .flatMap(request => [request.fromUserId, request.toUserId]);
            const recommendations = Object.values(state.users).filter(user =>
                user.id !== state.currentUser.id &&
                !state.currentUser.friends.includes(user.id) &&
                !pendingRequestUserIds.includes(user.id)
            );

            const handleInvite = (userId) => {
                dispatch({
                    type: 'SEND_FRIEND_REQUEST',
                    payload: {
                        fromUserId: state.currentUser.id,
                        toUserId: userId,
                        message: 'Want to connect and play sometime?'
                    }
                });
                showToast('Friend invite sent.');
            };

            return (
                <div className="page-content tech-page friends-page-shell">
                    <Header title="Discover Players" onBack={onBack} onNavigate={onNavigate} />
                    <section className="hero-panel friends-subpage-hero fade-in surface-tier-3">
                        <span className="section-kicker">Discovery layer</span>
                        <h2 className="section-title">Find players beyond your current circle</h2>
                        <p>Send lightweight invites to people who fit your availability and keep network growth separate from profile settings.</p>
                    </section>
                    <section className="panel-stack fade-in">
                        {recommendations.map(user => (
                            <div key={user.id} className="card friends-member-card surface-tier-2">
                                <div className="friends-member-main" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: user.id } })}>
                                    <img src={user.avatar} className="friend-signal-avatar large-avatar" alt={user.name} />
                                    <div className="signal-card-copy">
                                        <h4>{user.name}</h4>
                                        <p>{user.availability}</p>
                                        <div className="signal-badge-row">
                                            <span className="signal-badge"><i className="fas fa-chart-line"></i>{user.mmr} MMR</span>
                                            <span className="signal-badge"><i className="fas fa-satellite-dish"></i>Suggested nearby</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="friends-card-actions">
                                    <button className="btn-secondary" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: user.id } })}>View Profile</button>
                                    <button className="btn-primary" onClick={() => handleInvite(user.id)}>Send Invite</button>
                                </div>
                            </div>
                        ))}
                    </section>
                </div>
            );
        };

        const FriendsInvitesPage = ({ onBack, onNavigate }) => {
            const { state, dispatch } = useContext(AppStateContext);
            const showToast = useContext(ToastContext);
            const incomingRequests = state.friendRequests.filter(request => request.toUserId === state.currentUser.id && request.status === 'pending');
            const outgoingRequests = state.friendRequests.filter(request => request.fromUserId === state.currentUser.id && request.status === 'pending');

            const handleAccept = (requestId) => {
                dispatch({ type: 'ACCEPT_FRIEND_REQUEST', payload: { requestId } });
                showToast('Friend request accepted.');
            };

            const handleDecline = (requestId) => {
                dispatch({ type: 'DECLINE_FRIEND_REQUEST', payload: { requestId } });
                showToast('Friend request declined.');
            };

            return (
                <div className="page-content tech-page friends-page-shell">
                    <Header title="Invites" onBack={onBack} onNavigate={onNavigate} />
                    <section className="hero-panel friends-subpage-hero fade-in surface-tier-3">
                        <span className="section-kicker">Request queue</span>
                        <h2 className="section-title">Manage incoming and outgoing invitations</h2>
                        <p>Accept the right connections quickly and keep pending outreach visible in one place.</p>
                    </section>
                    <section className="card friends-overview-panel surface-tier-2 fade-in">
                        <div className="section-heading-row compact-heading-row">
                            <div>
                                <span className="section-kicker">Incoming</span>
                                <h3 className="section-title">Players waiting for your approval</h3>
                            </div>
                        </div>
                        {incomingRequests.length === 0 ? (
                            <div className="friends-empty-state surface-tier-1">
                                <h4>No incoming requests</h4>
                                <p>Your network is quiet right now. Discovery invites will show up here as they arrive.</p>
                            </div>
                        ) : (
                            incomingRequests.map(request => {
                                const sender = state.users[request.fromUserId];
                                return sender ? (
                                    <div key={request.id} className="card friends-request-card surface-tier-1">
                                        <div className="friends-member-main" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: sender.id } })}>
                                            <img src={sender.avatar} className="friend-signal-avatar large-avatar" alt={sender.name} />
                                            <div className="signal-card-copy">
                                                <h4>{sender.name}</h4>
                                                <p>{request.message}</p>
                                                <span className="text-xs">{request.time}</span>
                                            </div>
                                        </div>
                                        <div className="friends-card-actions">
                                            <button className="btn-secondary" onClick={() => handleDecline(request.id)}>Decline</button>
                                            <button className="btn-primary" onClick={() => handleAccept(request.id)}>Accept</button>
                                        </div>
                                    </div>
                                ) : null;
                            })
                        )}
                    </section>
                    <section className="card friends-overview-panel surface-tier-2 fade-in">
                        <div className="section-heading-row compact-heading-row">
                            <div>
                                <span className="section-kicker">Outgoing</span>
                                <h3 className="section-title">Invites you have already sent</h3>
                            </div>
                        </div>
                        {outgoingRequests.length === 0 ? (
                            <div className="friends-empty-state surface-tier-1">
                                <h4>No outgoing invites</h4>
                                <p>Use Discover Players to expand your network with a few high-quality invites.</p>
                            </div>
                        ) : (
                            outgoingRequests.map(request => {
                                const receiver = state.users[request.toUserId];
                                return receiver ? (
                                    <div key={request.id} className="card friends-request-card surface-tier-1">
                                        <div className="friends-member-main" onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: receiver.id } })}>
                                            <img src={receiver.avatar} className="friend-signal-avatar large-avatar" alt={receiver.name} />
                                            <div className="signal-card-copy">
                                                <h4>{receiver.name}</h4>
                                                <p>{request.message}</p>
                                                <span className="text-xs">Sent {request.time}</span>
                                            </div>
                                        </div>
                                        <span className="presence-pill">Pending</span>
                                    </div>
                                ) : null;
                            })
                        )}
                    </section>
                </div>
            );
        };

        const PlayerProfilePage = ({ playerId, onBack, onNavigate }) => {
            const { state, dispatch } = useContext(AppStateContext);
            const showToast = useContext(ToastContext);
            const [editing, setEditing] = useState(false);
            const [editName, setEditName] = useState('');
            const [editAvailability, setEditAvailability] = useState('');
            const [editAvatar, setEditAvatar] = useState('');
            const { theme, toggleTheme } = useContext(ThemeContext);
            const accessibility = state.accessibility;
            const handleAccessibilityChange = (key) => (e) => {
                dispatch({ type: 'SET_ACCESSIBILITY', payload: { [key]: e.target.checked } });
            };

            if (!playerId) {
                showToast('Error: Player ID missing');
                return <div className="page-content"><p>Loading error. Go back and try again.</p></div>;
            }
            const player = state.users[playerId] || {
                name: 'Unknown',
                avatar: 'https://placehold.co/80x80/png?text=Unknown',
                mmr: 0,
                matchesPlayed: 0,
                availability: 'N/A',
                friends: []
            };
            const isFriend = state.currentUser.friends.includes(playerId);
            const isOwnProfile = state.currentUser.id === playerId;
            const recentMatches = state.matches.filter(m => m.participants.includes(playerId)).slice(0, 5);

            const handleAddFriend = () => {
                dispatch({ type: 'ADD_FRIEND', payload: { friendId: playerId } });
                showToast(`Added ${player.name} as friend!`);
            };

            const handleEdit = () => {
                setEditName(player.name);
                setEditAvailability(player.availability);
                setEditAvatar(player.avatar);
                setEditing(true);
            };

            const handleSaveEdit = () => {
                dispatch({ 
                    type: 'UPDATE_USER', 
                    payload: { 
                        id: playerId, 
                        updates: { name: editName, availability: editAvailability, avatar: editAvatar } 
                    } 
                });
                setEditing(false);
                showToast('Profile updated!');
            };

            const handleSignOut = () => {
                auth.signOut();
                showToast("You've been signed out.");
            };

            return (
                <div className="page-content tech-page profile-page-shell">
                    <Header
                        title={player.name}
                        onBack={onBack}
                        actionIcon={isOwnProfile ? 'fa-sign-out-alt' : null}
                        actionOnClick={isOwnProfile ? handleSignOut : null}
                    />
                    <div className="profile-header fade-in profile-hero-panel">
                        <img
                            src={player.avatar}
                            className="profile-picture"
                            alt={player.name}
                            onError={(e) => {
                                e.target.src = 'https://placehold.co/80x80/png?text=Unknown';
                            }}
                        />
                        <div className="profile-hero-copy">
                            <span className="section-kicker">Player identity</span>
                            <h2 className="text-lg font-semibold">{player.name}</h2>
                            <p className="text-sm">{player.availability}</p>
                        </div>
                    </div>
                    <div className="card">
                        <h3 className="text-base font-semibold mb-2">Profile Details</h3>
                        {editing ? (
                            <>
                                <div className="input-group">
                                    <label>Name</label>
                                    <input
                                        type="text"
                                        value={editName}
                                        onChange={e => setEditName(e.target.value)}
                                        className="input-field"
                                    />
                                </div>
                                <div className="input-group">
                                    <label>Availability</label>
                                    <input
                                        type="text"
                                        value={editAvailability}
                                        onChange={e => setEditAvailability(e.target.value)}
                                        className="input-field"
                                    />
                                </div>
                                <div className="input-group">
                                    <label>Avatar URL</label>
                                    <input
                                        type="text"
                                        value={editAvatar}
                                        onChange={e => setEditAvatar(e.target.value)}
                                        className="input-field"
                                    />
                                </div>
                                <button className="btn-primary mt-4" onClick={handleSaveEdit}>Save</button>
                                <button className="btn-secondary mt-2" onClick={() => setEditing(false)}>Cancel</button>
                            </>
                        ) : (
                            <>
                                <p className="text-sm"><strong>MMR:</strong> {player.mmr}</p>
                                <p className="text-sm"><strong>Matches Played:</strong> {player.matchesPlayed}</p>
                                <p className="text-sm"><strong>Availability:</strong> {player.availability}</p>
                                {isOwnProfile && <button className="btn-primary mt-4" onClick={handleEdit}>Edit Profile</button>}
                            </>
                        )}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div className="profile-stat surface-tier-1">
                            <span className="profile-stat-value">{player.mmr}</span>
                            <span className="profile-stat-label">MMR</span>
                        </div>
                        <div className="profile-stat surface-tier-1">
                            <span className="profile-stat-value">{player.matchesPlayed}</span>
                            <span className="profile-stat-label">Matches</span>
                        </div>
                        <button type="button" className="profile-stat surface-tier-1 profile-stat-clickable" onClick={() => isOwnProfile && onNavigate({ page: 'friendsHub', params: {} })}>
                            <span className="profile-stat-value">{player.friends ? player.friends.length : 0}</span>
                            <span className="profile-stat-label">Friends</span>
                        </button>
                    </div>
                    {isOwnProfile && <button className="btn-secondary mt-4" onClick={() => onNavigate({ page: 'friendsHub', params: {} })}>Open Friends Hub</button>}
                    {!isFriend && !isOwnProfile && (
                        <button className="btn-primary mt-4" onClick={handleAddFriend}>
                            Add Friend
                        </button>
                    )}
                    <div className="card mt-4">
                        <h3 className="text-base font-semibold mb-2">Friends</h3>
                        <div className="panel-stack">
                            {player.friends?.map(fId => {
                                const friend = state.users[fId];
                                return friend ? (
                                    <div
                                        key={fId}
                                        className="signal-card friend-signal-card"
                                        onClick={() => onNavigate({ page: 'playerProfile', params: { playerId: fId } })}
                                    >
                                        <img
                                            src={friend.avatar}
                                            className="friend-signal-avatar"
                                            alt={friend.name}
                                        />
                                        <div className="signal-card-copy">
                                            <h4>{friend.name}</h4>
                                            <p>{friend.availability}</p>
                                        </div>
                                        <span className="presence-pill">Connected</span>
                                    </div>
                                ) : null;
                            })}
                        </div>
                    </div>
                    <div className="card mt-4">
                        <h3 className="text-base font-semibold mb-2">Recent Matches</h3>
                        {recentMatches.length === 0 ? (
                            <p className="text-sm text-gray-500">No recent matches.</p>
                        ) : (
                            recentMatches.map(match => (
                                <div
                                    key={match.id}
                                    className="booking-item"
                                    onClick={() => onNavigate({ page: 'matchDetail', params: { matchId: match.id } })}
                                >
                                    <div className="booking-details">
                                        <h4>{match.sport} - {match.date}</h4>
                                        <p>Status: {match.status}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    {isOwnProfile && (
                        <div className="card mt-4">
                            <h3 className="text-base font-semibold mb-2">Settings</h3>
                            <div className="flex justify-between items-center mb-2">
                                <span>Dark Mode</span>
                                <label className="switch">
                                    <input 
                                        type="checkbox" 
                                        checked={theme === 'dark'} 
                                        onChange={toggleTheme} 
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <div className="flex justify-between items-center mb-2">
                                <span>Large Font</span>
                                <label className="switch">
                                    <input type="checkbox" checked={accessibility.largeFont} onChange={handleAccessibilityChange('largeFont')} />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <div className="flex justify-between items-center mb-2">
                                <span>Colorblind Mode</span>
                                <label className="switch">
                                    <input type="checkbox" checked={accessibility.colorblind} onChange={handleAccessibilityChange('colorblind')} />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <div className="flex justify-between items-center mb-2">
                                <span>Voice Prompts</span>
                                <label className="switch">
                                    <input type="checkbox" checked={accessibility.voicePrompts} onChange={handleAccessibilityChange('voicePrompts')} />
                                    <span className="slider"></span>
                                </label>
                            </div>
                        </div>
                    )}
                    {isOwnProfile && (
                        <button
                            className="btn-secondary w-full mt-2"
                            onClick={() => {
                                localStorage.removeItem('hasSeenQuickGuide');
                                showToast('Quick Guide will appear on next login!');
                            }}
                        >
                            Show Quick Guide Again
                        </button>
                    )}
                </div>
            );
        };

        const NotificationsPage = ({ onBack, onNavigate }) => {
            const { state, dispatch } = useContext(AppStateContext);
            useEffect(() => {
                dispatch({ type: 'MARK_NOTIFICATIONS_READ' });
            }, []);

            const handleNotificationClick = (n) => {
                dispatch({ type: 'MARK_NOTIFICATION_READ', payload: { id: n.id } });
                if (n.type === 'match_join' && n.matchId) {
                    onNavigate({ page: 'matchDetail', params: { matchId: n.matchId } });
                } else if (n.type === 'venue_new' && n.venueId) {
                    onNavigate({ page: 'venueDetail', params: { venueId: n.venueId } });
                } else {
                    // Default action or alert the text
                    alert(n.text);
                }
            };

            return (
                <div className="page-content tech-page notifications-page-shell">
                    <Header title="Notifications" onBack={onBack} onNavigate={onNavigate} hideNotifications />
                    <section className="hero-panel notifications-hero-panel fade-in">
                        <span className="section-kicker">Activity feed</span>
                        <h2 className="section-title">Signals from your sports network</h2>
                        <p>Stay on top of joins, venue updates, and system prompts that affect your next session.</p>
                    </section>
                    <ul className="notification-list fade-in">
                        {state.notifications.length === 0 ? (
                            <p className="text-sm text-gray-500 p-4">No notifications.</p>
                        ) : (
                            state.notifications.map(n => (
                                <li
                                    key={n.id}
                                    className={`notification-item tech-notification-item ${n.read ? '' : 'unread'}`}
                                    onClick={() => handleNotificationClick(n)}
                                >
                                    <div className="notification-copy">
                                        <span className="signal-badge notification-type-badge">{n.type === 'match_join' ? 'Match' : 'Venue'}</span>
                                        <p className="text-sm">{n.text}</p>
                                    </div>
                                    <span className="text-xs text-gray-500">{n.time}</span>
                                </li>
                            ))
                        )}
                    </ul>
                </div>
            );
        };

        const RewardsPage = ({ onBack, onNavigate }) => {
            const { state } = useContext(AppStateContext);
            const completedMatches = state.matches.filter(match => match.status === 'completed' || match.result).length;
            const derivedPoints = state.currentUser.matchesPlayed * 35 + state.currentUser.friends.length * 20 + completedMatches * 40;
            const totalPoints = state.currentUser.rewardPoints ?? derivedPoints;
            const nextTierTarget = 1200;
            const progress = Math.min(100, Math.round((totalPoints / nextTierTarget) * 100));
            const rewardTracks = [
                { title: 'Match Streak', value: `${Math.max(2, completedMatches)} sessions`, detail: 'Weekly activity bonus.', icon: 'fa-fire' },
                { title: 'Community Builder', value: `${state.currentUser.friends.length} friends`, detail: 'Squad growth progress.', icon: 'fa-user-group' },
                { title: 'Venue Explorer', value: `${new Set(state.matches.map(match => match.venueId)).size} venues`, detail: 'District badge progress.', icon: 'fa-location-dot' }
            ];

            return (
                <div className="page-content tech-page rewards-page-shell">
                    <Header title="Rewards" onBack={onBack} onNavigate={onNavigate} />
                    <section className="hero-panel rewards-hero-panel fade-in surface-tier-3">
                        <span className="section-kicker">Player progression</span>
                        <h2 className="section-title">Turn activity into rewards and status</h2>
                        <p>Track momentum, streaks, and venue progress.</p>
                        <div className="signal-badge-row mt-3">
                            <span className="signal-badge"><i className="fas fa-bolt"></i>{totalPoints} momentum points</span>
                            <span className="signal-badge"><i className="fas fa-crown"></i>{progress}% to next tier</span>
                        </div>
                    </section>
                    <section className="card rewards-progress-panel surface-tier-2 fade-in">
                        <div className="section-heading-row compact-heading-row">
                            <div>
                                <span className="section-kicker">Tier progress</span>
                                <h3 className="section-title">City Circuit Level</h3>
                            </div>
                        </div>
                        <div className="rewards-progress-track">
                            <div className="rewards-progress-fill" style={{ width: `${progress}%` }}></div>
                        </div>
                        <p className="route-summary-line">Progress toward your next tier.</p>
                    </section>
                    <section className="rewards-grid fade-in">
                        {rewardTracks.map((track) => (
                            <div key={track.title} className="signal-card rewards-card surface-tier-1">
                                <span className="metric-icon"><i className={`fas ${track.icon}`}></i></span>
                                <h3>{track.title}</h3>
                                <p className="rewards-card-value">{track.value}</p>
                                <p>{track.detail}</p>
                            </div>
                        ))}
                    </section>
                    <section className="card rewards-cta-panel surface-tier-2 fade-in">
                        <div>
                            <span className="section-kicker">Best next move</span>
                            <h3 className="section-title">Book another session to grow your streak</h3>
                        </div>
                        <button className="btn-primary" onClick={() => onNavigate({ page: 'booking', params: {} })}>Open Bookings</button>
                    </section>
                </div>
            );
        };

        const Chatbot = React.memo(({ isOpen, onClose, onNavigate, currentView }) => {
            const showToast = useContext(ToastContext);
            const { state } = useContext(AppStateContext);
            const upcomingMatch = state.matches.find(match => match.participants.includes(state.currentUser.id) && match.status === 'upcoming');
            const recommendedVenue = state.venues[0];
            const [messages, setMessages] = useState(defaultGreetingMessages);
            const [input, setInput] = useState('');
            const inputRef = useRef(null);

            const replyContext = useMemo(() => ({
                upcomingMatch,
                recommendedVenue,
                currentView,
                currentUserId: state.currentUser.id
            }), [upcomingMatch, recommendedVenue, currentView, state.currentUser.id]);

            useEffect(() => {
                if (!isOpen) {
                    return undefined;
                }

                const handleKeyDown = (event) => {
                    if (event.key === 'Escape') {
                        onClose();
                    }
                };

                window.addEventListener('keydown', handleKeyDown);
                return () => window.removeEventListener('keydown', handleKeyDown);
            }, [isOpen, onClose]);

            useEffect(() => {
                if (!isOpen) {
                    return undefined;
                }

                const timer = window.setTimeout(() => {
                    inputRef.current?.focus();
                }, 120);

                return () => window.clearTimeout(timer);
            }, [isOpen]);

            const handleSend = (overrideInput) => {
                const nextInput = (overrideInput ?? input).trim();
                if (!nextInput) return;
                const assistantReply = buildAssistantReply(nextInput, replyContext);
                const stamp = Date.now();
                setMessages(prev => [
                    ...prev,
                    { id: stamp, text: nextInput, type: 'user' },
                    { id: stamp + 1, text: assistantReply.text, type: 'bot', actions: assistantReply.actions }
                ]);
                setInput('');
            };

            const handleActionClick = (action) => {
                if (!action) {
                    return;
                }

                switch (action.type) {
                    case 'prompt':
                        handleSend(action.prompt);
                        break;
                    case 'navigate':
                        onClose();
                        onNavigate({ page: action.page, params: action.params || {} });
                        break;
                    case 'copy':
                        if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            navigator.clipboard.writeText(action.value || '').then(() => {
                                showToast(action.feedback || 'Copied to clipboard.');
                            }, () => {
                                showToast('Clipboard access denied.');
                            });
                        } else {
                            showToast('Clipboard unavailable.');
                        }
                        break;
                    case 'modal':
                        showToast(action.message || 'Action completed.');
                        break;
                    default:
                        if (action.page) {
                            onClose();
                            onNavigate({ page: action.page, params: action.params || {} });
                        }
                }
            };

            if (!isOpen) return null;

            return (
                <div className="modal-overlay open" style={{ zIndex: 1000 }}>
                    <div className="modal-content chatbot-modal">
                        <div className="chatbot-shell-header">
                            <div>
                                <span className="section-kicker">Assistant layer</span>
                                <h3 className="text-lg font-semibold chatbot-title">GoPlayHK Concierge</h3>
                                <p className="chatbot-subtitle">Fast actions for bookings, routes, squads, and rewards.</p>
                            </div>
                            <button className="header-button" onClick={onClose} aria-label="Close assistant">
                                <i className="fas fa-times text-[#FC9905]"></i>
                            </button>
                        </div>
                        <div className="chatbot-quick-action-row" role="toolbar" aria-label="Quick assistant actions">
                            {quickActions.map(item => (
                                <button
                                    key={item.id}
                                    className="chatbot-preset-chip"
                                    onClick={() => handleSend(item.prompt)}
                                    aria-label={item.description}
                                    type="button"
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                        <div
                            className="chatbot-messages flex-grow overflow-y-auto"
                            style={{ maxHeight: '56vh' }}
                            role="log"
                            aria-live="polite"
                            aria-label="Assistant conversation"
                        >
                            {messages.map(m => (
                                <div key={m.id} className={`chatbot-message-row ${m.type === 'bot' ? 'bot' : 'user'}`}>
                                    <div className={`chatbot-message-bubble ${m.type === 'bot' ? 'bot' : 'user'}`}>
                                        <p>{m.text}</p>
                                        {m.actions?.length > 0 && (
                                            <div className="chatbot-message-actions">
                                                {m.actions.map((action, index) => (
                                                    <button
                                                        key={`${action.label}-${index}`}
                                                        className="chatbot-action-chip"
                                                        onClick={() => handleActionClick(action.action)}
                                                        type="button"
                                                    >
                                                        {action.label}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="chatbot-composer-row">
                            <input
                                ref={inputRef}
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                className="input-field chatbot-composer-input"
                                placeholder="Ask for a route, booking, squad help, or rewards update"
                                onKeyPress={e => e.key === 'Enter' && handleSend()}
                            />
                            <button className="btn-primary chatbot-send-button" onClick={() => handleSend()} type="button">Send</button>
                        </div>
                    </div>
                </div>
            );
        });

        const App = ({ onBootReady, onBootStage }) => {
        const showToast = useContext(ToastContext);
        const { state, dispatch, revealedVenueImageIds, revealVenueImage } = useContext(AppStateContext);
        const { theme, themePreference, toggleTheme, applySystemTheme } = useContext(ThemeContext);
        const speak = useVoicePrompt();
        const [view, setView] = useState({ page: 'home', params: {} });
        const [viewHistory, setViewHistory] = useState([{ page: 'home', params: {} }]);
        const [authResolved, setAuthResolved] = useState(false);
        const [bootReadySent, setBootReadySent] = useState(false);
        const [isAuthenticated, setIsAuthenticated] = useState(false);
        const [authView, setAuthView] = useState('intro');
        const [pendingVerification, setPendingVerification] = useState({ email: '', displayName: '' });
        const [currentUser, setCurrentUser] = useState(null);
        const [chatOpen, setChatOpen] = useState(false);
        const usersRef = useRef(state.users);
        const appShellRef = useRef(null);
        const pendingProfileRef = useRef(null);
        const googleRedirectHydratingRef = useRef(false);
        const googleRedirectHandledRef = useRef('');
        const cloudReadyRef = useRef(false);
        const cloudHydratingRef = useRef(false);
        const lastPersistedCloudStateRef = useRef('');
        const [socialProfiles, setSocialProfiles] = useState({});
        const [socialPresence, setSocialPresence] = useState({});
        const [socialFriendIds, setSocialFriendIds] = useState([]);
        const [socialFriendRequests, setSocialFriendRequests] = useState([]);
        const [socialSyncReady, setSocialSyncReady] = useState(false);
        const [buttonPosition, setButtonPosition] = useState(() => {
            const saved = localStorage.getItem('chatButtonPosition');
            return saved ? JSON.parse(saved) : { top: '50%', right: '16px' };
        });
        const [isButtonVisible, setIsButtonVisible] = useState(true);
        const [isDragging, setIsDragging] = useState(false);
        const [showQuickGuide, setShowQuickGuide] = useState(false);
        const pointerDragRef = useRef(null);
        const suppressChatOpenRef = useRef(false);

        const getChatButtonBounds = () => {
            const buttonSize = 64;
            const shellRect = appShellRef.current?.getBoundingClientRect();
            const shellTop = shellRect?.top ?? 0;
            const shellLeft = shellRect?.left ?? 0;
            const shellRight = shellRect?.right ?? window.innerWidth;
            const shellBottom = shellRect?.bottom ?? window.innerHeight;
            const minTop = Math.max(shellTop + 16, 16);
            const maxTop = Math.max(minTop, shellBottom - buttonSize - 108);
            const minRight = Math.max(window.innerWidth - shellRight + 16, 16);
            const maxRight = Math.max(minRight, window.innerWidth - shellLeft - buttonSize - 16);

            return { minTop, maxTop, minRight, maxRight };
        };

        const clampChatButtonPosition = (position) => {
            if (typeof window === 'undefined') {
                return position;
            }

            const { minTop, maxTop, minRight, maxRight } = getChatButtonBounds();
            const parsedTop = position.top === '50%' ? window.innerHeight * 0.5 : Number.parseFloat(position.top);
            const parsedRight = Number.parseFloat(position.right);
            const safeTop = Number.isFinite(parsedTop) ? Math.min(maxTop, Math.max(minTop, parsedTop)) : Math.max(minTop, Math.min(maxTop, window.innerHeight * 0.5));
            const safeRight = Number.isFinite(parsedRight) ? Math.min(maxRight, Math.max(minRight, parsedRight)) : minRight;

            return {
                top: `${Math.round(safeTop)}px`,
                right: `${Math.round(safeRight)}px`
            };
        };

        const isChatPointOverTrash = (clientX, clientY) => {
            const trashCan = document.querySelector('.trash-can');

            if (!trashCan) {
                return false;
            }

            const trashRect = trashCan.getBoundingClientRect();

            return clientX >= trashRect.left
                && clientX <= trashRect.right
                && clientY >= trashRect.top
                && clientY <= trashRect.bottom;
        };

        useEffect(() => {
            localStorage.setItem('chatButtonPosition', JSON.stringify(buttonPosition));
        }, [buttonPosition]);

        useEffect(() => {
            if (typeof window === 'undefined' || !isAuthenticated || !isButtonVisible) {
                return undefined;
            }

            const syncButtonPosition = () => {
                setButtonPosition((previousPosition) => {
                    const nextPosition = clampChatButtonPosition(previousPosition);

                    if (nextPosition.top === previousPosition.top && nextPosition.right === previousPosition.right) {
                        return previousPosition;
                    }

                    return nextPosition;
                });
            };

            syncButtonPosition();
            window.addEventListener('resize', syncButtonPosition);
            return () => window.removeEventListener('resize', syncButtonPosition);
        }, [isAuthenticated, isButtonVisible]);

        useEffect(() => {
            usersRef.current = state.users;
        }, [state.users]);

        const socialUsers = useMemo(() => {
            const mergedUsers = { ...socialProfiles };

            Object.entries(mergedUsers).forEach(([userId, profile]) => {
                const presence = socialPresence[userId] || {};
                mergedUsers[userId] = {
                    id: userId,
                    ...profile,
                    name: profile.displayName || profile.name,
                    availability: presence.online ? (presence.availability || 'Online now') : (profile.availability || 'Offline'),
                    liveStatus: presence.online ? 'Online' : 'Offline',
                    friends: userId === state.currentUser?.id ? socialFriendIds : (profile.friends || [])
                };
            });

            if (state.currentUser?.id && !mergedUsers[state.currentUser.id]) {
                mergedUsers[state.currentUser.id] = {
                    ...state.currentUser,
                    liveStatus: socialPresence[state.currentUser.id]?.online ? 'Online' : 'Offline',
                    availability: socialPresence[state.currentUser.id]?.availability || state.currentUser.availability,
                    friends: socialFriendIds
                };
            }

            return mergedUsers;
        }, [socialFriendIds, socialPresence, socialProfiles, state.currentUser]);

        const socialCurrentUser = useMemo(() => {
            if (!state.currentUser?.id) {
                return null;
            }

            return socialUsers[state.currentUser.id] || {
                ...state.currentUser,
                friends: socialFriendIds
            };
        }, [socialFriendIds, socialUsers, state.currentUser]);

        const socialState = useMemo(() => ({
            currentUser: socialCurrentUser || state.currentUser,
            users: socialUsers,
            friendRequests: socialFriendRequests
        }), [socialCurrentUser, socialFriendRequests, socialUsers, state.currentUser]);
        const isBookingUnlocked = Boolean(currentUser?.emailVerified);

        useEffect(() => {
            if (isAuthenticated && currentUser?.uid) {
                return;
            }

            cloudReadyRef.current = false;
            cloudHydratingRef.current = false;
            lastPersistedCloudStateRef.current = '';
            pendingProfileRef.current = null;
            googleRedirectHandledRef.current = '';
            setSocialProfiles({});
            setSocialPresence({});
            setSocialFriendIds([]);
            setSocialFriendRequests([]);
        }, [currentUser, isAuthenticated]);

        useEffect(() => {
            if (typeof window === 'undefined') {
                return undefined;
            }

            const { intent } = readGoogleRedirectState();

            if (intent !== 'login' && intent !== 'register') {
                return undefined;
            }

            let cancelled = false;

            const consumeRedirectResult = async () => {
                try {
                    await enableAppCheckIfConfigured();
                    await getRedirectResult(auth);
                } catch (error) {
                    if (cancelled) {
                        return;
                    }

                    clearGoogleRedirectState();
                    showToast(error?.message || 'Google sign-in could not be completed.');
                }
            };

            consumeRedirectResult();

            return () => {
                cancelled = true;
            };
        }, [showToast]);

        useEffect(() => {
            onBootStage?.('mounted');
        }, [onBootStage]);

        useEffect(() => {
            if (isAuthenticated && currentUser) {
                const hasSeenGuide = localStorage.getItem('hasSeenQuickGuide');
                if (!hasSeenGuide) {
                    // Show once per device/browser
                    setTimeout(() => setShowQuickGuide(true), 800);
                    localStorage.setItem('hasSeenQuickGuide', 'true'); // Set immediately
                }
            }
        }, [isAuthenticated, currentUser]);

        useEffect(() => {
            if (!authResolved || !isAuthenticated) {
                return undefined;
            }

            const cleanupLoading = queueAuthenticatedLoading();
            let idleId = null;
            let timeoutId = null;

            const warmSecurity = () => {
                enableAnalyticsIfConfigured();
                enableAppCheckIfConfigured();
            };

            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                idleId = window.requestIdleCallback(warmSecurity, { timeout: 2600 });
            } else {
                timeoutId = window.setTimeout(warmSecurity, 1800);
            }

            return () => {
                cleanupLoading?.();

                if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
                    window.cancelIdleCallback(idleId);
                }

                if (timeoutId !== null) {
                    window.clearTimeout(timeoutId);
                }
            };
        }, [authResolved, isAuthenticated]);

        useEffect(() => queueNavigationWarmup(view.page), [view.page]);

        useEffect(() => {
            if (bootReadySent) {
                return undefined;
            }

            const frameId = window.requestAnimationFrame(() => {
                onBootReady?.({ authenticated: false, authPending: true });
                setBootReadySent(true);
            });

            return () => window.cancelAnimationFrame(frameId);
        }, [bootReadySent, onBootReady]);

        const handleDragStart = (e) => {
            setIsDragging(true);
            e.dataTransfer.setData('text/plain', 'chatButton');
            const button = e.target;
            const rect = button.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;
            e.dataTransfer.setData('offsetX', offsetX);
            e.dataTransfer.setData('offsetY', offsetY);
        };

        const handleDragEnd = () => {
            setIsDragging(false);
        };

        const handleDragOver = (e) => {
            e.preventDefault();
        };

        const handleDrop = (e) => {
            e.preventDefault();
            setIsDragging(false);
            const offsetX = parseFloat(e.dataTransfer.getData('offsetX'));
            const offsetY = parseFloat(e.dataTransfer.getData('offsetY'));
            let newTop = e.clientY - offsetY;
            let newRight = window.innerWidth - e.clientX - offsetX;
            const { minTop, maxTop, minRight, maxRight } = getChatButtonBounds();

            newTop = Math.max(minTop, Math.min(newTop, maxTop));
            newRight = Math.max(minRight, Math.min(newRight, maxRight));

            const trashCan = document.querySelector('.trash-can');
            if (trashCan) {
            const trashRect = trashCan.getBoundingClientRect();
            const buttonRect = {
                left: e.clientX - offsetX,
                top: e.clientY - offsetY,
                right: e.clientX - offsetX + 48,
                bottom: e.clientY - offsetY + 48
            };

            const isOverTrash =
                buttonRect.left < trashRect.right &&
                buttonRect.right > trashRect.left &&
                buttonRect.top < trashRect.bottom &&
                buttonRect.bottom > trashRect.top;

            if (isOverTrash) {
                setIsButtonVisible(false);
                showToast('Chat button removed. Refresh to restore.');
                return;
            }
            }

            if (newTop > window.innerHeight * 0.8 && newRight > window.innerWidth * 0.8) {
            setIsButtonVisible(false);
            showToast('Chat button removed. Refresh to restore.');
            return;
            }

            setButtonPosition({ top: `${newTop}px`, right: `${newRight}px` });
        };

        const handleDoubleClick = () => {
            setIsButtonVisible(false);
            showToast('Chat button removed. Refresh to restore.');
        };

        const handleFloatingPointerDown = (event) => {
            if (event.pointerType === 'mouse') {
                return;
            }

            const clampedPosition = clampChatButtonPosition(buttonPosition);
            const currentTarget = event.currentTarget;

            pointerDragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startTop: Number.parseFloat(clampedPosition.top),
                startRight: Number.parseFloat(clampedPosition.right),
                moved: false
            };

            currentTarget.setPointerCapture?.(event.pointerId);
        };

        const handleFloatingPointerMove = (event) => {
            const pointerState = pointerDragRef.current;

            if (!pointerState || pointerState.pointerId !== event.pointerId) {
                return;
            }

            const deltaX = event.clientX - pointerState.startX;
            const deltaY = event.clientY - pointerState.startY;

            if (!pointerState.moved && Math.hypot(deltaX, deltaY) < 10) {
                return;
            }

            pointerState.moved = true;
            setIsDragging(true);
            event.preventDefault();

            const nextPosition = clampChatButtonPosition({
                top: `${pointerState.startTop + deltaY}px`,
                right: `${pointerState.startRight - deltaX}px`
            });

            setButtonPosition(nextPosition);
        };

        const handleFloatingPointerUp = (event) => {
            const pointerState = pointerDragRef.current;

            if (!pointerState || pointerState.pointerId !== event.pointerId) {
                return;
            }

            event.currentTarget.releasePointerCapture?.(event.pointerId);

            if (pointerState.moved) {
                suppressChatOpenRef.current = true;

                if (isChatPointOverTrash(event.clientX, event.clientY)) {
                    setIsButtonVisible(false);
                    showToast('Chat button removed. Refresh to restore.');
                }
            }

            pointerDragRef.current = null;
            setIsDragging(false);
        };

        const handleFloatingPointerCancel = (event) => {
            const pointerState = pointerDragRef.current;

            if (!pointerState || pointerState.pointerId !== event.pointerId) {
                return;
            }

            event.currentTarget.releasePointerCapture?.(event.pointerId);
            pointerDragRef.current = null;
            setIsDragging(false);
        };

        const handleChatButtonClick = () => {
            if (suppressChatOpenRef.current) {
                suppressChatOpenRef.current = false;
                return;
            }

            setChatOpen(true);
        };

        useEffect(() => {
            let unsubscribe = () => {};
            let cancelled = false;

            const finalizeAuthResolution = () => {
                if (cancelled) {
                    return;
                }

                setAuthResolved(true);
                onBootStage?.('auth-resolved');
            };

            const startAuthSync = async () => {
                await new Promise((resolve) => window.requestAnimationFrame(resolve));
                await enableAppCheckIfConfigured();

                if (cancelled) {
                    return;
                }

                unsubscribe = onAuthStateChanged(auth, (user) => {
                    const knownUsers = usersRef.current;

                    if (user) {
                        setIsAuthenticated(true);
                        setCurrentUser(user);

                        if (!knownUsers[user.uid]) {
                            const simUser = withPerformanceProfile({
                                id: user.uid,
                                name: user.displayName || 'New User',
                                avatar: `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(user.displayName || user.uid)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf&mouth=smile01,smile02,smile03`,
                                mmr: 1500,
                                matchesPlayed: 0,
                                availability: 'Evenings & Weekends',
                                friends: [],
                                sports: ['Tennis'],
                                district: 'Causeway Bay',
                                playStyle: 'Balanced',
                                matchmakingTags: ['open-to-all'],
                                joinedClubIds: [],
                                emailVerified: Boolean(user.emailVerified)
                            });

                            dispatch({ type: 'ADD_USER', payload: simUser });
                            dispatch({ type: 'SET_CURRENT_USER', payload: simUser });
                        } else {
                            dispatch({ type: 'SET_CURRENT_USER', payload: withPerformanceProfile({ ...knownUsers[user.uid], emailVerified: Boolean(user.emailVerified) }) });
                        }

                    } else {
                        setIsAuthenticated(false);
                        setCurrentUser(null);
                    }

                    finalizeAuthResolution();
                }, async (error) => {
                    console.warn('[Firebase Auth] Session restore failed. Keeping local auth state and avoiding forced sign-out.', error);

                    try {
                        await enableAppCheckIfConfigured();
                    } catch {
                        // Ignore App Check retries here and preserve current session state.
                    }

                    const cachedUser = auth.currentUser;

                    if (cachedUser) {
                        const knownUsers = usersRef.current;

                        setIsAuthenticated(true);
                        setCurrentUser(cachedUser);

                        if (!knownUsers[cachedUser.uid]) {
                            const simUser = withPerformanceProfile({
                                id: cachedUser.uid,
                                name: cachedUser.displayName || 'New User',
                                avatar: `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(cachedUser.displayName || cachedUser.uid)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf&mouth=smile01,smile02,smile03`,
                                mmr: 1500,
                                matchesPlayed: 0,
                                availability: 'Evenings & Weekends',
                                friends: [],
                                sports: ['Tennis'],
                                district: 'Causeway Bay',
                                playStyle: 'Balanced',
                                matchmakingTags: ['open-to-all'],
                                joinedClubIds: [],
                                emailVerified: Boolean(cachedUser.emailVerified)
                            });

                            dispatch({ type: 'ADD_USER', payload: simUser });
                            dispatch({ type: 'SET_CURRENT_USER', payload: simUser });
                        } else {
                            dispatch({ type: 'SET_CURRENT_USER', payload: withPerformanceProfile({ ...knownUsers[cachedUser.uid], emailVerified: Boolean(cachedUser.emailVerified) }) });
                        }
                    } else {
                        setIsAuthenticated(false);
                        setCurrentUser(null);
                    }

                    finalizeAuthResolution();
                });
            };

            startAuthSync();

            return () => {
                cancelled = true;
                unsubscribe();
            };
        }, [applySystemTheme, dispatch, onBootStage]);

        useEffect(() => {
            if (!isAuthenticated || !currentUser?.uid) {
                setSocialSyncReady(false);
                return undefined;
            }

            let unsubscribe = () => {};
            let cancelled = false;

            const applyCloudState = async (cloudState) => {
                if (!cloudState || cancelled) {
                    return;
                }

                const { state: reconciledState, changed } = reconcileUserCloudState(cloudState);
                const serializedState = serializeUserCloudState(reconciledState);

                if (serializedState !== lastPersistedCloudStateRef.current) {
                    cloudHydratingRef.current = true;
                    dispatch({ type: 'HYDRATE_PERSISTED_STATE', payload: reconciledState });
                    cloudHydratingRef.current = false;
                    lastPersistedCloudStateRef.current = serializedState;
                }

                cloudReadyRef.current = true;

                if (changed) {
                    try {
                        await saveUserCloudState(currentUser.uid, reconciledState);
                    } catch (error) {
                        console.warn('[Firestore Sync] Failed to persist reconciled lifecycle state.', error);
                    }
                }
            };

            const startCloudSync = async () => {
                try {
                    const seedState = await ensureUserCloudDocument({
                        firebaseUser: currentUser,
                        baseState: initialState,
                        knownUser: usersRef.current[currentUser.uid]
                    });

                    if (cancelled) {
                        return;
                    }

                    await applyCloudState(seedState || buildUserCloudState({
                        firebaseUser: currentUser,
                        baseState: initialState,
                        knownUser: usersRef.current[currentUser.uid]
                    }));

                    unsubscribe = subscribeToUserCloudState(currentUser.uid, (nextCloudState) => {
                        if (!nextCloudState || cancelled) {
                            return;
                        }

                        applyCloudState(nextCloudState);
                    });
                } catch (error) {
                    console.warn('[Firestore Sync] Failed to initialize persisted user state.', error);
                    showToast('Cloud sync is unavailable right now. Your current session still works locally.');
                }
            };

            startCloudSync();

            return () => {
                cancelled = true;
                unsubscribe();
            };
        }, [currentUser, dispatch, isAuthenticated, showToast]);

        useEffect(() => {
            if (!isAuthenticated || !currentUser?.uid || !state.currentUser?.id) {
                return;
            }

            if (!cloudReadyRef.current || cloudHydratingRef.current) {
                return;
            }

            const { state: reconciledState, changed } = reconcileUserCloudState({
                currentUserId: state.currentUser.id,
                currentUser: state.currentUser,
                users: state.users,
                matches: state.matches,
                notifications: state.notifications,
                friendRequests: state.friendRequests,
                recurringSquads: state.recurringSquads,
                lastCheckIn: state.lastCheckIn,
                accessibility: state.accessibility
            });
            const serializedState = serializeUserCloudState(reconciledState);

            if (serializedState === lastPersistedCloudStateRef.current) {
                return;
            }

            lastPersistedCloudStateRef.current = serializedState;

            if (changed) {
                cloudHydratingRef.current = true;
                dispatch({ type: 'HYDRATE_PERSISTED_STATE', payload: reconciledState });
                cloudHydratingRef.current = false;
            }

            saveUserCloudState(currentUser.uid, reconciledState).catch((error) => {
                console.warn('[Firestore Sync] Failed to save user state.', error);
                showToast('Cloud save failed. Try again once your connection is stable.');
            });
        }, [currentUser, dispatch, isAuthenticated, showToast, state.accessibility, state.currentUser, state.friendRequests, state.lastCheckIn, state.matches, state.notifications, state.recurringSquads, state.users]);

        useEffect(() => {
            if (!isAuthenticated || !currentUser?.uid) {
                return undefined;
            }

            let unsubscribeProfiles = () => {};
            let unsubscribeFriendships = () => {};
            let unsubscribeRequests = () => {};
            let unsubscribePresence = () => {};
            let unsubscribeOwnPresence = () => {};
            let cancelled = false;

            setSocialSyncReady(false);

            const startSocialSync = async () => {
                try {
                    const nextProfile = await ensurePublicProfile({
                        firebaseUser: currentUser,
                        profile: pendingProfileRef.current || state.currentUser || {},
                        requestedHandle: pendingProfileRef.current?.handle
                    });

                    if (cancelled) {
                        return;
                    }

                    setSocialProfiles((existingProfiles) => ({
                        ...existingProfiles,
                        [currentUser.uid]: {
                            id: currentUser.uid,
                            ...nextProfile
                        }
                    }));

                    unsubscribeProfiles = subscribeToPublicProfiles(setSocialProfiles);
                    unsubscribeFriendships = subscribeToFriendships(currentUser.uid, setSocialFriendIds);
                    unsubscribeRequests = subscribeToFriendRequests(currentUser.uid, setSocialFriendRequests);
                    unsubscribePresence = subscribeToPresence(setSocialPresence);
                    unsubscribeOwnPresence = publishPresence(currentUser.uid, nextProfile, () => view.page || 'home');
                    setSocialSyncReady(true);
                } catch (error) {
                    setSocialSyncReady(false);
                    console.warn('[Social Sync] Failed to initialize public multiplayer state.', error);
                    showToast(error?.message || 'Live multiplayer sync could not be initialized right now.');
                }
            };

            startSocialSync();

            return () => {
                cancelled = true;
                setSocialSyncReady(false);
                unsubscribeProfiles();
                unsubscribeFriendships();
                unsubscribeRequests();
                unsubscribePresence();
                unsubscribeOwnPresence();
            };
        }, [currentUser, isAuthenticated, showToast]);

        useEffect(() => {
            if (!currentUser?.uid || !socialCurrentUser) {
                return;
            }

            updatePresencePage(currentUser.uid, socialCurrentUser, view.page || 'home').catch(() => {});
        }, [currentUser, socialCurrentUser, view.page]);

        useEffect(() => {
            if (!state.currentUser?.id) {
                return;
            }

            const existingFriends = state.currentUser.friends || [];
            const normalizedExisting = [...existingFriends].sort().join('|');
            const normalizedLive = [...socialFriendIds].sort().join('|');

            if (normalizedExisting === normalizedLive) {
                return;
            }

            dispatch({
                type: 'UPDATE_USER',
                payload: {
                    id: state.currentUser.id,
                    updates: { friends: socialFriendIds }
                }
            });
        }, [dispatch, socialFriendIds, state.currentUser]);

        const mapProfileToUser = (profile, authUser = null) => ({
            ...withPerformanceProfile({
                id: profile.uid || profile.id,
                name: profile.displayName || profile.name,
                displayName: profile.displayName || profile.name,
                handle: profile.handle,
                avatar: profile.avatar,
                mmr: profile.mmr || 1500,
                matchesPlayed: profile.matchesPlayed || 0,
                availability: profile.availability || 'Evenings & Weekends',
                friends: socialFriendIds,
                sports: profile.sports || (profile.favoriteSport ? [profile.favoriteSport] : ['Tennis']),
                district: profile.district || profile.homeDistrict || 'Causeway Bay',
                playStyle: profile.playStyle || 'Balanced',
                matchmakingTags: profile.matchmakingTags || ['open-to-all'],
                rewardPoints: profile.rewardPoints || 0,
                joinedClubIds: profile.joinedClubIds || [],
                emailVerified: Boolean(authUser?.emailVerified),
                activityMetrics: profile.activityMetrics,
                watchSync: profile.watchSync
            })
        });

        const handleLogin = async (user, profile = {}) => {
            pendingProfileRef.current = profile;
            const publicProfile = await ensurePublicProfile({
                firebaseUser: user,
                profile,
                requestedHandle: profile.handle
            });
            const knownUser = usersRef.current[user.uid] || {};
            const nextUser = mapProfileToUser({ ...knownUser, ...publicProfile, ...profile }, user);

            setIsAuthenticated(true);
            setCurrentUser(user);
            clearGoogleRedirectState();
            setPendingVerification({
                email: user?.email || '',
                displayName: publicProfile.displayName || publicProfile.name || user?.displayName || ''
            });
            dispatch({ type: 'ADD_USER', payload: nextUser });
            dispatch({ type: 'SET_CURRENT_USER', payload: nextUser });
        };

        const handleRegister = async (user, profile) => {
            pendingProfileRef.current = profile;

            try {
                const publicProfile = await ensurePublicProfile({
                    firebaseUser: user,
                    profile,
                    requestedHandle: profile.handle
                });
                const knownUser = usersRef.current[user.uid] || {};
                const newUser = mapProfileToUser({ ...knownUser, ...publicProfile, ...profile }, user);

                if (!user?.emailVerified) {
                    try {
                        await sendEmailVerification(user);
                    } catch {
                        // Keep registration non-blocking when verification email delivery fails.
                    }
                }

                dispatch({ type: 'ADD_USER', payload: newUser });
                setIsAuthenticated(true);
                setCurrentUser(user);
                clearGoogleRedirectState();
                setPendingVerification({
                    email: user?.email || '',
                    displayName: profile?.displayName || profile?.name || user?.displayName || ''
                });
                dispatch({ type: 'SET_CURRENT_USER', payload: newUser });
            } catch (error) {
                try {
                    await user.delete();
                } catch {
                    // Ignore cleanup failure if the auth account cannot be rolled back.
                }

                throw error;
            }
        };

        useEffect(() => {
            if (!currentUser?.uid || googleRedirectHydratingRef.current || typeof window === 'undefined') {
                return;
            }

            const { intent, profile } = readGoogleRedirectState();
            if (intent !== 'login' && intent !== 'register') {
                return;
            }

            const handledKey = `${currentUser.uid}:${intent}`;
            if (googleRedirectHandledRef.current === handledKey) {
                return;
            }

            googleRedirectHydratingRef.current = true;

            const finalizeRedirectAuth = async () => {
                try {
                    if (intent === 'register') {
                        await handleRegister(currentUser, profile);
                        clearGoogleRedirectState();
                        googleRedirectHandledRef.current = handledKey;
                        showToast('Google account connected.');
                    } else {
                        await handleLogin(currentUser, profile);
                        clearGoogleRedirectState();
                        googleRedirectHandledRef.current = handledKey;
                        showToast('Signed in with Google.');
                    }
                } catch (error) {
                    clearGoogleRedirectState();
                    console.warn('[Google Auth Redirect] Failed to finalize redirected auth.', error);
                    showToast(error?.message || 'Google sign-in could not be completed.');
                } finally {
                    googleRedirectHydratingRef.current = false;
                }
            };

            finalizeRedirectAuth();
        }, [currentUser, handleLogin, handleRegister, showToast]);

        const handleSignOut = () => {
            auth.signOut();
            clearGoogleRedirectState();
            googleRedirectHandledRef.current = '';
            googleRedirectHydratingRef.current = false;
            setIsAuthenticated(false);
            setAuthView('intro');
            setPendingVerification({ email: '', displayName: '' });
            setView({ page: 'home', params: {} });
            setViewHistory([{ page: 'home', params: {} }]);
            showToast("You've been signed out.");
        };

        const openVerificationGate = (blockedPage = 'booking') => {
            const verificationView = {
                page: 'verificationPending',
                params: { blockedPage }
            };

            setPendingVerification({
                email: currentUser?.email || pendingVerification.email || '',
                displayName: state.currentUser?.name || currentUser?.displayName || pendingVerification.displayName || ''
            });
            setView(verificationView);
            setViewHistory((previousHistory) => [...previousHistory, verificationView]);
            showToast('Verify your email before using booking features.');
        };

        const handleSendLiveFriendRequest = async (targetUserId) => {
            const senderProfile = socialCurrentUser || state.currentUser;
            const targetProfile = socialUsers[targetUserId];

            if (!isAuthenticated || !currentUser?.uid) {
                showToast('Sign in to send live invites.');
                return;
            }

            if (!socialSyncReady || !senderProfile?.id) {
                showToast('Your live player profile is still syncing. Please wait a moment and try again.');
                return;
            }

            if (!targetProfile?.id) {
                showToast('That player is not available for live invites right now.');
                return;
            }

            if (targetUserId === senderProfile.id) {
                showToast('You cannot send a live invite to yourself.');
                return;
            }

            if (socialFriendIds.includes(targetUserId)) {
                showToast('You are already connected to this player.');
                return;
            }

            if (senderProfile.id !== currentUser.uid) {
                showToast('Your account is still linking to the live network. Please try again in a moment.');
                return;
            }

            if (!senderProfile.displayName && !senderProfile.name) {
                showToast('Finish syncing your profile before sending live invites.');
                return;
            }

            try {
                await sendFriendRequest({
                    fromProfile: senderProfile,
                    toUserId: targetUserId,
                    message: 'Want to connect and play sometime?'
                });
                showToast('Friend invite sent.');
            } catch (error) {
                const message = String(error?.message || '').toLowerCase();

                if (error?.code === 'permission-denied' || message.includes('syncing with your player profile')) {
                    showToast('Your live profile is still syncing. Please wait a moment and send the invite again.');
                    return;
                }

                if (message.includes('already pending')) {
                    showToast('A live invite is already pending for this player.');
                    return;
                }

                showToast(error?.message || 'Could not send the live invite right now.');
            }
        };

        const handleAcceptLiveFriendRequest = async (requestId) => {
            const request = socialFriendRequests.find((entry) => entry.id === requestId);
            if (!request) {
                showToast('That request could not be found anymore.');
                return;
            }

            try {
                await acceptFriendRequest({ request });
                showToast('Friend request accepted.');
            } catch (error) {
                showToast(error?.message || 'Could not accept the live request right now.');
            }
        };

        const handleDeclineLiveFriendRequest = async (requestId) => {
            const request = socialFriendRequests.find((entry) => entry.id === requestId);
            if (!request) {
                showToast('That request could not be found anymore.');
                return;
            }

            try {
                await declineFriendRequest({ request });
                showToast('Friend request declined.');
            } catch (error) {
                showToast(error?.message || 'Could not decline the live request right now.');
            }
        };

        const handleSaveLiveProfile = async (playerId, updates) => {
            try {
                await updatePublicProfile(playerId, {
                    name: updates.name,
                    displayName: updates.name,
                    availability: updates.availability,
                    avatar: updates.avatar
                });
                showToast('Profile updated!');
            } catch (error) {
                showToast(error?.message || 'Could not update the public profile right now.');
            }
        };

        const navigate = (newView) => {
            const gatedPages = new Set(['booking', 'bookingLobbies', 'createMatch']);

            if (isAuthenticated && currentUser && !currentUser.emailVerified && gatedPages.has(newView?.page)) {
                openVerificationGate(newView.page);
                return;
            }

            if (newView?.params?.venueId) {
                revealVenueImage(newView.params.venueId);
            }

            setView(newView);
            setViewHistory(prev => [...prev, newView]);
        };

        const goBack = () => {
            if (viewHistory.length > 1) {
            const newHistory = viewHistory.slice(0, -1);
            setViewHistory(newHistory);
            setView(newHistory[newHistory.length - 1]);
            }
        };

        const renderPrimaryPage = () => {
            if (view.page === 'home') return <HomePageView state={state} onNavigate={navigate} Header={Header} />;
            if (view.page === 'explore') {
                return renderDeferredPage(
                    <LazyExplorePageView
                        {...view.params}
                        onNavigate={navigate}
                        state={state}
                        dispatch={dispatch}
                        revealedVenueImageIds={revealedVenueImageIds}
                        revealVenueImage={revealVenueImage}
                        theme={theme}
                        showToast={showToast}
                        Header={Header}
                        getLeafletTileLayerConfig={getLeafletTileLayerConfig}
                    />,
                    'Loading venue explorer',
                    'Preparing live maps, venue filters, and routing tools.'
                );
            }
            if (view.page === 'booking') {
                return renderDeferredPage(
                    <LazyBookingPageView
                        onNavigate={navigate}
                        state={state}
                        dispatch={dispatch}
                        socialState={socialState}
                        theme={theme}
                        Header={Header}
                        formatHourLabel={formatHourLabel}
                        getNextSevenDayOptions={getNextSevenDayOptions}
                        getLeafletTileLayerConfig={getLeafletTileLayerConfig}
                        showToast={showToast}
                    />,
                    'Loading booking studio',
                    'Bringing in venue maps, time selection, and booking comparison tools.'
                );
            }
            if (view.page === 'bookingLobbies') {
                return renderDeferredPage(
                    <LazyBookingLobbiesPage {...view.params} state={state} onBack={goBack} onNavigate={navigate} Header={Header} formatHourLabel={formatHourLabel} />,
                    'Loading session lobbies',
                    'Bringing in post-booking tools and AI lobby details.'
                );
            }
            if (view.page === 'notifications') {
                return renderDeferredPage(
                    <LazyNotificationsPage state={state} dispatch={dispatch} onBack={goBack} onNavigate={navigate} Header={Header} />,
                    'Loading notifications',
                    'Gathering recent activity without blocking the rest of the shell.'
                );
            }
            if (view.page === 'friendsHub') {
                return renderDeferredPage(
                    <LazyFriendsHubPage state={state} socialState={socialState} onBack={goBack} onNavigate={navigate} Header={Header} />,
                    'Loading friends network',
                    'Preparing your squad, invites, and recurring groups.'
                );
            }
            if (view.page === 'friendsSquad') {
                return renderDeferredPage(
                    <LazyFriendsSquadPage state={state} socialState={socialState} onBack={goBack} onNavigate={navigate} Header={Header} />,
                    'Loading your squad'
                );
            }
            if (view.page === 'friendsDiscover') {
                return renderDeferredPage(
                    <LazyFriendsDiscoverPage state={state} socialState={socialState} onSendFriendRequest={handleSendLiveFriendRequest} dispatch={dispatch} onBack={goBack} onNavigate={navigate} showToast={showToast} Header={Header} />,
                    'Loading player discovery'
                );
            }
            if (view.page === 'friendsInvites') {
                return renderDeferredPage(
                    <LazyFriendsInvitesPage state={state} socialState={socialState} onAcceptRequest={handleAcceptLiveFriendRequest} onDeclineRequest={handleDeclineLiveFriendRequest} dispatch={dispatch} onBack={goBack} onNavigate={navigate} showToast={showToast} Header={Header} />,
                    'Loading invite queue'
                );
            }
            if (view.page === 'friendsRecurring') {
                return renderDeferredPage(
                    <LazyFriendsRecurringPage state={state} dispatch={dispatch} onBack={goBack} onNavigate={navigate} showToast={showToast} Header={Header} />,
                    'Loading recurring squads'
                );
            }
            if (view.page === 'clubs') {
                return renderDeferredPage(
                    <LazyClubsPage state={state} dispatch={dispatch} initialTab={view.params?.tab || 'clubs'} onBack={goBack} onNavigate={navigate} showToast={showToast} Header={Header} />,
                    'Loading clubs hub'
                );
            }
            if (view.page === 'clubDetail') {
                return renderDeferredPage(
                    <LazyClubDetailPage state={state} dispatch={dispatch} clubId={view.params?.clubId} onBack={goBack} onNavigate={navigate} showToast={showToast} Header={Header} />,
                    'Loading club detail'
                );
            }
            if (view.page === 'rewards') {
                return renderDeferredPage(
                    <LazyRewardsPage state={state} dispatch={dispatch} initialTab="rewards" onBack={goBack} onNavigate={navigate} Header={Header} />,
                    'Loading rewards dashboard'
                );
            }
            if (view.page === 'verificationPending') {
                return (
                    <ExtractedVerificationPendingPage
                        auth={auth}
                        showToast={showToast}
                        setView={setAuthView}
                        pendingEmail={pendingVerification.email}
                        pendingDisplayName={pendingVerification.displayName}
                        onVerified={(user) => handleLogin(user, pendingProfileRef.current || {})}
                        inApp
                        onReturnToApp={() => navigate({ page: 'home', params: {} })}
                    />
                );
            }
            if (view.page === 'playerProfile') {
                return renderDeferredPage(
                    <LazyPlayerProfilePage
                        {...view.params}
                        state={state}
                        socialState={socialState}
                        onSaveProfile={handleSaveLiveProfile}
                        onSendFriendRequest={handleSendLiveFriendRequest}
                        dispatch={dispatch}
                        showToast={showToast}
                        theme={theme}
                        themePreference={themePreference}
                        toggleTheme={toggleTheme}
                        applySystemTheme={applySystemTheme}
                        auth={auth}
                        onBack={goBack}
                        onNavigate={navigate}
                        Header={Header}
                    />,
                    'Loading player profile'
                );
            }
            if (view.page === 'matchDetail') return <MatchDetailPage {...view.params} onBack={goBack} onNavigate={navigate} />;
            if (view.page === 'createMatch') return <CreateMatchProcess {...view.params} onBack={goBack} onNavigate={navigate} />;
            if (view.page === 'pickupGames') return <PickupGamesPage {...view.params} initialTab={view.params?.tab} state={state} onNavigate={navigate} onBack={goBack} showToast={showToast} Header={Header} />;
            if (view.page === 'pickupGameDetail') return <PickupGameDetailPage {...view.params} state={state} onNavigate={navigate} onBack={goBack} showToast={showToast} Header={Header} />;
            if (view.page === 'hostGame') return <HostGamePage {...view.params} state={state} onNavigate={navigate} onBack={goBack} showToast={showToast} Header={Header} />;
            if (view.page === 'venueDetail') {
                return renderDeferredPage(
                    <LazyVenueDetailPage
                        {...view.params}
                        state={state}
                        dispatch={dispatch}
                        showToast={showToast}
                        onBack={goBack}
                        onNavigate={navigate}
                        Header={Header}
                        Modal={Modal}
                        FeedbackModal={FeedbackModal}
                        speak={speak}
                    />,
                    'Loading venue dossier',
                    'Preparing weather, reviews, and safety tools for this venue.'
                );
            }
            if (view.page === 'map') {
                return renderDeferredPage(
                    <LazyExplorePageView
                        {...view.params}
                        onNavigate={navigate}
                        state={state}
                        dispatch={dispatch}
                        revealedVenueImageIds={revealedVenueImageIds}
                        revealVenueImage={revealVenueImage}
                        theme={theme}
                        showToast={showToast}
                        Header={Header}
                        getLeafletTileLayerConfig={getLeafletTileLayerConfig}
                    />,
                    'Loading live map',
                    'Preparing navigation, venue markers, and route guidance.'
                );
            }

            return <HomePageView state={state} onNavigate={navigate} Header={Header} />;
        };

        return (
            <div id="app-shell" ref={appShellRef} className={`app-shell${state.accessibility.colorblind && isAuthenticated ? ' colorblind-ui' : ''}`} onDragOver={handleDragOver} onDrop={handleDrop} aria-busy={!authResolved}>
            {!isAuthenticated ? (
                authView === 'intro' ? (
                <IntroPage setView={setAuthView} />
                ) : authView === 'login' ? (
                <ExtractedAuthPage auth={auth} showToast={showToast} onLogin={handleLogin} onVerificationPending={setPendingVerification} setView={setAuthView} Modal={Modal} />
                ) : authView === 'register' ? (
                <ExtractedRegisterPage auth={auth} showToast={showToast} onRegister={handleRegister} onLogin={handleLogin} onVerificationPending={setPendingVerification} setView={setAuthView} Modal={Modal} />
                ) : authView === 'verifyPending' ? (
                <ExtractedVerificationPendingPage auth={auth} showToast={showToast} setView={setAuthView} pendingEmail={pendingVerification.email} pendingDisplayName={pendingVerification.displayName} onVerified={(user) => handleLogin(user, pendingProfileRef.current || {})} />
                ) : (
                <ExtractedForgotPasswordPage auth={auth} showToast={showToast} setView={setAuthView} />
                )
            ) : (
                <>
                {renderPrimaryPage()}
                <BottomNavigation activePage={view.page} currentUserId={state.currentUser.id} onNavigate={navigate} />
                {isButtonVisible && (
                    <button
                    type="button"
                    className="floating-button"
                    aria-label="Open GoPlayHK assistant"
                    style={{
                        position: 'fixed',
                        top: buttonPosition.top,
                        right: buttonPosition.right,
                        backgroundColor: '#FC9905',
                        zIndex: 1001
                    }}
                    draggable={true}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onPointerDown={handleFloatingPointerDown}
                    onPointerMove={handleFloatingPointerMove}
                    onPointerUp={handleFloatingPointerUp}
                    onPointerCancel={handleFloatingPointerCancel}
                    onDoubleClick={handleDoubleClick}
                    onClick={handleChatButtonClick}
                    >
                    <i className="fas fa-comments" aria-hidden="true"></i>
                    </button>
                )}
                {isDragging && (
                    <div
                    className="trash-can"
                    style={{
                        position: 'fixed',
                        bottom: '16px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '64px',
                        height: '64px',
                        backgroundColor: '#EF4444',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                        zIndex: 1002
                    }}
                    >
                    <i className="fas fa-trash-alt" style={{ color: 'white', fontSize: '1.5rem' }}></i>
                    </div>
                )}
                <Suspense
                    fallback={chatOpen ? (
                        <div className="modal-overlay open" style={{ zIndex: 1000 }}>
                            <div className="modal-content chatbot-modal">
                                <div className="chatbot-shell-header">
                                    <div>
                                        <span className="section-kicker">Assistant layer</span>
                                        <h3 className="text-lg font-semibold chatbot-title">Loading Concierge</h3>
                                        <p className="chatbot-subtitle">Preparing fast actions for booking, routing, and squads.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : null}
                >
                    <LazyChatbot isOpen={chatOpen} onClose={() => setChatOpen(false)} onNavigate={navigate} currentView={view} state={state} socialState={socialState} dispatch={dispatch} showToast={showToast} isBookingUnlocked={isBookingUnlocked} />
                </Suspense>
                </>
            )}
            <Modal
                isOpen={showQuickGuide}
                close={() => {
                    document.querySelector('.modal-overlay')?.classList.add('closing');
                    document.querySelector('.modal-content')?.classList.add('closing');
                    setTimeout(() => {
                        setShowQuickGuide(false);
                        localStorage.setItem('hasSeenQuickGuide', 'true');
                    }, 350);
                }}
                title="Welcome to GoPlayHK!"
            >
                <div className="quick-guide-shell">
                    <p className="modal-text-line quick-guide-intro">
                        Your fastest path is now map-first: choose a venue pin, confirm the session, and manage the lobby after booking.
                    </p>

                    <div className="quick-guide-grid">
                        {[
                            { icon: 'fa-house', title: 'Home', description: 'Track your stats, next matches, and quick actions.' },
                            { icon: 'fa-compass', title: 'Explore', description: 'Browse venues, discover games, and join live sessions.' },
                            { icon: 'fa-calendar-check', title: 'Bookings', description: 'Tap map pins to select a venue, then lock in date and time.' },
                            { icon: 'fa-map-location-dot', title: 'Map', description: 'Open full routing when you need walking, driving, or transit help.' },
                            { icon: 'fa-user-gear', title: 'Profile', description: 'Adjust preferences, accessibility, and appearance settings.' },
                            { icon: 'fa-comments', title: 'Assistant', description: 'Drag the chat button and tap for booking help anywhere.' }
                        ].map((item) => (
                            <div key={item.title} className="modal-text-line quick-guide-card">
                                <span className="quick-guide-icon"><i className={`fas ${item.icon}`}></i></span>
                                <div>
                                    <strong>{item.title}</strong>
                                    <p>{item.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <p className="modal-text-line quick-guide-note">
                        Tip: Bookings now selects venues directly from the map, so you do not need to hunt through text lists first.
                    </p>
                </div>

                <div className="flex gap-3 mt-5">
                    <button
                        className="btn-primary flex-1"
                        onClick={() => {
                            document.querySelector('.modal-overlay')?.classList.add('closing');
                            document.querySelector('.modal-content')?.classList.add('closing');
                            setTimeout(() => {
                                setShowQuickGuide(false);
                                localStorage.setItem('hasSeenQuickGuide', 'true');
                            }, 350);
                        }}
                    >
                        Let's Go!
                    </button>
                    <button
                        className="btn-secondary flex-1"
                        onClick={() => {
                            document.querySelector('.modal-overlay')?.classList.add('closing');
                            document.querySelector('.modal-content')?.classList.add('closing');
                            setTimeout(() => setShowQuickGuide(false), 350);
                        }}
                    >
                        Maybe Later
                    </button>
                </div>
            </Modal>
            </div>
        );
        };

        const Root = (bootCallbacks) => (
            <ThemeProvider>
                <ToastProvider>
                    <AppStateProvider>
                        <App {...bootCallbacks} />
                    </AppStateProvider>
                </ToastProvider>
            </ThemeProvider>
        );
export default Root; // Or export default App; if you don't need Root