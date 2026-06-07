import { GoogleAIBackend, getAI, getGenerativeModel } from 'firebase/ai';
import { app, enableAppCheckIfConfigured } from './firebase';

const DEFAULT_MODEL_NAME = 'gemini-2.5-flash';
const ASSISTANT_MODEL_STORAGE_KEY = 'goplayhk_assistant_model';
const DEFAULT_GENERATION_CONFIG = {
    temperature: 0.45,
    maxOutputTokens: 500
};
const ASSISTANT_SYSTEM_INSTRUCTION = 'You are the GoPlayHK Concierge. You assist with matchmaking, player discovery, venue choice, next-step planning, and booking preparation. Stay grounded in provided data, never invent players or venues, and never confirm bookings that have not happened.';

const generativeModelPromises = new Map();

export const ASSISTANT_MODEL_OPTIONS = [
    {
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash-Lite',
        description: 'Low-latency replies for lightweight booking and routing prompts.'
    },
    {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'General-purpose reasoning for booking, matchmaking, and navigation help.'
    },
    {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        description: 'Deepest planning for more complex player, venue, and scheduling decisions.'
    }
];

export const ASSISTANT_DEFAULT_MODEL_NAME = DEFAULT_MODEL_NAME;
export const ASSISTANT_FALLBACK_MODEL_NAME = '';

const getModelStorageKeys = (userId = '') => {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';

    return [
        normalizedUserId ? `${ASSISTANT_MODEL_STORAGE_KEY}:${normalizedUserId}` : '',
        ASSISTANT_MODEL_STORAGE_KEY
    ].filter(Boolean);
};

const isAllowedAssistantModel = (modelName = '') => ASSISTANT_MODEL_OPTIONS.some((option) => option.id === modelName);

export const getStoredAssistantModel = (userId = '') => {
    if (typeof window === 'undefined') {
        return '';
    }

    return getModelStorageKeys(userId)
        .map((storageKey) => window.localStorage.getItem(storageKey)?.trim() || '')
        .find((modelName) => isAllowedAssistantModel(modelName)) || '';
};

export const setStoredAssistantModel = (modelName, userId = '') => {
    if (typeof window === 'undefined' || !isAllowedAssistantModel(modelName)) {
        return;
    }

    const [primaryStorageKey, fallbackStorageKey] = getModelStorageKeys(userId);
    window.localStorage.setItem(primaryStorageKey, modelName);

    if (fallbackStorageKey && fallbackStorageKey !== primaryStorageKey) {
        window.localStorage.setItem(fallbackStorageKey, modelName);
    }
};

export const getAssistantModelName = (preferredModelName = '', userId = '') => {
    const envModelName = import.meta.env.VITE_FIREBASE_AI_ASSISTANT_MODEL?.trim() || DEFAULT_MODEL_NAME;
    const selectedModelName = preferredModelName?.trim() || getStoredAssistantModel(userId) || envModelName;

    return isAllowedAssistantModel(selectedModelName) ? selectedModelName : DEFAULT_MODEL_NAME;
};

export const getFirebaseGenerativeModel = async ({
    scope = 'assistant',
    preferredModelName = '',
    userId = '',
    generationConfig = DEFAULT_GENERATION_CONFIG,
    systemInstruction = ASSISTANT_SYSTEM_INSTRUCTION
} = {}) => {
    const resolvedModelName = getAssistantModelName(preferredModelName, userId);
    const cacheKey = `${scope}:${resolvedModelName}`;

    if (!generativeModelPromises.has(cacheKey)) {
        generativeModelPromises.set(cacheKey, (async () => {
            await enableAppCheckIfConfigured();

            const ai = getAI(app, {
                backend: new GoogleAIBackend()
            });

            return getGenerativeModel(ai, {
                model: resolvedModelName,
                generationConfig: {
                    ...DEFAULT_GENERATION_CONFIG,
                    ...generationConfig
                },
                systemInstruction
            });
        })().catch((error) => {
            generativeModelPromises.delete(cacheKey);
            throw error;
        }));
    }

    return generativeModelPromises.get(cacheKey);
};

export const getAssistantModel = async (preferredModelName = '', userId = '') => {
    return getFirebaseGenerativeModel({
        scope: 'assistant',
        preferredModelName,
        userId,
        generationConfig: DEFAULT_GENERATION_CONFIG,
        systemInstruction: ASSISTANT_SYSTEM_INSTRUCTION
    });
};