import React from 'react';
import { createBottomNavItems, normalizeNavPage } from '../navigation/pageRegistry';

const BottomNavigation = ({ activePage, currentUserId, onNavigate }) => {
    const activeNavPage = normalizeNavPage(activePage);
    const navItems = createBottomNavItems(currentUserId);

    return (
        <footer className="app-footer" aria-label="Primary navigation">
            {navItems.map((item) => {
                const isActive = activeNavPage === item.page;
                return (
                    <button
                        key={item.page}
                        type="button"
                        className={`nav-item ${isActive ? 'active' : ''}`}
                        onClick={() => onNavigate({ page: item.page, params: item.params || {} })}
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={item.label}
                    >
                        <div className="nav-icon-shell">
                            <i className={`fas ${item.icon}`} aria-hidden="true"></i>
                        </div>
                        <span>{item.label}</span>
                    </button>
                );
            })}
        </footer>
    );
};

export default BottomNavigation;
