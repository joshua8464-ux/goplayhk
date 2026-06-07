import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildAssistantReply, defaultGreetingMessages } from '../chatbotAssistant';
import { generateAssistantAiReply, rankLivePlayerOptions, shouldUseAssistantAi } from '../../app/data/assistantAi';
import { ASSISTANT_MODEL_OPTIONS, getAssistantModelName, getStoredAssistantModel, setStoredAssistantModel } from '../../app/config/firebaseAi';
import AppModal from '../../app/components/AppModal';
import { subscribeToDistrictLiveSlots, subscribeToWeeklyDistrictLeaderboard } from '../../app/data/liveBookings';

const STORAGE_KEY = 'goplayhk-assistant-session-v2';

const getStoredMessages = () => {
    if (typeof window === 'undefined') {
        return defaultGreetingMessages;
    }

    try {
        const rawValue = window.localStorage.getItem(STORAGE_KEY);
        if (!rawValue) {
            return defaultGreetingMessages;
        }

        const parsedValue = JSON.parse(rawValue);
        return Array.isArray(parsedValue) && parsedValue.length > 0 ? parsedValue : defaultGreetingMessages;
    } catch {
        return defaultGreetingMessages;
    }
};

const mapRecognitionError = (errorCode = '') => {
    if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
        return 'Microphone access was denied. Allow microphone access in the browser and try again.';
    }

    if (errorCode === 'no-speech') {
        return 'No speech was detected. Try again in a quieter place or speak a little closer to the microphone.';
    }

    if (errorCode === 'audio-capture') {
        return 'No microphone was detected. Check your device microphone and try again.';
    }

    return 'Voice capture could not start on this browser. You can keep using text input.';
};

const STATUS_LABELS = {
    drafting: 'Drafting the next move.',
    aiReady: 'AI reply ready.',
    guided: 'Guided answer ready.',
    fallback: 'AI is unavailable. Guided mode is active.',
    listening: 'Listening for details.',
    voiceIssue: 'Voice input needs attention.',
    reset: 'Conversation reset.',
    modelChanged: 'Assistant model updated.'
};

const MAX_RENDERED_MESSAGES = 36;
const PROMPT_STARTERS = [
    'How do I use booking and route options step by step?',
    'What is my next match and what should I do now?',
    'Find the best players to fill my current squad',
    'Recommend the fastest way to lock a venue tonight'
];

const RESPONSE_STYLE_LABELS = {
    concise: 'Quick answer',
    balanced: 'Balanced answer',
    guided: 'Detailed guide'
};

const getSourceLabel = (message = {}) => {
    if (message.source === 'ai-fallback') {
        return `AI recovery (${message.modelName || 'Gemini 2.5'})`;
    }

    if (message.source === 'ai') {
        return `AI (${message.modelName || 'Gemini'})`;
    }

    return 'Guided mode';
};

const createBookingConfirmations = () => ({
    account: false,
    venueArea: false,
    schedule: false,
    squad: false
});

const calculatePlayerCount = (draft) => {
    const parsedCount = Number.parseInt(String(draft?.playerCount || ''), 10);

    if (Number.isFinite(parsedCount) && parsedCount > 1) {
        return parsedCount;
    }

    return 4;
};

