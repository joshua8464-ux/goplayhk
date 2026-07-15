import React, { useMemo, useState } from 'react';
import { createPickupGame, MAX_PICKUP_SPOTS, MIN_PICKUP_SPOTS } from '../../data/pickupGames';

const SPORT_OPTIONS = [
    'Tennis', 'Basketball', 'Badminton', 'Football', 'Swimming', 'Rugby',
    'Volleyball', 'Athletics', 'Running', 'Hiking', 'Cycling', 'Golf', 'Multi-sport'
];

const combineDateTime = (date, time) => {
    if (!date) {
        return '';
    }

    const parsed = new Date(`${date}T${time || '18:00'}:00`);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }

    return parsed.toISOString();
};

const HostGamePage = ({ state, onBack, onNavigate, showToast, Header }) => {
    const venues = useMemo(() => state?.venues || [], [state?.venues]);
    const currentUser = state?.currentUser || {};

    const [form, setForm] = useState({
        title: '',
        description: '',
        sport: currentUser.sports?.[0] || 'Tennis',
        venueId: '',
        date: '',
        time: '18:00',
        spotsTotal: 6
    });
    const [submitting, setSubmitting] = useState(false);

    const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

    const selectedVenue = venues.find((venue) => venue.id === form.venueId) || null;

    const handleVenueChange = (venueId) => {
        const venue = venues.find((entry) => entry.id === venueId) || null;
        setForm((prev) => ({
            ...prev,
            venueId,
            sport: venue?.sport || prev.sport
        }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        if (!form.title.trim()) {
            showToast?.('Give your game a title.', 'error');
            return;
        }

        setSubmitting(true);
        try {
            const gameId = await createPickupGame({
                title: form.title,
                description: form.description,
                sport: form.sport,
                venueId: form.venueId,
                venueName: selectedVenue?.name || '',
                district: selectedVenue?.location || currentUser.district || '',
                lat: selectedVenue?.lat,
                lng: selectedVenue?.lng,
                scheduledStartAt: combineDateTime(form.date, form.time),
                spotsTotal: form.spotsTotal,
                creatorName: currentUser.name || '',
                creatorAvatar: currentUser.avatar || ''
            });

            showToast?.('Your game is live. Players can now find and join it.', 'success');
            onNavigate({ page: 'pickupGameDetail', params: { gameId } });
        } catch (error) {
            showToast?.(error?.message || 'Could not create the game.', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="page-content tech-page pickup-page">
            {Header ? <Header title="Host a Game" onNavigate={onNavigate} /> : null}

            <button type="button" className="pickup-back-link" onClick={onBack}>
                <i className="fas fa-arrow-left" aria-hidden="true"></i> Back
            </button>

            <form className="pickup-form surface-tier-2 fade-in" onSubmit={handleSubmit}>
                <div className="pickup-subheading">
                    <span className="section-kicker">Host</span>
                    <h2 className="section-title">Create a pickup game</h2>
                </div>

                <label className="pickup-field">
                    <span>Title</span>
                    <input
                        className="input-field"
                        type="text"
                        placeholder="Sunday morning basketball run"
                        value={form.title}
                        maxLength={80}
                        onChange={(event) => update('title', event.target.value)}
                    />
                </label>

                <label className="pickup-field">
                    <span>Description</span>
                    <textarea
                        className="input-field pickup-textarea"
                        placeholder="Casual game, all levels welcome. Bring a light and dark shirt."
                        value={form.description}
                        maxLength={400}
                        onChange={(event) => update('description', event.target.value)}
                    />
                </label>

                <div className="pickup-field-row">
                    <label className="pickup-field">
                        <span>Sport</span>
                        <select className="input-field" value={form.sport} onChange={(event) => update('sport', event.target.value)}>
                            {SPORT_OPTIONS.map((sport) => (
                                <option key={sport} value={sport}>{sport}</option>
                            ))}
                        </select>
                    </label>

                    <label className="pickup-field">
                        <span>Venue</span>
                        <select className="input-field" value={form.venueId} onChange={(event) => handleVenueChange(event.target.value)}>
                            <option value="">Select a venue</option>
                            {venues.map((venue) => (
                                <option key={venue.id} value={venue.id}>{venue.name} — {venue.location}</option>
                            ))}
                        </select>
                    </label>
                </div>

                <div className="pickup-field-row">
                    <label className="pickup-field">
                        <span>Date</span>
                        <input className="input-field" type="date" value={form.date} onChange={(event) => update('date', event.target.value)} />
                    </label>

                    <label className="pickup-field">
                        <span>Time</span>
                        <input className="input-field" type="time" value={form.time} onChange={(event) => update('time', event.target.value)} />
                    </label>

                    <label className="pickup-field">
                        <span>Total spots</span>
                        <input
                            className="input-field"
                            type="number"
                            min={MIN_PICKUP_SPOTS}
                            max={MAX_PICKUP_SPOTS}
                            value={form.spotsTotal}
                            onChange={(event) => update('spotsTotal', event.target.value)}
                        />
                    </label>
                </div>

                <button type="submit" className="btn-primary pickup-submit" disabled={submitting}>
                    {submitting ? 'Creating…' : 'Host game'}
                </button>
            </form>
        </div>
    );
};

export default HostGamePage;
