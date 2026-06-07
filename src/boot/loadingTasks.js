import {
    scheduleIdleTask,
    warmAuthenticatedShell,
    warmDeferredExperience,
    preloadForView
} from '../dataconnect-generated/prefetch';

export const queueAuthenticatedLoading = () => {
    const cleanups = [];

    cleanups.push(scheduleIdleTask(() => {
        warmAuthenticatedShell();
    }, 900));

    cleanups.push(scheduleIdleTask(() => {
        warmDeferredExperience();
    }, 1600));

    return () => {
        cleanups.forEach((cleanup) => cleanup());
    };
};

export const queueNavigationWarmup = (page) => scheduleIdleTask(() => {
    preloadForView(page);
}, 700);