const Chatbot = ({ isOpen, onClose, onNavigate, state, socialState, currentView, dispatch: _dispatch, showToast = () => {}, isBookingUnlocked = true }) => {
    const mergedUsers = useMemo(() => ({
        ...(state?.users || {}),
        ...(socialState?.users || {})
    }), [socialState?.users, state?.users]);
    const safeState = useMemo(() => ({
        matches: state?.matches || [],
        venues: state?.venues || [],
        users: mergedUsers,
        currentUser: socialState?.currentUser || state?.currentUser || null
    }), [mergedUsers, socialState?.currentUser, state]);
    const currentUserId = safeState.currentUser?.id || null;
    const liveDistrict = safeState.currentUser?.district || '';
    const upcomingMatch = currentUserId
        ? safeState.matches.find((match) => match.participants.includes(currentUserId) && match.status === 'upcoming')
        : null;
    const [liveSlots, setLiveSlots] = useState([]);
    const [weeklyLeaderboard, setWeeklyLeaderboard] = useState(null);
    const livePlayerCandidates = useMemo(() => rankLivePlayerOptions({
        currentUser: safeState.currentUser,
        users: socialState?.users || safeState.users,
        preferredSport: upcomingMatch?.sport || safeState.currentUser?.sports?.[0] || '',
        district: liveDistrict,
        includeOffline: false,
        limit: 4
    }), [liveDistrict, safeState.currentUser, safeState.users, socialState?.users, upcomingMatch?.sport]);
    const recommendedVenue = useMemo(() => {
        const topLiveSlot = liveSlots.find((slot) => slot.venueId && (slot.currentParticipantCount || slot.participantIds?.length || 0) < (slot.targetGroupSize || 4));

        return safeState.venues.find((venue) => venue.id === topLiveSlot?.venueId) || safeState.venues[0] || null;
    }, [liveSlots, safeState.venues]);
    const hostedOpenMatch = currentUserId
        ? safeState.matches.find((match) => match.creatorId === currentUserId && match.status === 'upcoming' && match.participants.length < match.totalSlots)
        : null;
    const joinableMatch = currentUserId
        ? safeState.matches.find((match) => match.status === 'upcoming' && match.creatorId !== currentUserId && !match.participants.includes(currentUserId) && match.participants.length < match.totalSlots)
        : null;
    const proactiveRecommendation = useMemo(() => {
        if (hostedOpenMatch) {
            return {
                title: 'Fill your group',
                detail: `${hostedOpenMatch.sport} needs ${Math.max(hostedOpenMatch.totalSlots - hostedOpenMatch.participants.length, 0)} more players.`,
                actionLabel: 'Open Lobby',
                action: { type: 'navigate', page: 'bookingLobbies', params: {} }
            };
        }

        if (joinableMatch) {
            return {
                title: 'Join a live group',
                detail: `${joinableMatch.sport} has ${joinableMatch.participants.length}/${joinableMatch.totalSlots} players confirmed.`,
                actionLabel: 'Open Match',
                action: { type: 'navigate', page: 'matchDetail', params: { matchId: joinableMatch.id } }
            };
        }

        return {
            title: 'Live players are ready',
            detail: livePlayerCandidates.length
                ? `${livePlayerCandidates.length} compatible players are online in or near ${liveDistrict || 'your district'}.`
                : 'No strong live group is active right now. Start with discovery or a fresh slot.',
            actionLabel: livePlayerCandidates.length ? 'Open Discovery' : 'Open Booking',
            action: livePlayerCandidates.length
                ? { type: 'navigate', page: 'friendsDiscover', params: {} }
                : { type: 'navigate', page: 'booking', params: {} }
        };
    }, [hostedOpenMatch, joinableMatch, liveDistrict, livePlayerCandidates.length]);
    const [bookingConversation, setBookingConversation] = useState(null);
    const replyContext = useMemo(() => ({
        upcomingMatch,
        recommendedVenue,
        matches: safeState.matches,
        venues: safeState.venues,
        users: safeState.users,
        currentUser: safeState.currentUser,
        socialUsers: socialState?.users || {},
        socialFriendRequests: socialState?.friendRequests || [],
        liveSlots,
        weeklyLeaderboard,
        bookingDraft: bookingConversation,
        currentView: currentView || { page: 'assistant' },
        currentUserId
    }), [bookingConversation, currentUserId, currentView, liveSlots, recommendedVenue, safeState.currentUser, safeState.matches, safeState.users, safeState.venues, socialState?.friendRequests, socialState?.users, upcomingMatch, weeklyLeaderboard]);
    const [messages, setMessages] = useState(getStoredMessages);
    const [input, setInput] = useState('');
    const [isListening, setIsListening] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [aiIssue, setAiIssue] = useState('');
    const [voiceError, setVoiceError] = useState('');
    const [draftStatus, setDraftStatus] = useState('');
    const [selectedModelName, setSelectedModelName] = useState(() => getAssistantModelName(getStoredAssistantModel(currentUserId), currentUserId));
    const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
    const [showMessageMeta, setShowMessageMeta] = useState(false);
    const [bookingReview, setBookingReview] = useState(null);
    const [bookingConfirmations, setBookingConfirmations] = useState(createBookingConfirmations);
    const [isSubmittingBooking, setIsSubmittingBooking] = useState(false);
    const inputRef = useRef(null);
    const messagesEndRef = useRef(null);
    const recognitionRef = useRef(null);
    const modelMenuRef = useRef(null);
    const messagesContainerRef = useRef(null);
    const renderedMessages = useMemo(() => messages.slice(-MAX_RENDERED_MESSAGES), [messages]);
    const truncatedMessageCount = Math.max(messages.length - renderedMessages.length, 0);
    const shouldShowStarterPrompts = messages.length <= defaultGreetingMessages.length + 1;
    const shouldShowProactiveCard = messages.length <= defaultGreetingMessages.length + 2;
    const contextChips = useMemo(() => {
        const openMatchCount = safeState.matches.filter((match) => match.status === 'upcoming').length;

        return [
            `View: ${currentView?.page || 'assistant'}`,
            `Open matches: ${openMatchCount}`,
            `Live players: ${livePlayerCandidates.length}`,
            `Live slots: ${liveSlots.length}`
        ];
    }, [currentView?.page, livePlayerCandidates.length, liveSlots.length, safeState.matches]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!RecognitionCtor) {
            setVoiceError('Voice input is unavailable in this browser. You can keep using text chat.');
        }
    }, []);

    useEffect(() => {
        setSelectedModelName(getAssistantModelName(getStoredAssistantModel(currentUserId), currentUserId));
    }, [currentUserId]);

    useEffect(() => {
        if (!isModelMenuOpen) {
            return undefined;
        }

        const handlePointerDown = (event) => {
            if (!modelMenuRef.current?.contains(event.target)) {
                setIsModelMenuOpen(false);
            }
        };

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                setIsModelMenuOpen(false);
            }
        };

        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('keydown', handleEscape);

        return () => {
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('keydown', handleEscape);
        };
    }, [isModelMenuOpen]);

    useEffect(() => {
        if (!liveDistrict || !isOpen) {
            return undefined;
        }

        const unsubscribeSlots = subscribeToDistrictLiveSlots({ district: liveDistrict, maxItems: 80 }, setLiveSlots, () => setLiveSlots([]));
        const unsubscribeLeaderboard = subscribeToWeeklyDistrictLeaderboard({ district: liveDistrict }, setWeeklyLeaderboard, () => setWeeklyLeaderboard(null));

        return () => {
            unsubscribeSlots();
            unsubscribeLeaderboard();
        };
    }, [isOpen, liveDistrict]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }, [messages]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const frameId = window.requestAnimationFrame(() => {
            const container = messagesContainerRef.current;

            if (container) {
                container.scrollTop = container.scrollHeight;
                return;
            }

            messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
        });

        return () => window.cancelAnimationFrame(frameId);
    }, [isOpen, renderedMessages.length]);

    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }

        const timer = window.setTimeout(() => {
            inputRef.current?.focus();
        }, 80);

        return () => window.clearTimeout(timer);
    }, [isOpen]);

    useEffect(() => () => {
        const recognition = recognitionRef.current;
        if (recognition) {
            recognition.onresult = null;
            recognition.onerror = null;
            recognition.onend = null;
            recognition.abort?.();
        }
    }, []);

    const performAction = (action) => {
        if (!action) {
            return;
        }

        if (action.type === 'booking-review') {
            setBookingReview(action.draft || null);
            setBookingConversation(action.draft || null);
            setBookingConfirmations(createBookingConfirmations());
            setDraftStatus('Review booking checkpoints.');
            return;
        }

        if (action.type === 'navigate') {
            onClose();
            onNavigate({ page: action.page, params: action.params || {} });
            return;
        }

        if (action.type === 'copy' && typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(action.value || '').catch(() => {});
        }
    };

    const handleActionClick = (action) => {
        if (action?.type === 'prompt') {
            handleSend(action.prompt);
            return;
        }

        performAction(action);
    };

    const handleToggleBookingConfirmation = (key) => {
        setBookingConfirmations((currentValue) => ({
            ...currentValue,
            [key]: !currentValue[key]
        }));
    };

    const handleSubmitBookingFromChat = async () => {
        if (!bookingReview || isSubmittingBooking) {
            return;
        }

        const selectedVenue = safeState.venues.find((venue) => venue.id === bookingReview.venueId) || bookingReview.venue || null;

        if (!selectedVenue?.id || !bookingReview.date || !bookingReview.time || !safeState.currentUser?.id) {
            showToast('This booking draft is still missing venue, schedule, or account details.');
            return;
        }

        const allConfirmed = Object.values(bookingConfirmations).every(Boolean);
        if (!allConfirmed) {
            showToast('Confirm all booking checkpoints before reserving.');
            return;
        }

        if (!isBookingUnlocked) {
            showToast('Verify your email before moving this booking into confirmation.');
            onClose();
            onNavigate({ page: 'verificationPending', params: { blockedPage: 'booking' } });
            return;
        }

        setIsSubmittingBooking(true);

        try {
            const totalSlots = calculatePlayerCount(bookingReview);
            setMessages((previousMessages) => ([
                ...previousMessages,
                {
                    id: Date.now(),
                    text: `I moved ${selectedVenue.name} on ${bookingReview.date} at ${bookingReview.time} into the booking confirmation flow. Review it there before locking the session.`,
                    type: 'bot',
                    actions: [],
                    intent: 'booking-review-handoff',
                    source: 'guided'
                }
            ]));
            setBookingReview(null);
            setBookingConfirmations(createBookingConfirmations());
            setBookingConversation(null);
            setDraftStatus('Booking confirmation ready.');
            showToast('Booking draft moved into confirmation review.');
            onClose();
            onNavigate({
                page: 'createMatch',
                params: {
                    presetSport: bookingReview.sport || selectedVenue.sport,
                    presetDate: bookingReview.date,
                    presetTime: bookingReview.time,
                    presetDistrict: bookingReview.district || selectedVenue.location,
                    presetVenueId: selectedVenue.id,
                    presetTotalSlots: totalSlots,
                    presetMatchMode: 'smart',
                    presetInclusionFocus: 'Open to All',
                    startAtReview: true
                }
            });
        } catch (error) {
            showToast(error?.message || 'Chatbot booking could not be moved into confirmation right now.');
        } finally {
            setIsSubmittingBooking(false);
        }
    };

    const handleSend = async (overrideInput) => {
        const nextInput = (overrideInput ?? input).trim();
        if (!nextInput || isThinking) {
            return;
        }

        const stamp = Date.now();
        const nextHistory = [...messages, { id: stamp, text: nextInput, type: 'user' }];
        setMessages((previousMessages) => [
            ...previousMessages,
            { id: stamp, text: nextInput, type: 'user' }
        ]);
        setInput('');
        setVoiceError('');
        setAiIssue('');

        const fallbackReply = buildAssistantReply(nextInput, replyContext);
        const useAi = shouldUseAssistantAi(nextInput, replyContext);
        const shouldUseAiForMessage = fallbackReply.intent !== 'booking' && useAi;

        if (shouldUseAiForMessage) {
            setIsThinking(true);
            setDraftStatus(STATUS_LABELS.drafting);
        }

        let assistantReply = fallbackReply;

        try {
            if (shouldUseAiForMessage) {
                assistantReply = await generateAssistantAiReply({
                    rawInput: nextInput,
                    context: replyContext,
                    history: nextHistory,
                    fallbackReply,
                    preferredModelName: selectedModelName
                });
                setDraftStatus(assistantReply.source === 'ai-fallback' ? 'AI recovery mode served this reply.' : STATUS_LABELS.aiReady);
            } else if (fallbackReply.intent === 'booking') {
                setDraftStatus('Draft updated.');
            } else {
                setDraftStatus(STATUS_LABELS.guided);
            }
        } catch (error) {
            assistantReply = fallbackReply;
            setDraftStatus(shouldUseAiForMessage ? STATUS_LABELS.fallback : STATUS_LABELS.guided);
            if (shouldUseAiForMessage) {
                const issueMessage = error?.message;
                setAiIssue(issueMessage || 'Firebase AI Logic is unavailable right now.');
            }
        } finally {
            setIsThinking(false);
        }

        setMessages((previousMessages) => [
            ...previousMessages,
            {
                id: stamp + 1,
                text: assistantReply.text,
                type: 'bot',
                actions: assistantReply.actions || [],
                draft: assistantReply.draft || null,
                intent: assistantReply.intent || 'general',
                source: assistantReply.source || 'guided',
                confidence: assistantReply.confidence || 'medium',
                responseStyle: assistantReply.responseStyle || 'balanced',
                modelName: assistantReply.modelName || ''
            }
        ]);

        if (assistantReply.intent === 'booking') {
            setBookingConversation(assistantReply.draft || null);
        } else {
            setBookingConversation(null);
        }
    };

    const handleResetConversation = () => {
        setMessages(defaultGreetingMessages);
        setInput('');
        setAiIssue('');
        setVoiceError('');
        setBookingConversation(null);
        setBookingReview(null);
        setDraftStatus(STATUS_LABELS.reset);
        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(STORAGE_KEY);
        }
    };

    const handleModelChange = (event) => {
        const nextModelName = getAssistantModelName(event.target.value, currentUserId);
        setSelectedModelName(nextModelName);
        setStoredAssistantModel(nextModelName, currentUserId);
        setDraftStatus(STATUS_LABELS.modelChanged);
        setIsModelMenuOpen(false);
    };

    const selectedModelOption = ASSISTANT_MODEL_OPTIONS.find((modelOption) => modelOption.id === selectedModelName) || ASSISTANT_MODEL_OPTIONS[0];

    const handleToggleListening = () => {
        if (isListening && recognitionRef.current) {
            recognitionRef.current.stop?.();
            return;
        }

        const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!RecognitionCtor) {
            setVoiceError('This browser does not support free built-in speech recognition. Use text input instead.');
            return;
        }

        const recognition = new RecognitionCtor();
        recognition.lang = 'en-HK';
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognitionRef.current = recognition;
        setVoiceError('');
        setIsListening(true);
        setDraftStatus(STATUS_LABELS.listening);

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            Array.from(event.results).forEach((result) => {
                const transcript = result[0]?.transcript?.trim() || '';
                if (!transcript) {
                    return;
                }

                if (result.isFinal) {
                    finalTranscript = `${finalTranscript} ${transcript}`.trim();
                } else {
                    interimTranscript = `${interimTranscript} ${transcript}`.trim();
                }
            });

            if (finalTranscript) {
                setInput(finalTranscript);
                handleSend(finalTranscript);
                return;
            }

            if (interimTranscript) {
                setInput(interimTranscript);
            }
        };

        recognition.onerror = (event) => {
            setVoiceError(mapRecognitionError(event.error));
            setDraftStatus(STATUS_LABELS.voiceIssue);
            setIsListening(false);
            recognitionRef.current = null;
        };

        recognition.onend = () => {
            setIsListening(false);
            recognitionRef.current = null;
        };

        recognition.start();
    };

    if (!isOpen) {
        return null;
    }

    const bookingReviewVenue = safeState.venues.find((venue) => venue.id === bookingReview?.venueId) || bookingReview?.venue || null;
    const bookingReviewTotalSlots = calculatePlayerCount(bookingReview);
    const bookingReviewSplit = bookingReviewVenue ? Math.ceil((bookingReviewVenue.price || 0) / Math.max(bookingReviewTotalSlots, 1)) : 0;
    const bookingReviewReady = Boolean(bookingReview)
        && (bookingReview?.checkpoints || []).every((checkpoint) => bookingConfirmations[checkpoint.key]);

    return (
        <>
            <div className="modal-overlay open chatbot-overlay" style={{ zIndex: 1000 }}>
                <div className="modal-content chatbot-modal chatbot-surface chatbot-mobile-sheet open">
                <div className="chatbot-sheet-top">
                    <div className="chatbot-sheet-handle" aria-hidden="true"></div>
                    <div className="chatbot-shell-header">
                        <div className="chatbot-heading-copy">
                            <span className="section-kicker">Assistant layer</span>
                            <h3 className="text-lg font-semibold chatbot-title">GoPlayHK Concierge</h3>
                            <p className="chatbot-subtitle">Mobile-first booking, squad, and venue help.</p>
                            <div className="chatbot-context-chip-row" role="list" aria-label="Assistant context snapshot">
                                {contextChips.map((chip) => (
                                    <span key={chip} className="chatbot-context-chip" role="listitem">{chip}</span>
                                ))}
                            </div>
                        </div>
                        <div className="chatbot-header-actions">
                            <button
                                className={`chatbot-utility-button chatbot-meta-toggle ${showMessageMeta ? 'active' : ''}`}
                                type="button"
                                onClick={() => setShowMessageMeta((currentValue) => !currentValue)}
                                aria-pressed={showMessageMeta}
                            >
                                {showMessageMeta ? 'Hide details' : 'Show details'}
                            </button>
                            <button className="chatbot-utility-button" type="button" onClick={handleResetConversation}>Reset</button>
                            <button className="header-button chatbot-close-button" type="button" onClick={onClose} aria-label="Close assistant">
                                <i className="fas fa-times text-[#FC9905]"></i>
                            </button>
                        </div>
                    </div>

                    <div className="chatbot-status-stack">
                        <div className="chatbot-model-pill" role="status">
                            <div>
                                <strong>{selectedModelOption?.label || 'Gemini model'}</strong>
                                <span>Using Gemini 2.5 models for assistant reasoning and planning.</span>
                            </div>
                        </div>

                        {voiceError ? (
                            <div className="chatbot-status-banner chatbot-status-banner-error" role="status">
                                <i className="fas fa-microphone-slash" aria-hidden="true"></i>
                                <span>{voiceError}</span>
                            </div>
                        ) : null}

                        {aiIssue ? (
                            <div className="chatbot-status-banner chatbot-status-banner-error" role="status">
                                <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
                                <span>{aiIssue}</span>
                            </div>
                        ) : null}

                        {isThinking ? (
                            <div className="chatbot-status-banner" role="status">
                                <i className="fas fa-sparkles" aria-hidden="true"></i>
                                <span>Reviewing live players, current slots, and venue options.</span>
                            </div>
                        ) : null}

                        {!isThinking && shouldShowProactiveCard ? (
                            <div className="chatbot-status-banner chatbot-status-banner-proactive" role="status">
                                <i className="fas fa-bolt" aria-hidden="true"></i>
                                <div>
                                    <strong>{proactiveRecommendation.title}</strong>
                                    <p>{proactiveRecommendation.detail}</p>
                                </div>
                                <button
                                    type="button"
                                    className="chatbot-action-chip"
                                    onClick={() => performAction(proactiveRecommendation.action)}
                                >
                                    {proactiveRecommendation.actionLabel}
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div ref={messagesContainerRef} className="chatbot-messages chatbot-messages-shell flex-grow overflow-y-auto" role="log" aria-live="polite" aria-label="Assistant conversation">
                    {truncatedMessageCount > 0 ? (
                        <div className="chatbot-history-cap">
                            Showing the latest {renderedMessages.length} messages for smoother mobile scrolling. Earlier messages stay saved in this session.
                        </div>
                    ) : null}
                    {renderedMessages.map((message) => (
                        <div key={message.id} className={`chatbot-message-row ${message.type === 'bot' ? 'bot' : 'user'}`}>
                            <div className={`chatbot-message-bubble ${message.type === 'bot' ? 'bot' : 'user'}`}>
                                <p>{message.text}</p>
                                {message.type === 'bot' && showMessageMeta ? (
                                    <div className="chatbot-message-meta">
                                        <span className="section-kicker">{RESPONSE_STYLE_LABELS[message.responseStyle] || RESPONSE_STYLE_LABELS.balanced}</span>
                                        <small>{getSourceLabel(message)} • {(message.confidence || 'medium').toUpperCase()} confidence</small>
                                    </div>
                                ) : null}
                                {message.draft ? (
                                    <div className="chatbot-draft-card">
                                        <div className="chatbot-draft-header">
                                            <strong>Booking draft</strong>
                                            <span>{message.intent === 'booking' ? 'Ready for reservation' : 'Draft summary'}</span>
                                        </div>
                                        <div className="chatbot-draft-grid">
                                            <div>
                                                <span>Sport</span>
                                                <strong>{message.draft.sport}</strong>
                                            </div>
                                            <div>
                                                <span>Area</span>
                                                <strong>{message.draft.district}</strong>
                                            </div>
                                            <div>
                                                <span>Date</span>
                                                <strong>{message.draft.date || 'Choose date'}</strong>
                                            </div>
                                            <div>
                                                <span>Time</span>
                                                <strong>{message.draft.time || 'Choose time'}</strong>
                                            </div>
                                            <div>
                                                <span>Venue</span>
                                                <strong>{message.draft.venueName}</strong>
                                            </div>
                                            <div>
                                                <span>Players</span>
                                                <strong>{message.draft.playerCount || 'Flexible'}</strong>
                                            </div>
                                        </div>
                                        {message.draft.missing?.length > 0 ? (
                                            <p className="chatbot-draft-note">Still missing: {message.draft.missing.join(', ')}</p>
                                        ) : null}
                                    </div>
                                ) : null}
                                {message.actions?.length > 0 ? (
                                    <div className="chatbot-message-actions">
                                        {message.actions.map((action, index) => (
                                            <button
                                                key={`${action.label}-${index}`}
                                                type="button"
                                                className="chatbot-action-chip"
                                                onClick={() => handleActionClick(action.action)}
                                            >
                                                {action.label}
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef}></div>
                </div>

                <div className="chatbot-composer-shell">
                    {shouldShowStarterPrompts ? (
                        <div className="chatbot-prompt-grid" role="list" aria-label="Starter prompts">
                            {PROMPT_STARTERS.map((prompt) => (
                                <button
                                    key={prompt}
                                    type="button"
                                    className="chatbot-prompt-chip"
                                    onClick={() => handleSend(prompt)}
                                    role="listitem"
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <div className="chatbot-composer-toolbar chatbot-mobile-composer">
                        <div className="chatbot-config-shell" ref={modelMenuRef}>
                            <button
                                type="button"
                                className={`chatbot-config-button ${isModelMenuOpen ? 'open' : ''}`}
                                onClick={() => setIsModelMenuOpen((currentValue) => !currentValue)}
                                aria-haspopup="menu"
                                aria-expanded={isModelMenuOpen}
                                aria-label={`Configure assistant model. ${draftStatus || `Current model ${selectedModelOption?.label}`}`}
                                title={selectedModelOption?.label}
                            >
                                <i className="fas fa-gear" aria-hidden="true"></i>
                            </button>
                            {isModelMenuOpen ? (
                                <div className="chatbot-model-menu surface-tier-1" role="menu" aria-label="Assistant model menu">
                                    <div className="chatbot-model-menu-header">
                                        <span className="section-kicker">Model</span>
                                        <strong>{selectedModelOption?.label}</strong>
                                    </div>
                                    <div className="chatbot-model-option-list">
                                        {ASSISTANT_MODEL_OPTIONS.map((modelOption) => (
                                            <button
                                                key={modelOption.id}
                                                type="button"
                                                className={`chatbot-model-option ${selectedModelName === modelOption.id ? 'active' : ''}`}
                                                onClick={() => handleModelChange({ target: { value: modelOption.id } })}
                                                role="menuitemradio"
                                                aria-checked={selectedModelName === modelOption.id}
                                            >
                                                <span>{modelOption.label}</span>
                                                <small>{modelOption.description}</small>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                        <input
                            ref={inputRef}
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            className="input-field chatbot-composer-input"
                            placeholder="Ask about courts, players, timing, routes, or squad planning"
                            onKeyDown={(event) => event.key === 'Enter' && !isThinking && handleSend()}
                            disabled={isThinking}
                        />
                        <button
                            type="button"
                            className={`chatbot-voice-button ${isListening ? 'listening' : ''}`}
                            onClick={handleToggleListening}
                            aria-pressed={isListening}
                            aria-label={isListening ? 'Stop voice capture' : 'Start voice capture'}
                        >
                            <i className={`fas ${isListening ? 'fa-stop' : 'fa-microphone'}`} aria-hidden="true"></i>
                        </button>
                        <button type="button" className="btn-primary chatbot-send-button" onClick={() => handleSend()} disabled={isThinking}>{isThinking ? 'Thinking...' : 'Send'}</button>
                    </div>
                </div>
            </div>
            </div>
            <AppModal isOpen={Boolean(bookingReview)} close={() => setBookingReview(null)} title="Confirm Booking" contentClassName="chatbot-review-modal" innerClassName="chatbot-review-inner">
                {bookingReview ? (
                    <div className="quick-guide-shell">
                        <p className="quick-guide-intro">
                            Confirm the booking details below before the chatbot moves them into the booking confirmation screen.
                        </p>
                        <div className="booking-review-grid top-gap-sm">
                            <div className="booking-review-row"><span>Sport</span><strong>{bookingReview.sport}</strong></div>
                            <div className="booking-review-row"><span>Venue</span><strong>{bookingReviewVenue?.name || 'Not selected yet'}</strong></div>
                            <div className="booking-review-row"><span>Area</span><strong>{bookingReview.district || bookingReviewVenue?.location || 'Not selected yet'}</strong></div>
                            <div className="booking-review-row"><span>Start</span><strong>{bookingReview.date && bookingReview.time ? `${bookingReview.date} • ${bookingReview.time}` : 'Incomplete schedule'}</strong></div>
                            <div className="booking-review-row"><span>Squad</span><strong>{bookingReview.playerCount || bookingReviewTotalSlots} players</strong></div>
                            <div className="booking-review-row"><span>Split</span><strong>{bookingReviewVenue ? `HKD ${bookingReviewSplit}/player` : 'Choose venue first'}</strong></div>
                        </div>
                        {bookingReview.missing?.length ? (
                            <p className="quick-guide-note">Still missing: {bookingReview.missing.join(', ')}</p>
                        ) : null}
                        <div className="auth-checklist top-gap-md">
                            {(bookingReview.checkpoints || []).map((checkpoint) => (
                                <label key={checkpoint.key} className={`auth-check-item ${bookingConfirmations[checkpoint.key] ? 'valid' : ''}`}>
                                    <input
                                        type="checkbox"
                                        checked={Boolean(bookingConfirmations[checkpoint.key])}
                                        disabled={!checkpoint.ready || isSubmittingBooking}
                                        onChange={() => handleToggleBookingConfirmation(checkpoint.key)}
                                    />
                                    <i className={`fas ${bookingConfirmations[checkpoint.key] ? 'fa-circle-check' : 'fa-circle'}`}></i>
                                    <span>{checkpoint.label}: {checkpoint.detail}</span>
                                </label>
                            ))}
                        </div>
                        <div className="cta-button-row top-gap-md">
                            <button type="button" className="btn-secondary" onClick={() => setBookingReview(null)} disabled={isSubmittingBooking}>Keep Reviewing</button>
                            <button type="button" className="btn-secondary" onClick={() => handleActionClick({ type: 'navigate', page: 'createMatch', params: bookingReview.params || {} })} disabled={isSubmittingBooking}>Open Reservation Draft</button>
                            <button type="button" className="btn-primary" onClick={handleSubmitBookingFromChat} disabled={!bookingReviewReady || isSubmittingBooking}>{isSubmittingBooking ? 'Opening...' : 'Open Confirmation'}</button>
                        </div>
                    </div>
                ) : null}
            </AppModal>
        </>
    );
};

export default React.memo(Chatbot);