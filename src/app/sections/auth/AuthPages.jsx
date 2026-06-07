import React, { useState } from 'react';
import {
    browserLocalPersistence,
    browserSessionPersistence,
    createUserWithEmailAndPassword,
    getAdditionalUserInfo,
    GoogleAuthProvider,
    sendEmailVerification,
    sendPasswordResetEmail,
    setPersistence,
    signInWithEmailAndPassword,
    signInWithPopup,
    signInWithRedirect
} from 'firebase/auth';
import { enableAppCheckIfConfigured } from '../../config/firebase';

const HANDLE_REGEX = /^[a-z0-9](?:[a-z0-9_]{2,19})$/;
const GOOGLE_AUTH_INTENT_KEY = 'goplayhk_google_auth_intent';
const GOOGLE_AUTH_PROFILE_KEY = 'goplayhk_google_auth_profile';
const REMEMBER_AUTH_KEY = 'goplayhk_remember_auth';

const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
    prompt: 'select_account'
});

const normalizeHandle = (value = '') => value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);

const normalizeAuthErrorMessage = (error) => {
    const code = error?.code || '';
    const normalizedCode = code.toLowerCase();
    const rawMessage = error?.message || '';
    const normalizedMessage = rawMessage.toLowerCase();

    if (
        code === 'auth/invalid-app-credential'
        || code === 'auth/app-not-authorized'
        || normalizedMessage.includes('app check')
        || normalizedMessage.includes('invalid app credential')
    ) {
        return 'Secure sign-in is being rejected by Firebase App Check. The deployed domain must be registered for the current reCAPTCHA/App Check key, or App Check enforcement for Firebase Auth must be disabled in the Firebase or Google Cloud console.';
    }

    if (
        normalizedCode.includes('api_key_service_blocked')
        || normalizedCode.includes('requests-to-this-api')
        || normalizedMessage.includes('api_key_service_blocked')
        || normalizedMessage.includes('identitytoolkit')
        || normalizedMessage.includes('requests-to-this-api')
        || normalizedMessage.includes('getprojectconfig')
    ) {
        return 'Firebase Authentication is blocked for the configured Web API key. Set VITE_FIREBASE_API_KEY to your Firebase project Web API key. Gemini or AI Studio API keys cannot be used for Firebase Auth.';
    }

    if (code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
        return 'Email or password is incorrect.';
    }

    if (code === 'auth/operation-not-allowed') {
        return 'This sign-in method is not enabled in Firebase Authentication.';
    }

    if (code === 'auth/popup-blocked') {
        return 'The sign-in popup was blocked by the browser. Allow popups for this site and try again.';
    }

    if (code === 'auth/popup-closed-by-user') {
        return 'The sign-in popup was closed before authentication completed.';
    }

    if (code === 'auth/unauthorized-domain') {
        return 'This domain is not authorized for Firebase Authentication. Add the deployed domain to Firebase Authentication authorized domains.';
    }

    if (normalizedMessage.includes('handle') && normalizedMessage.includes('taken')) {
        return 'That handle is already taken. Choose another one and try again.';
    }

    return rawMessage || 'Authentication failed.';
};

const prepareSecureAuth = async () => {
    try {
        await enableAppCheckIfConfigured();
    } catch {
        // Let Firebase return the authoritative auth error if protection is still misconfigured.
    }
};

const isTrustedAuthUser = (user) => Boolean(user?.emailVerified);

