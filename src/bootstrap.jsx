import './index.css';
import { mountApp } from './dataconnect-generated/index.jsx';

const MIN_SPLASH_MS = 900;

const rootElement = document.getElementById('root');
const splashElement = document.getElementById('boot-splash');
const statusElement = document.getElementById('boot-status');
const progressElement = document.getElementById('boot-progress-fill');

const startedAt = performance.now();
let splashClosed = false;

const loadDeferredIconStyles = () => {
    const connection = typeof navigator !== 'undefined' ? navigator.connection || navigator.mozConnection || navigator.webkitConnection : null;
    const prefersMoreDelay = Boolean(connection?.saveData) || ['slow-2g', '2g'].includes(connection?.effectiveType || '');

    const loadStyles = () => {
        Promise.all([
            import('@fortawesome/fontawesome-free/css/fontawesome.min.css'),
            import('@fortawesome/fontawesome-free/css/solid.min.css'),
            import('@fortawesome/fontawesome-free/css/regular.min.css')
        ]).catch((error) => {
            console.warn('Font Awesome styles failed to load after boot.', error);
        });
    };

    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(loadStyles, { timeout: prefersMoreDelay ? 3200 : 2400 });
        return;
    }

    window.setTimeout(loadStyles, prefersMoreDelay ? 2400 : 1600);
};

const setStatus = (message, progress) => {
    if (statusElement) {
        statusElement.textContent = message;
    }

    if (progressElement) {
        progressElement.style.width = `${progress}%`;
    }
};

const closeSplash = async () => {
    if (splashClosed || !splashElement) {
        return;
    }

    splashClosed = true;
    const elapsed = performance.now() - startedAt;
    const waitTime = Math.max(0, MIN_SPLASH_MS - elapsed);

    if (waitTime > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, waitTime));
    }

    setStatus('Ready to play', 100);
    splashElement.classList.add('exiting');
    window.setTimeout(() => {
        splashElement.remove();
        rootElement?.removeAttribute('aria-busy');
    }, 650);
};

setStatus('Loading core experience', 24);
loadDeferredIconStyles();

mountApp(rootElement, {
    onBootReady: () => {
        closeSplash();
    },
    onBootStage: (stage) => {
        if (stage === 'auth-resolved') {
            setStatus('Preparing your sports network', 78);
            return;
        }

        if (stage === 'mounted') {
            setStatus('Finalizing the interface', 56);
        }
    }
}).catch((error) => {
    console.error('GoPlayHK boot failed', error);
    setStatus('App failed to load. Refresh to try again.', 100);
    if (progressElement) {
        progressElement.classList.add('error');
    }
});