const LANGUAGE_STORAGE_KEY = 'goplayhk_language_preference';
const GOOGLE_TRANSLATE_SCRIPT_ID = 'goplayhk-google-translate-script';
const GOOGLE_TRANSLATE_CONTAINER_ID = 'google_translate_element';
const GOOGLE_TRANSLATE_CALLBACK = '__goplayhkInitGoogleTranslate';

export const LANGUAGE_OPTIONS = [
    { code: 'en', label: 'English' },
    { code: 'zh-TW', label: 'Chinese Traditional (繁體中文)' },
    { code: 'zh-CN', label: 'Chinese Simplified (简体中文)' },
    { code: 'hi', label: 'Hindi (हिन्दी)' },
    { code: 'ur', label: 'Urdu (اردو)' },
    { code: 'fr', label: 'French (Français)' },
    { code: 'es', label: 'Spanish (Español)' },
    { code: 'ar', label: 'Arabic (العربية)' },
    { code: 'bn', label: 'Bengali (বাংলা)' },
    { code: 'de', label: 'German (Deutsch)' },
    { code: 'el', label: 'Greek (Ελληνικά)' },
    { code: 'id', label: 'Indonesian (Bahasa Indonesia)' },
    { code: 'it', label: 'Italian (Italiano)' },
    { code: 'ja', label: 'Japanese (日本語)' },
    { code: 'ko', label: 'Korean (한국어)' },
    { code: 'ms', label: 'Malay (Bahasa Melayu)' },
    { code: 'nl', label: 'Dutch (Nederlands)' },
    { code: 'pl', label: 'Polish (Polski)' },
    { code: 'pt', label: 'Portuguese (Português)' },
    { code: 'ru', label: 'Russian (Русский)' },
    { code: 'ta', label: 'Tamil (தமிழ்)' },
    { code: 'te', label: 'Telugu (తెలుగు)' },
    { code: 'th', label: 'Thai (ไทย)' },
    { code: 'tr', label: 'Turkish (Türkçe)' },
    { code: 'uk', label: 'Ukrainian (Українська)' },
    { code: 'vi', label: 'Vietnamese (Tiếng Việt)' }
];

const DEFAULT_LANGUAGE = 'en';
const LANGUAGE_LABELS = LANGUAGE_OPTIONS.reduce((labels, option) => ({
    ...labels,
    [option.code]: option.label
}), {});
const LANGUAGE_ALIASES = {
    en: 'en',
    english: 'en',
    'zh-hk': 'zh-TW',
    'zh-mo': 'zh-TW',
    'zh-tw': 'zh-TW',
    traditional: 'zh-TW',
    'traditional chinese': 'zh-TW',
    'zh-cn': 'zh-CN',
    'zh-sg': 'zh-CN',
    simplified: 'zh-CN',
    'simplified chinese': 'zh-CN',
    hindi: 'hi',
    indian: 'hi',
    urdu: 'ur',
    pakistani: 'ur',
    french: 'fr',
    spanish: 'es'
};

let googleTranslatePromise = null;

export const normalizeLanguagePreference = (value = DEFAULT_LANGUAGE) => {
    const normalizedValue = String(value || '').trim();

    if (!normalizedValue) {
        return DEFAULT_LANGUAGE;
    }

    if (LANGUAGE_LABELS[normalizedValue]) {
        return normalizedValue;
    }

    const lowerCasedValue = normalizedValue.toLowerCase();

    return LANGUAGE_ALIASES[lowerCasedValue] || DEFAULT_LANGUAGE;
};

export const getLanguageLabel = (languageCode = DEFAULT_LANGUAGE) => {
    const normalizedLanguageCode = normalizeLanguagePreference(languageCode);
    return LANGUAGE_LABELS[normalizedLanguageCode] || LANGUAGE_LABELS[DEFAULT_LANGUAGE];
};

export const getStoredLanguagePreference = () => {
    if (typeof window === 'undefined') {
        return DEFAULT_LANGUAGE;
    }

    return normalizeLanguagePreference(window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || DEFAULT_LANGUAGE);
};

const persistLanguagePreference = (languageCode) => {
    if (typeof window === 'undefined') {
        return;
    }

    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguagePreference(languageCode));
};

const setHtmlLanguage = (languageCode) => {
    if (typeof document === 'undefined') {
        return;
    }

    document.documentElement.lang = normalizeLanguagePreference(languageCode);
};

