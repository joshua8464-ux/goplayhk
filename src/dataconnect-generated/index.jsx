import React from 'react';
import ReactDOM from 'react-dom/client';
import { loadRootApp } from './prefetch';

let root;

export const mountApp = async (container, bootCallbacks = {}) => {
    const { default: Root } = await loadRootApp();

    if (!root) {
        root = ReactDOM.createRoot(container);
    }

    root.render(
        <React.StrictMode>
            <Root {...bootCallbacks} />
        </React.StrictMode>
    );

    return root;
};