const persistGoogleRedirectState = (intent, profile = {}) => {
    if (typeof window === 'undefined') {
        return;
    }

    const serializedProfile = JSON.stringify(profile);

    window.sessionStorage.setItem(GOOGLE_AUTH_INTENT_KEY, intent);
    window.sessionStorage.setItem(GOOGLE_AUTH_PROFILE_KEY, serializedProfile);
    window.localStorage.setItem(GOOGLE_AUTH_INTENT_KEY, intent);
    window.localStorage.setItem(GOOGLE_AUTH_PROFILE_KEY, serializedProfile);
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

const getStoredRememberPreference = () => {
    if (typeof window === 'undefined') {
        return true;
    }

    const savedValue = window.localStorage.getItem(REMEMBER_AUTH_KEY);
    return savedValue !== 'false';
};

const saveRememberPreference = (rememberLogin) => {
    if (typeof window === 'undefined') {
        return;
    }

    window.localStorage.setItem(REMEMBER_AUTH_KEY, rememberLogin ? 'true' : 'false');
};

const applyAuthPersistence = async (auth, rememberLogin) => {
    await setPersistence(auth, rememberLogin ? browserLocalPersistence : browserSessionPersistence);
    saveRememberPreference(rememberLogin);
};

const sendVerificationEmailSafely = async (user) => {
    try {
        await sendEmailVerification(user);
        return { sent: true, error: null };
    } catch (error) {
        return { sent: false, error };
    }
};

const beginGoogleRedirect = async (auth, intent, profile = {}, rememberLogin = true) => {
    await prepareSecureAuth();
    await applyAuthPersistence(auth, rememberLogin);
    persistGoogleRedirectState(intent, profile);
    await signInWithRedirect(auth, googleProvider);
};

const shouldFallbackToGoogleRedirect = (error) => [
    'auth/popup-blocked',
    'auth/web-storage-unsupported',
    'auth/operation-not-supported-in-this-environment'
].includes(error?.code || '');

const authenticateWithGooglePopup = async (auth, rememberLogin) => {
    await prepareSecureAuth();
    await applyAuthPersistence(auth, rememberLogin);
    clearGoogleRedirectState();
    return signInWithPopup(auth, googleProvider);
};

const shouldUseGoogleRedirectFlow = () => {
    if (typeof window === 'undefined') {
        return false;
    }

    const hostname = window.location.hostname.toLowerCase();
    return import.meta.env.PROD && (hostname.endsWith('.web.app') || hostname.endsWith('.firebaseapp.com'));
};

export const AuthPage = ({ auth, showToast, onLogin, onVerificationPending, setView, Modal }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [rememberLogin, setRememberLogin] = useState(getStoredRememberPreference);
    const [showVerificationModal, setShowVerificationModal] = useState(false);
    const [showResendModal, setShowResendModal] = useState(false);

    const handleGoogleLogin = async () => {
        try {
            if (shouldUseGoogleRedirectFlow()) {
                await beginGoogleRedirect(auth, 'login', {}, rememberLogin);
                return;
            }

            const userCredential = await authenticateWithGooglePopup(auth, rememberLogin);
            await userCredential.user.reload();
            await onLogin(userCredential.user);

            if (isTrustedAuthUser(userCredential.user)) {
                showToast('Signed in with Google.');
            } else {
                onVerificationPending?.({
                    email: userCredential.user.email || '',
                    displayName: userCredential.user.displayName || ''
                });
                showToast('Google account connected. Verify your email before booking or joining sessions.');
            }
        } catch (error) {
            if (shouldFallbackToGoogleRedirect(error)) {
                try {
                    await beginGoogleRedirect(auth, 'login', {}, rememberLogin);
                    return;
                } catch (redirectError) {
                    showToast(`Google login failed: ${normalizeAuthErrorMessage(redirectError)}`);
                    return;
                }
            }

            showToast(`Google login failed: ${normalizeAuthErrorMessage(error)}`);
        }
    };

    const handleLogin = async () => {
        try {
            await prepareSecureAuth();
            await applyAuthPersistence(auth, rememberLogin);
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            await userCredential.user.reload();

            await onLogin(userCredential.user);

            if (isTrustedAuthUser(userCredential.user)) {
                showToast('Welcome back!');
            } else {
                onVerificationPending?.({
                    email: userCredential.user.email || email,
                    displayName: userCredential.user.displayName || ''
                });
                showToast('Welcome in. Verify your email before booking or joining sessions.');
            }
        } catch (error) {
            showToast(`Login failed: ${normalizeAuthErrorMessage(error)}`);
        }
    };

    const handleResendVerification = async () => {
        try {
            if (!auth.currentUser) {
                showToast('Log in first so we know which account to verify.');
                return;
            }
            await sendEmailVerification(auth.currentUser);
            setShowVerificationModal(false);
            setShowResendModal(true);
            showToast('Verification email resent!');
        } catch (error) {
            showToast(`Error resending: ${error.message}`);
        }
    };

    return (
        <div className="auth-container auth-shell">
            <div className="auth-hero-panel fade-in">
                <span className="auth-chip">Member Login</span>
                <h1 className="auth-title">Return to your booking and team dashboard.</h1>
                <p className="auth-copy">Log in to continue from where you left off, reopen your session lobbies, and keep your route, teammates, and venue selections connected.</p>
                <div className="auth-benefits">
                    <div className="auth-benefit-card">
                        <i className="fas fa-bolt" aria-hidden="true"></i>
                        <span>Reopen active bookings instantly</span>
                    </div>
                    <div className="auth-benefit-card">
                        <i className="fas fa-user-group" aria-hidden="true"></i>
                        <span>Continue with squad and invite management</span>
                    </div>
                    <div className="auth-benefit-card">
                        <i className="fas fa-shield-heart" aria-hidden="true"></i>
                        <span>Verified account access and safer match flow</span>
                    </div>
                </div>
            </div>
            <form className="card auth-card fade-in auth-form-shell" onSubmit={(event) => {
                event.preventDefault();
                handleLogin();
            }}>
                <h2 className="auth-form-title">Login</h2>
                <p className="auth-form-note">Use the account you verified by email. If you are new, go back and create an account first.</p>
                <div className="auth-verification-banner">
                    <i className="fas fa-envelope-circle-check" aria-hidden="true"></i>
                    <div>
                        <strong>Email verification unlocks booking</strong>
                        <p>You can enter the app immediately, but booking and join flows stay locked until verification is complete.</p>
                    </div>
                </div>
                <div className="input-group">
                    <label>Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="input-field"
                        autoComplete="email"
                        placeholder="Enter your email"
                    />
                </div>
                <div className="input-group">
                    <label>Password</label>
                    <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="input-field"
                        autoComplete="current-password"
                        placeholder="Enter your password"
                    />
                </div>
                <label className="auth-inline-toggle">
                    <input type="checkbox" checked={showPassword} onChange={() => setShowPassword((current) => !current)} />
                    <span>Show password</span>
                </label>
                <label className="auth-inline-toggle">
                    <input type="checkbox" checked={rememberLogin} onChange={() => setRememberLogin((current) => !current)} />
                    <span>Remember me on this device</span>
                </label>
                <button type="submit" className="btn-primary">
                    Enter Network
                </button>
                <button type="button" className="btn-secondary body-copy-top-gap-sm" onClick={handleGoogleLogin}>
                    Continue with Google
                </button>
                <p className="body-copy-sm body-copy-center body-copy-top-gap-sm">
                    <button type="button" className="link-text-button" onClick={() => setShowVerificationModal(true)}>
                        Resend verification email?
                    </button>
                </p>
                <p className="body-copy-sm body-copy-center body-copy-top-gap-lg">
                    <button type="button" className="link-text-button" onClick={() => setView('intro')}>
                        Back to Welcome Screen
                    </button>
                </p>
                <p className="body-copy-sm body-copy-top-gap-lg">
                    Don't have an account?{' '}
                    <button type="button" className="link-text-button" onClick={() => setView('register')}>
                        Register
                    </button>
                </p>
                <p className="body-copy-sm body-copy-top-gap-sm">
                    Forgot password?{' '}
                    <button type="button" className="link-text-button" onClick={() => setView('forgot')}>
                        Reset Password
                    </button>
                </p>
            </form>
            <Modal
                isOpen={showVerificationModal}
                close={() => setShowVerificationModal(false)}
                title="Verify Your Email"
            >
                <p className="body-copy-sm body-copy-bottom-gap">Your email needs verification before logging in. Check your inbox and spam folder.</p>
                <button type="button" className="btn-primary button-gap-bottom" onClick={handleResendVerification}>Resend Verification Email</button>
                <button type="button" className="btn-secondary" onClick={() => setShowVerificationModal(false)}>Close</button>
            </Modal>

            <Modal
                isOpen={showResendModal}
                close={() => setShowResendModal(false)}
                title="Email Resent"
            >
                <p className="body-copy-sm body-copy-bottom-gap">We&apos;ve resent the verification email. Please check your inbox and spam folder.</p>
                <button type="button" className="btn-primary" onClick={() => setShowResendModal(false)}>Okay</button>
            </Modal>
        </div>
    );
};

export const RegisterPage = ({ auth, showToast, onRegister, onLogin, onVerificationPending, setView, Modal }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [handle, setHandle] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [favoriteSport, setFavoriteSport] = useState('Tennis');
    const [homeDistrict, setHomeDistrict] = useState('Causeway Bay');
    const [acceptTerms, setAcceptTerms] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [rememberLogin, setRememberLogin] = useState(getStoredRememberPreference);
    const [showVerificationModal, setShowVerificationModal] = useState(false);

    const handleGoogleRegister = async () => {
        try {
            const requestedHandle = normalizeHandle(handle);
            const googleProfile = {
                displayName: displayName.trim() || 'Google Player',
                handle: HANDLE_REGEX.test(requestedHandle) ? requestedHandle : '',
                favoriteSport,
                homeDistrict
            };
            if (shouldUseGoogleRedirectFlow()) {
                await beginGoogleRedirect(auth, 'register', googleProfile, rememberLogin);
                return;
            }

            const userCredential = await authenticateWithGooglePopup(auth, rememberLogin);
            const additionalInfo = getAdditionalUserInfo(userCredential);

            if (additionalInfo?.isNewUser) {
                await onRegister(userCredential.user, googleProfile);
                onVerificationPending?.({
                    email: userCredential.user.email || '',
                    displayName: googleProfile.displayName || userCredential.user.displayName || ''
                });
                showToast('Google account created. You can explore now and verify before booking.');
                return;
            }

            await onLogin(userCredential.user, googleProfile);
            onVerificationPending?.({
                email: userCredential.user.email || '',
                displayName: userCredential.user.displayName || googleProfile.displayName || ''
            });
            showToast('This Google account already exists, so you were signed in directly.');
        } catch (error) {
            if (shouldFallbackToGoogleRedirect(error)) {
                try {
                    const requestedHandle = normalizeHandle(handle);
                    await beginGoogleRedirect(auth, 'register', {
                        displayName: displayName.trim() || 'Google Player',
                        handle: HANDLE_REGEX.test(requestedHandle) ? requestedHandle : '',
                        favoriteSport,
                        homeDistrict
                    }, rememberLogin);
                    return;
                } catch (redirectError) {
                    showToast(`Google sign-up failed: ${normalizeAuthErrorMessage(redirectError)}`);
                    return;
                }
            }

            showToast(`Google sign-up failed: ${normalizeAuthErrorMessage(error)}`);
        }
    };

    const passwordChecks = [
        { label: 'At least 8 characters', valid: password.length >= 8 },
        { label: 'Includes a number', valid: /\d/.test(password) },
        { label: 'Matches confirmation', valid: password.length > 0 && password === confirmPassword }
    ];

    const handleRegister = async () => {
        if (!displayName.trim()) {
            showToast('Enter a display name to continue.');
            return;
        }

        if (!email.trim()) {
            showToast('Enter your email to continue.');
            return;
        }

        const normalizedHandle = normalizeHandle(handle);
        if (!HANDLE_REGEX.test(normalizedHandle)) {
            showToast('Choose a unique handle using 3-20 lowercase letters, numbers, or underscores.');
            return;
        }

        if (!acceptTerms) {
            showToast('Accept the account terms before creating your profile.');
            return;
        }

        if (passwordChecks.some((check) => !check.valid)) {
            showToast('Your password setup is incomplete. Review the requirements and try again.');
            return;
        }

        try {
            await prepareSecureAuth();
            await applyAuthPersistence(auth, rememberLogin);
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            await onRegister(userCredential.user, { displayName, handle: normalizedHandle, favoriteSport, homeDistrict });
            const verificationResult = await sendVerificationEmailSafely(userCredential.user);
            onVerificationPending?.({
                email: userCredential.user.email || email,
                displayName
            });

            if (verificationResult.sent) {
                showToast('Account created. Verification email sent. You can explore now and verify before booking.');
            } else {
                showToast(`Account created. Verification email could not be sent automatically: ${normalizeAuthErrorMessage(verificationResult.error)} Use resend from the verification screen before booking.`);
            }
        } catch (error) {
            showToast(`Registration failed: ${normalizeAuthErrorMessage(error)}`);
        }
    };

    return (
        <div className="auth-container auth-shell">
            <div className="auth-hero-panel fade-in">
                <span className="auth-chip">New Member Setup</span>
                <h1 className="auth-title">Create a profile that is ready for booking, squads, and routing.</h1>
                <p className="auth-copy">Set up the essentials once so the app can shape venue discovery, social coordination, and future recommendations around how you actually play.</p>
                <div className="auth-benefits">
                    <div className="auth-benefit-card">
                        <i className="fas fa-id-card" aria-hidden="true"></i>
                        <span>Cleaner identity and verified sign-in flow</span>
                    </div>
                    <div className="auth-benefit-card">
                        <i className="fas fa-location-dot" aria-hidden="true"></i>
                        <span>District-aware venue suggestions from the start</span>
                    </div>
                    <div className="auth-benefit-card">
                        <i className="fas fa-universal-access" aria-hidden="true"></i>
                        <span>Settings ready for the app&apos;s accessibility layer</span>
                    </div>
                </div>
            </div>
            <form className="card auth-card fade-in auth-form-shell" onSubmit={(event) => {
                event.preventDefault();
                handleRegister();
            }}>
                <div className="section-heading-row compact-heading-row auth-form-header-row">
                    <div>
                        <span className="section-kicker">Step 1 of 1</span>
                        <h2 className="auth-form-title">Create your account</h2>
                    </div>
                </div>
                <p className="auth-form-note">This takes under a minute. You can enter the app right away, then verify your email before using booking features.</p>
                <div className="auth-verification-banner">
                    <i className="fas fa-shield-check" aria-hidden="true"></i>
                    <div>
                        <strong>Verification happens before booking</strong>
                        <p>Your account is created first, you can explore immediately, and booking features unlock once the email link is confirmed.</p>
                    </div>
                </div>
                <div className="input-group">
                    <label>Display Name</label>
                    <input
                        type="text"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        className="input-field"
                        autoComplete="name"
                        placeholder="Enter your name"
                    />
                </div>
                <div className="input-group">
                    <label>Unique Handle</label>
                    <input
                        type="text"
                        value={handle}
                        onChange={(event) => setHandle(normalizeHandle(event.target.value))}
                        className="input-field"
                        autoComplete="nickname"
                        placeholder="e.g. harbour_ace"
                    />
                </div>
                <div className="booking-field-grid auth-field-grid">
                    <div className="input-group">
                        <label>Primary Sport</label>
                        <select
                            value={favoriteSport}
                            onChange={(event) => setFavoriteSport(event.target.value)}
                            className="input-field"
                        >
                            {['Tennis', 'Basketball', 'Badminton', 'Football', 'Swimming', 'Running'].map((sport) => (
                                <option key={sport} value={sport}>{sport}</option>
                            ))}
                        </select>
                    </div>
                    <div className="input-group">
                        <label>Home District</label>
                        <select
                            value={homeDistrict}
                            onChange={(event) => setHomeDistrict(event.target.value)}
                            className="input-field"
                        >
                            {['Causeway Bay', 'Kowloon City', 'Tsim Sha Tsui', 'Yau Ma Tei', 'Happy Valley', 'Tsuen Wan'].map((district) => (
                                <option key={district} value={district}>{district}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="input-group">
                    <label>Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="input-field"
                        autoComplete="email"
                        placeholder="Enter your email"
                    />
                </div>
                <div className="input-group">
                    <label>Password</label>
                    <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="input-field"
                        autoComplete="new-password"
                        placeholder="Create a password"
                    />
                </div>
                <div className="input-group">
                    <label>Confirm Password</label>
                    <input
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        className="input-field"
                        autoComplete="new-password"
                        placeholder="Re-enter your password"
                    />
                </div>
                <label className="auth-inline-toggle">
                    <input type="checkbox" checked={showPassword} onChange={() => setShowPassword((current) => !current)} />
                    <span>Show password fields</span>
                </label>
                <label className="auth-inline-toggle">
                    <input type="checkbox" checked={rememberLogin} onChange={() => setRememberLogin((current) => !current)} />
                    <span>Remember me on this device</span>
                </label>
                <div className="auth-checklist">
                    {passwordChecks.map((check) => (
                        <div key={check.label} className={`auth-check-item ${check.valid ? 'valid' : ''}`}>
                            <i className={`fas ${check.valid ? 'fa-circle-check' : 'fa-circle'}`} aria-hidden="true"></i>
                            <span>{check.label}</span>
                        </div>
                    ))}
                </div>
                <label className="auth-inline-toggle auth-terms-toggle">
                    <input type="checkbox" checked={acceptTerms} onChange={() => setAcceptTerms((current) => !current)} />
                    <span>I agree to email verification and account security checks for GoPlayHK.</span>
                </label>
                <button type="submit" className="btn-primary">
                    Create Profile
                </button>
                <button type="button" className="btn-secondary body-copy-top-gap-sm" onClick={handleGoogleRegister}>
                    Sign Up with Google
                </button>
                <p className="body-copy-sm body-copy-center body-copy-top-gap-lg">
                    <button type="button" className="link-text-button" onClick={() => setView('intro')}>
                        Back to Welcome Screen
                    </button>
                </p>
                <p className="body-copy-sm body-copy-top-gap-lg">
                    Already have an account?{' '}
                    <button type="button" className="link-text-button" onClick={() => setView('login')}>
                        Login
                    </button>
                </p>
            </form>
            <Modal
                isOpen={showVerificationModal}
                close={() => setShowVerificationModal(false)}
                title="Email Verification Sent"
            >
                <p className="body-copy-sm body-copy-bottom-gap">We&apos;ve sent a verification email to {email}. Please check your inbox and spam folder if needed to verify your account before logging in.</p>
                <p className="body-copy-sm body-copy-bottom-gap">This step helps keep your account secure. If you do not receive it in a few minutes, try resending from the login page.</p>
                <button type="button" className="btn-primary" onClick={() => {
                    setShowVerificationModal(false);
                    setView('login');
                }}>Go To Login</button>
            </Modal>
        </div>
    );
};

export const ForgotPasswordPage = ({ auth, showToast, setView }) => {
    const [email, setEmail] = useState('');

    const handleResetPassword = async () => {
        try {
            await prepareSecureAuth();
            await sendPasswordResetEmail(auth, email);
            showToast('Password reset email sent!');
        } catch (error) {
            showToast(`Error: ${normalizeAuthErrorMessage(error)}`);
        }
    };

    return (
        <div className="auth-container auth-shell">
            <div className="auth-hero-panel fade-in">
                <span className="auth-chip">Secure Recovery</span>
                <h1 className="auth-title">Recover access without losing momentum.</h1>
                <p className="auth-copy">We&apos;ll send a reset link so you can get back to bookings, teammates, and your next session.</p>
            </div>
            <form className="card auth-card fade-in auth-form-shell" onSubmit={(event) => {
                event.preventDefault();
                handleResetPassword();
            }}>
                <h2 className="auth-form-title">Reset Your Password</h2>
                <div className="input-group">
                    <label>Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="input-field"
                        autoComplete="email"
                        placeholder="Enter your email"
                    />
                </div>
                <button type="submit" className="btn-primary">
                    Send Recovery Link
                </button>
                <p className="body-copy-sm body-copy-top-gap-lg">
                    Back to{' '}
                    <button type="button" className="link-text-button" onClick={() => setView('login')}>
                        Login
                    </button>
                </p>
            </form>
        </div>
    );
};

export const VerificationPendingPage = ({ auth, showToast, setView, pendingEmail = '', pendingDisplayName = '', onVerified, inApp = false, onReturnToApp }) => {
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isResending, setIsResending] = useState(false);
    const effectiveEmail = pendingEmail || auth.currentUser?.email || 'your inbox';
    const effectiveName = pendingDisplayName || auth.currentUser?.displayName || 'your profile';

    const handleResendVerification = async () => {
        if (!auth.currentUser) {
            showToast('Log in again so we know which account to verify.');
            setView('login');
            return;
        }

        setIsResending(true);

        try {
            await sendEmailVerification(auth.currentUser);
            showToast('Verification email resent.');
        } catch (error) {
            showToast(`Could not resend verification: ${normalizeAuthErrorMessage(error)}`);
        } finally {
            setIsResending(false);
        }
    };

    const handleRefreshVerification = async () => {
        if (!auth.currentUser) {
            showToast('Log in again so we can refresh your verification status.');
            setView('login');
            return;
        }

        setIsRefreshing(true);

        try {
            await auth.currentUser.reload();

            if (isTrustedAuthUser(auth.currentUser)) {
                await onVerified?.(auth.currentUser);
                showToast(inApp ? 'Email verified. Booking is now unlocked.' : 'Email verified. Welcome in.');
                return;
            }

            showToast('Verification is still pending. Check your inbox and spam folder.');
        } catch (error) {
            showToast(`Could not refresh verification: ${normalizeAuthErrorMessage(error)}`);
        } finally {
            setIsRefreshing(false);
        }
    };

    return (
        <div className="auth-container auth-shell verification-pending-shell">
            <div className="auth-hero-panel fade-in">
                <span className="auth-chip">Verification Required</span>
                <h1 className="auth-title">Confirm your email before booking and live session actions.</h1>
                <p className="auth-copy">We created {effectiveName ? `${effectiveName}'s` : 'your'} account. Explore stays open, but booking, join, and reservation tools stay locked until the verification link in {effectiveEmail} is confirmed.</p>
                <div className="auth-benefits">
                    <div className="auth-benefit-card">
                        <i className="fas fa-envelope-open-text" aria-hidden="true"></i>
                        <span>Open the latest email from GoPlayHK</span>
                    </div>
                    <div className="auth-benefit-card">
                        <i className="fas fa-shield-heart" aria-hidden="true"></i>
                        <span>This keeps live invites and bookings tied to verified accounts</span>
                    </div>
                </div>
            </div>
            <div className="card auth-card fade-in auth-form-shell verification-pending-card">
                <div className="section-heading-row compact-heading-row auth-form-header-row">
                    <div>
                        <span className="section-kicker">Next step</span>
                        <h2 className="auth-form-title">Verification is still pending</h2>
                    </div>
                </div>
                <p className="auth-form-note">After you click the verification link, come back here and refresh your status.</p>
                <div className="auth-verification-banner">
                    <i className="fas fa-circle-info" aria-hidden="true"></i>
                    <div>
                        <strong>Inbox first, then refresh</strong>
                        <p>If nothing arrives within a few minutes, check spam or resend the email below.</p>
                    </div>
                </div>
                <div className="intro-action-stack top-gap-md verification-pending-actions">
                    <button type="button" className="btn-primary" onClick={handleRefreshVerification} disabled={isRefreshing}>
                        {isRefreshing ? 'Checking Verification...' : 'I Verified My Email'}
                    </button>
                    <button type="button" className="btn-secondary" onClick={handleResendVerification} disabled={isResending}>
                        {isResending ? 'Resending...' : 'Resend Verification Email'}
                    </button>
                    {inApp ? (
                        <button type="button" className="btn-secondary" onClick={() => onReturnToApp?.()}>
                            Back To Home
                        </button>
                    ) : (
                        <button type="button" className="btn-secondary" onClick={() => setView('login')}>
                            Back To Login
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