const setGoogleTranslateCookie = (languageCode) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return;
    }

    const cookieValue = `/auto/${languageCode}`;
    const encodedCookie = `googtrans=${cookieValue};path=/;max-age=31536000;SameSite=Lax`;
    document.cookie = encodedCookie;

    if (window.location.hostname) {
        document.cookie = `googtrans=${cookieValue};domain=${window.location.hostname};path=/;max-age=31536000;SameSite=Lax`;
    }
};

const clearGoogleTranslateCookie = () => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
        return;
    }

    const expiredCookie = 'googtrans=;path=/;expires=Thu, 01 Jan 1970 00:00:01 GMT;SameSite=Lax';
    document.cookie = expiredCookie;

    if (window.location.hostname) {
        document.cookie = `googtrans=;domain=${window.location.hostname};path=/;expires=Thu, 01 Jan 1970 00:00:01 GMT;SameSite=Lax`;
    }
};

const waitForTranslateCombo = () => new Promise((resolve, reject) => {
    let attempts = 0;

    const tryResolve = () => {
        const combo = document.querySelector('.goog-te-combo');

        if (combo) {
            resolve(combo);
            return;
        }

        attempts += 1;

        if (attempts >= 60) {
            reject(new Error('Google Translate selector did not become available.'));
            return;
        }

        window.setTimeout(tryResolve, 100);
    };

    tryResolve();
});

const dispatchSelectChange = (selectElement) => {
    selectElement.dispatchEvent(new Event('change', { bubbles: true }));
};

const ensureGoogleTranslate = async () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return;
    }

    if (!document.getElementById(GOOGLE_TRANSLATE_CONTAINER_ID)) {
        const container = document.createElement('div');
        container.id = GOOGLE_TRANSLATE_CONTAINER_ID;
        container.setAttribute('aria-hidden', 'true');
        container.style.position = 'fixed';
        container.style.left = '-9999px';
        container.style.top = '0';
        container.style.width = '1px';
        container.style.height = '1px';
        container.style.overflow = 'hidden';
        document.body.appendChild(container);
    }

    if (window.google?.translate?.TranslateElement) {
        if (!document.querySelector('.goog-te-combo')) {
            new window.google.translate.TranslateElement(
                {
                    pageLanguage: 'en',
                    autoDisplay: false,
                    multilanguagePage: true
                },
                GOOGLE_TRANSLATE_CONTAINER_ID
            );
        }

        return;
    }

    if (googleTranslatePromise) {
        return googleTranslatePromise;
    }

    googleTranslatePromise = new Promise((resolve, reject) => {
        const container = document.getElementById(GOOGLE_TRANSLATE_CONTAINER_ID);

        if (!container) {
            reject(new Error('Google Translate container is missing from the document.'));
            return;
        }

        window[GOOGLE_TRANSLATE_CALLBACK] = () => {
            try {
                new window.google.translate.TranslateElement(
                    {
                        pageLanguage: 'en',
                        autoDisplay: false,
                        multilanguagePage: true
                    },
                    GOOGLE_TRANSLATE_CONTAINER_ID
                );
                resolve();
            } catch (error) {
                reject(error);
            }
        };

        const existingScript = document.getElementById(GOOGLE_TRANSLATE_SCRIPT_ID);

        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(), { once: true });
            existingScript.addEventListener('error', () => reject(new Error('Google Translate failed to load.')), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.id = GOOGLE_TRANSLATE_SCRIPT_ID;
        script.src = `https://translate.google.com/translate_a/element.js?cb=${GOOGLE_TRANSLATE_CALLBACK}`;
        script.async = true;
        script.onerror = () => reject(new Error('Google Translate failed to load.'));
        document.body.appendChild(script);
    }).catch((error) => {
        googleTranslatePromise = null;
        throw error;
    });

    return googleTranslatePromise;
};

export const applyLanguagePreference = async (languageCode = DEFAULT_LANGUAGE, { persist = true } = {}) => {
    const normalizedLanguageCode = normalizeLanguagePreference(languageCode);

    if (persist) {
        persistLanguagePreference(normalizedLanguageCode);
    }

    setHtmlLanguage(normalizedLanguageCode);

    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return normalizedLanguageCode;
    }

    if (normalizedLanguageCode === DEFAULT_LANGUAGE) {
        clearGoogleTranslateCookie();

        const combo = document.querySelector('.goog-te-combo');

        if (combo) {
            combo.value = 'en';
            dispatchSelectChange(combo);
        }

        return normalizedLanguageCode;
    }

    setGoogleTranslateCookie(normalizedLanguageCode);
    await ensureGoogleTranslate();
    const combo = await waitForTranslateCombo();

    if (combo.value !== normalizedLanguageCode) {
        combo.value = normalizedLanguageCode;
        dispatchSelectChange(combo);
    }

    return normalizedLanguageCode;
};