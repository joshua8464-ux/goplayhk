export const formatHourLabel = (time = '') => {
    const hour = Number.parseInt((time || '').split(':')[0], 10);

    if (Number.isNaN(hour)) {
        return time;
    }

    if (hour === 0) {
        return '12 AM';
    }

    if (hour === 12) {
        return '12 PM';
    }

    return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
};

export const getNextSevenDayOptions = () => Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + index);

    return {
        value: date.toISOString().slice(0, 10),
        dayLabel: index === 0 ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' }),
        dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    };
});

export const getLeafletTileLayerConfig = (theme = 'dark') => {
    if (theme === 'light') {
        return {
            url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            options: {
                attribution: '&copy; OpenStreetMap contributors',
                maxZoom: 19
            }
        };
    }

    return {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        options: {
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        }
    };
};
