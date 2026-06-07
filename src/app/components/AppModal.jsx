import React, { useCallback, useEffect, useId, useRef, useState } from 'react';

const MODAL_CLOSE_MS = 350;

const AppModal = ({ isOpen, close, title, children, contentClassName = '', innerClassName = '' }) => {
    const [isClosing, setIsClosing] = useState(false);
    const titleId = useId();
    const returnFocusRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setIsClosing(false);
            returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
    }, [isOpen]);

    const closeWithFocusReturn = useCallback(() => {
        window.setTimeout(() => {
            close();
            returnFocusRef.current?.focus?.();
        }, MODAL_CLOSE_MS);
    }, [close]);

    useEffect(() => {
        if (!isOpen && !isClosing) {
            return undefined;
        }

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsClosing(true);
                closeWithFocusReturn();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [closeWithFocusReturn, isClosing, isOpen]);

    if (!isOpen && !isClosing) {
        return null;
    }

    const handleClose = () => {
        setIsClosing(true);
        closeWithFocusReturn();
    };

    return (
        <div
            className={`modal-overlay ${isOpen && !isClosing ? 'open' : ''} ${isClosing ? 'closing' : ''}`}
            onClick={handleClose}
        >
            <div
                className={`modal-content ${contentClassName} ${isOpen && !isClosing ? 'open' : ''} ${isClosing ? 'closing' : ''}`.trim()}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={typeof title === 'string' ? titleId : undefined}
            >
                <div className="modal-shell-header">
                    {typeof title === 'string' ? (
                        <h3 id={titleId} className="modal-title">{title}</h3>
                    ) : title}
                    <button
                        type="button"
                        className="modal-close-button"
                        onClick={handleClose}
                        aria-label="Close dialog"
                    >
                        <i className="fas fa-times" aria-hidden="true"></i>
                    </button>
                </div>
                <div className={`modal-inner ${innerClassName}`.trim()}>
                    {children}
                </div>
            </div>
        </div>
    );
};

export default AppModal;
