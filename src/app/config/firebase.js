import { initializeApp } from 'firebase/app';
import { ReCaptchaV3Provider, initializeAppCheck } from 'firebase/app-check';
import { browserLocalPersistence, browserPopupRedirectResolver, browserSessionPersistence, indexedDBLocalPersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { getFunctions } from 'firebase/functions';

const requiredEnvKeys = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID'
];

const missingEnvKeys = requiredEnvKeys.filter((key) => !import.meta.env[key]);

if (missingEnvKeys.length > 0) {
    throw new Error(`Missing Firebase environment variables: ${missingEnvKeys.join(', ')}`);
}

const DEFAULT_DATABASE_URL = 'https://goplay-hk-1723d-default-rtdb.asia-southeast1.firebasedatabase.app';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL?.trim() || DEFAULT_DATABASE_URL,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

export const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
    popupRedirectResolver: browserPopupRedirectResolver
});
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const functions = getFunctions(app, 'asia-southeast1');
export const analytics = Promise.resolve(null);

let appCheckInstance;
let appCheckInitPromise;
let analyticsInstance;
let analyticsInitPromise;

const APP_CHECK_WARN_PREFIX = '[Firebase App Check]';
const ANALYTICS_WARN_PREFIX = '[Firebase Analytics]';

const localhostHosts = new Set(['localhost', '127.0.0.1', '::1']);

const isLocalhost = (hostname) => localhostHosts.has(hostname);

const parseCsvEnv = (value) => (value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

const hostMatchesPattern = (hostname, pattern) => {
    if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(2);
        return hostname === suffix || hostname.endsWith(`.${suffix}`);
    }

    return hostname === pattern;
};

const hasRequiredAppCheckApis = () => Boolean(
    window.fetch
    && window.indexedDB
    && window.localStorage
    && window.crypto?.subtle
    && window.MessageChannel
);

const getAppCheckDebugToken = () => {
    const rawValue = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN;

    if (!rawValue) {
        return null;
    }

    if (rawValue === 'true') {
        return true;
    }

    return rawValue;
};

const warnAppCheck = (message, error) => {
    if (error) {
        console.warn(`${APP_CHECK_WARN_PREFIX} ${message}`, error);
        return;
    }

    console.warn(`${APP_CHECK_WARN_PREFIX} ${message}`);
};

const warnAnalytics = (message, error) => {
    if (error) {
        console.warn(`${ANALYTICS_WARN_PREFIX} ${message}`, error);
        return;
    }

    console.warn(`${ANALYTICS_WARN_PREFIX} ${message}`);
};

const shouldEnableForCurrentHost = (hostname) => {
    const allowedHosts = parseCsvEnv(import.meta.env.VITE_FIREBASE_APPCHECK_ALLOWED_HOSTS);

    if (allowedHosts.length === 0) {
        return true;
    }

    return allowedHosts.some((pattern) => hostMatchesPattern(hostname, pattern));
};

const initializeAnalyticsSafely = async () => {
    if (typeof window === 'undefined') {
        return null;
    }

    const hostname = window.location.hostname.toLowerCase();
    const runningLocally = import.meta.env.DEV || isLocalhost(hostname);
    const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim();

    if (!measurementId) {
        return null;
    }

    if (runningLocally) {
        return null;
    }

    if (!shouldEnableForCurrentHost(hostname)) {
        return null;
    }

    try {
        const analyticsModule = await import('firebase/analytics');
        const supported = await analyticsModule.isSupported();

        if (!supported) {
            return null;
        }

        analyticsInstance = analyticsModule.getAnalytics(app);
        return analyticsInstance;
    } catch (error) {
        warnAnalytics('Initialization skipped because the browser or host does not support Analytics.', error);
        return null;
    }
};

const initializeAppCheckSafely = async () => {
    if (typeof window === 'undefined') {
        return null;
    }

    const siteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY?.trim();
    const hostname = window.location.hostname.toLowerCase();
    const runningLocally = import.meta.env.DEV || isLocalhost(hostname);
    const debugToken = getAppCheckDebugToken();

    if (!siteKey) {
        warnAppCheck('Skipped because VITE_FIREBASE_APPCHECK_SITE_KEY is not set.');
        return null;
    }

    if (!shouldEnableForCurrentHost(hostname)) {
        warnAppCheck(`Skipped on host "${hostname}" because it is not listed in VITE_FIREBASE_APPCHECK_ALLOWED_HOSTS.`);
        return null;
    }

    if (!window.isSecureContext && !runningLocally) {
        warnAppCheck(`Skipped on host "${hostname}" because App Check requires HTTPS or localhost.`);
        return null;
    }

    if (runningLocally && !debugToken) {
        return null;
    }

    if (!hasRequiredAppCheckApis()) {
        warnAppCheck('Skipped because this browser does not support the required App Check APIs.');
        return null;
    }

    if (debugToken) {
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    }

    try {
        appCheckInstance = initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(siteKey),
            isTokenAutoRefreshEnabled: true
        });

        return appCheckInstance;
    } catch (error) {
        appCheckInstance = null;
        warnAppCheck('Initialization failed. Verify that the reCAPTCHA site key is valid for this host and that App Check is configured for the deployed domain.', error);
        return null;
    }
};

export const enableAppCheckIfConfigured = () => {
    if (typeof window === 'undefined') {
        return Promise.resolve(null);
    }

    if (appCheckInstance) {
        return Promise.resolve(appCheckInstance);
    }

    if (!appCheckInitPromise) {
        appCheckInitPromise = initializeAppCheckSafely().catch((error) => {
            appCheckInitPromise = null;
            warnAppCheck('Unexpected initialization failure.', error);
            return null;
        });
    }

    return appCheckInitPromise;
};

export const enableAnalyticsIfConfigured = () => {
    if (typeof window === 'undefined') {
        return Promise.resolve(null);
    }

    if (analyticsInstance) {
        return Promise.resolve(analyticsInstance);
    }

    if (!analyticsInitPromise) {
        analyticsInitPromise = initializeAnalyticsSafely().catch((error) => {
            analyticsInitPromise = null;
            warnAnalytics('Unexpected initialization failure.', error);
            return null;
        });
    }

    return analyticsInitPromise;
};
