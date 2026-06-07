import * as admin from "firebase-admin";
import {HttpsError, onCall, onRequest} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {defineSecret} from "firebase-functions/params";

admin.initializeApp();

const db = admin.firestore();
const BOOKING_SLOTS_COLLECTION = "bookingSlots";
const BOOKING_LEADERBOARDS_COLLECTION = "bookingLeaderboards";
const BOOKING_DISTRICT_METRICS_COLLECTION = "bookingDistrictMetrics";
const BOOKING_PRESETS_COLLECTION = "bookingPresets";
const VENUE_WEATHER_CACHE_COLLECTION = "venueWeatherCache";
const OPENWEATHER_API_KEY = defineSecret("OPENWEATHER_API_KEY");
const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000;

const SPORT_BOOKING_PRESETS: Record<string, { targetGroupSize: number; minViableGroup: number; courtCount: number; durationMinutes: number }> = {
  "Tennis": {targetGroupSize: 4, minViableGroup: 2, courtCount: 4, durationMinutes: 90},
  "Badminton": {targetGroupSize: 4, minViableGroup: 2, courtCount: 5, durationMinutes: 90},
  "Basketball": {targetGroupSize: 10, minViableGroup: 6, courtCount: 2, durationMinutes: 90},
  "Football": {targetGroupSize: 14, minViableGroup: 10, courtCount: 1, durationMinutes: 90},
  "Swimming": {targetGroupSize: 6, minViableGroup: 2, courtCount: 4, durationMinutes: 60},
  "Rugby": {targetGroupSize: 14, minViableGroup: 10, courtCount: 1, durationMinutes: 90},
  "Volleyball": {targetGroupSize: 12, minViableGroup: 8, courtCount: 2, durationMinutes: 90},
  "Athletics": {targetGroupSize: 8, minViableGroup: 4, courtCount: 3, durationMinutes: 60},
  "Running": {targetGroupSize: 8, minViableGroup: 3, courtCount: 3, durationMinutes: 60},
  "Cycling": {targetGroupSize: 8, minViableGroup: 4, courtCount: 2, durationMinutes: 90},
  "Golf": {targetGroupSize: 4, minViableGroup: 2, courtCount: 4, durationMinutes: 90},
  "Horse Racing": {targetGroupSize: 8, minViableGroup: 4, courtCount: 2, durationMinutes: 120},
  "Multi-sport": {targetGroupSize: 6, minViableGroup: 3, courtCount: 3, durationMinutes: 90},
  "Hiking": {targetGroupSize: 8, minViableGroup: 3, courtCount: 3, durationMinutes: 120},
};

type SlotDocument = {
	id?: string;
	district?: string;
	venueId?: string;
	venueName?: string;
	courtLabel?: string;
	courtId?: string;
	courtIndex?: number;
	sport?: string;
	date?: string;
	time?: string;
	timeBucket?: string;
	weekKey?: string;
	participantIds?: string[];
	participants?: ParticipantSnapshot[];
	waitlistIds?: string[];
	waitlist?: ParticipantSnapshot[];
	targetGroupSize?: number;
	minViableGroup?: number;
	presetDemandScore?: number;
	status?: string;
	lastJoinedBy?: string;
	source?: string;
};

type ParticipantSnapshot = {
	id: string;
	name?: string;
	avatar?: string;
	district?: string;
	mmr?: number;
	reliabilityScore?: number;
	friends?: string[];
};

type VenuePayload = {
	id?: string;
	name?: string;
	location?: string;
	sport?: string;
};

type ReserveLiveBookingRequest = {
	venue?: VenuePayload;
	date?: string;
	time?: string;
	strategy?: "smart" | "join-random";
	selectedPlayerIds?: string[];
	currentUser?: ParticipantSnapshot;
	selectedPlayers?: ParticipantSnapshot[];
};

const LIVE_BOOKING_ALLOWED_ORIGINS = new Set([
  "https://goplayhk.web.app",
  "https://goplayhk.firebaseapp.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
]);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const average = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
};

const getWeekKey = (dateValue?: string): string => {
  const date = new Date(dateValue || Date.now());
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return `${utcDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
};

const normalizeDate = (dateValue = ""): string => dateValue.slice(0, 10);

const getTimeBucket = (time = ""): string => {
  const hour = Number.parseInt((time || "").split(":")[0], 10);

  if (Number.isNaN(hour)) {
    return "evening";
  }

  if (hour < 12) {
    return "morning";
  }

  if (hour < 15) {
    return "lunch";
  }

  if (hour < 20) {
    return "evening";
  }

  return "late";
};

const buildSlotId = ({venueId, date, time, courtIndex}: {venueId: string; date: string; time: string; courtIndex: number}): string => `${venueId}_${normalizeDate(date)}_${time}_${courtIndex}`;

const getSportPreset = (sport = "") => SPORT_BOOKING_PRESETS[sport] || SPORT_BOOKING_PRESETS.Tennis;

const buildParticipantSnapshot = (participant?: ParticipantSnapshot | null): ParticipantSnapshot => ({
  id: String(participant?.id || ""),
  name: participant?.name || "Player",
  avatar: participant?.avatar || "",
  district: participant?.district || "",
  mmr: participant?.mmr || 1500,
  reliabilityScore: clamp(participant?.reliabilityScore || 0.62, 0.3, 0.98),
  friends: participant?.friends || [],
});

const createSyntheticSlot = ({venue, date, time, courtIndex}: {venue: VenuePayload; date: string; time: string; courtIndex: number}): SlotDocument => {
  const preset = getSportPreset(venue.sport || "");

  return {
    venueId: venue.id || "",
    venueName: venue.name || "Venue",
    district: venue.location || "",
    sport: venue.sport || "Sport",
    date: normalizeDate(date),
    time,
    timeBucket: getTimeBucket(time),
    courtId: `${venue.id || "venue"}-court-${courtIndex}`,
    courtLabel: `Court ${courtIndex}`,
    courtIndex,
    targetGroupSize: preset.targetGroupSize,
    minViableGroup: preset.minViableGroup,
    participantIds: [],
    participants: [],
    waitlistIds: [],
    waitlist: [],
    status: "open",
    weekKey: getWeekKey(date),
    presetDemandScore: 0.5,
    source: "preset",
  };
};

const selectCandidateSlot = (slots: SlotDocument[], strategy: "smart" | "join-random" = "smart"): SlotDocument | null => {
  const openSlots = slots.filter((slot) => (slot.participantIds?.length || 0) < (slot.targetGroupSize || 4));
  if (!openSlots.length) {
    return null;
  }

  const rankedSlots = openSlots.sort((firstSlot, secondSlot) => {
    const firstCount = firstSlot.participantIds?.length || 0;
    const secondCount = secondSlot.participantIds?.length || 0;
    const firstJoinable = firstCount > 0 && firstCount < (firstSlot.targetGroupSize || 4);
    const secondJoinable = secondCount > 0 && secondCount < (secondSlot.targetGroupSize || 4);

    if (strategy === "join-random" && firstJoinable !== secondJoinable) {
      return Number(secondJoinable) - Number(firstJoinable);
    }

    if (firstJoinable !== secondJoinable) {
      return Number(secondJoinable) - Number(firstJoinable);
    }

    return secondCount - firstCount;
  });

  return rankedSlots[0] || null;
};

const refreshDistrictLeaderboard = async (district: string, date: string): Promise<void> => {
  const weekKey = getWeekKey(date);
  const snapshot = await db.collection(BOOKING_SLOTS_COLLECTION).where("district", "==", district).get();
  const slots = snapshot.docs
    .map((documentSnapshot) => documentSnapshot.data() as SlotDocument)
    .filter((slot) => (slot.weekKey || getWeekKey(slot.date)) === weekKey);
  const entries = buildLeaderboardEntries(slots);
  const averageOccupancy = average(slots.map((slot) => {
    const participantCount = slot.participantIds?.length || 0;
    const targetGroupSize = slot.targetGroupSize || 4;
    return participantCount / Math.max(targetGroupSize, 1);
  }));

  await Promise.all([
    db.collection(BOOKING_LEADERBOARDS_COLLECTION).doc(`${district}__${weekKey}`).set({
      district,
      weekKey,
      entries,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true}),
    db.collection(BOOKING_DISTRICT_METRICS_COLLECTION).doc(`${district}__${weekKey}`).set({
      district,
      weekKey,
      totalTrackedSlots: slots.length,
      averageOccupancy,
      joinRandomEligibleCount: slots.filter((slot) => {
        const participantCount = slot.participantIds?.length || 0;
        const targetGroupSize = slot.targetGroupSize || 4;
        return participantCount > 0 && participantCount < targetGroupSize;
      }).length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true}),
  ]);
};

const toWeatherCachePayload = (payload: any) => ({
  description: payload?.weather?.[0]?.description || "Current weather unavailable",
  icon: payload?.weather?.[0]?.icon || "",
  temp: typeof payload?.main?.temp === "number" ? Math.round(payload.main.temp * 10) / 10 : null,
  feelsLike: typeof payload?.main?.feels_like === "number" ? Math.round(payload.main.feels_like * 10) / 10 : null,
  humidity: typeof payload?.main?.humidity === "number" ? payload.main.humidity : null,
  windSpeed: typeof payload?.wind?.speed === "number" ? payload.wind.speed : null,
  source: "openweather",
});

const buildLeaderboardEntries = (slots: SlotDocument[]) => slots
  .map((slot) => {
    const participantCount = slot.participantIds?.length || 0;
    const targetGroupSize = slot.targetGroupSize || 4;
    const occupancyRatio = clamp(participantCount / Math.max(targetGroupSize, 1), 0, 1);
    const presetDemandScore = slot.presetDemandScore || 0.5;
    const probabilityScore = Math.round(clamp(((presetDemandScore * 0.52) + ((1 - occupancyRatio) * 0.3) + (occupancyRatio > 0 ? 0.18 : 0.08)) * 100, 18, 96));
    const offPeakOpportunityScore = Math.round(clamp((((1 - presetDemandScore) * 0.62) + ((1 - occupancyRatio) * 0.38)) * 100, 6, 98));

    return {
      slotId: `${slot.venueId || "venue"}_${slot.date || ""}_${slot.time || ""}_${slot.courtLabel || "court"}`,
      venueId: slot.venueId || "",
      venueName: slot.venueName || "Venue",
      courtLabel: slot.courtLabel || "Court",
      sport: slot.sport || "Sport",
      date: slot.date || "",
      time: slot.time || "",
      currentParticipantCount: participantCount,
      targetGroupSize,
      probabilityScore,
      offPeakOpportunityScore,
      reasons: offPeakOpportunityScore >= 70 ? ["low current demand", "good spare capacity"] : ["balanced demand"],
    };
  })
  .sort((firstEntry, secondEntry) => {
    if (firstEntry.offPeakOpportunityScore !== secondEntry.offPeakOpportunityScore) {
      return secondEntry.offPeakOpportunityScore - firstEntry.offPeakOpportunityScore;
    }

    return secondEntry.probabilityScore - firstEntry.probabilityScore;
  })
  .slice(0, 10);

const resolveCorsOrigin = (originHeader?: string): string => {
  if (!originHeader) {
    return "";
  }

  return LIVE_BOOKING_ALLOWED_ORIGINS.has(originHeader) ? originHeader : "";
};

const applyCorsHeaders = (response: any, originHeader?: string): void => {
  const allowedOrigin = resolveCorsOrigin(originHeader);

  if (!allowedOrigin) {
    return;
  }

  response.set("Access-Control-Allow-Origin", allowedOrigin);
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Firebase-AppCheck");
  response.set("Access-Control-Max-Age", "3600");
  response.set("Vary", "Origin");
};

const extractBearerToken = (authorizationHeader = ""): string => {
  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    throw new HttpsError("unauthenticated", "A valid Firebase ID token is required.");
  }

  return token;
};

const toHttpStatus = (error: unknown): number => {
  if (!(error instanceof HttpsError)) {
    return 500;
  }

  switch (error.code) {
  case "invalid-argument":
    return 400;
  case "unauthenticated":
    return 401;
  case "permission-denied":
    return 403;
  case "not-found":
    return 404;
  case "resource-exhausted":
    return 429;
  default:
    return 500;
  }
};

const reserveLiveBookingSlotInternal = async ({
  authUid,
  payload,
}: {
  authUid: string;
  payload: ReserveLiveBookingRequest;
}) => {
  const venue = payload?.venue;
  const date = normalizeDate(String(payload?.date || ""));
  const time = String(payload?.time || "").trim();
  const strategy = payload?.strategy === "join-random" ? "join-random" : "smart";
  const selectedPlayerIds = Array.from(new Set((payload?.selectedPlayerIds || []).filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))).slice(0, 7);
  const currentUser = buildParticipantSnapshot({
    ...payload?.currentUser,
    id: authUid,
  });
  const selectedPlayersById = new Map(
    (payload?.selectedPlayers || [])
      .filter((participant) => participant?.id)
      .map((participant) => [participant.id, buildParticipantSnapshot(participant)])
  );

  if (!venue?.id || !venue?.sport || !venue?.location || !date || !time) {
    throw new HttpsError("invalid-argument", "Venue, date, and time are required to reserve a live slot.");
  }

  const preset = getSportPreset(venue.sport);
  const slotRefs = Array.from({length: preset.courtCount}, (_, index) => {
    const slotId = buildSlotId({venueId: venue.id || "venue", date, time, courtIndex: index + 1});
    return db.collection(BOOKING_SLOTS_COLLECTION).doc(slotId);
  });

  const allocation = await db.runTransaction(async (transaction) => {
    const slots: SlotDocument[] = [];

    for (let index = 0; index < slotRefs.length; index += 1) {
      const slotRef = slotRefs[index];
      const slotSnapshot = await transaction.get(slotRef);

      if (!slotSnapshot.exists) {
        const syntheticSlot = createSyntheticSlot({venue, date, time, courtIndex: index + 1});
        transaction.set(slotRef, {
          ...syntheticSlot,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        slots.push({id: slotRef.id, ...syntheticSlot});
        continue;
      }

      slots.push({id: slotSnapshot.id, ...(slotSnapshot.data() as SlotDocument)});
    }

    const candidate = selectCandidateSlot(slots, strategy);
    if (!candidate?.id) {
      throw new HttpsError("resource-exhausted", "No capacity is available for that booking window.");
    }

    const slotRef = db.collection(BOOKING_SLOTS_COLLECTION).doc(candidate.id);
    const currentSlotSnapshot = await transaction.get(slotRef);
    const slot = currentSlotSnapshot.exists ? ({id: currentSlotSnapshot.id, ...(currentSlotSnapshot.data() as SlotDocument)}) : {id: candidate.id, ...candidate};
    const existingParticipantIds = slot.participantIds || [];
    const usersToAdd = Array.from(new Set([authUid, ...selectedPlayerIds]));
    const targetGroupSize = slot.targetGroupSize || preset.targetGroupSize;
    const nextParticipantIds = [...existingParticipantIds];
    const nextParticipants = [...(slot.participants || [])];

    usersToAdd.forEach((userId) => {
      if (nextParticipantIds.includes(userId)) {
        return;
      }

      nextParticipantIds.push(userId);
      nextParticipants.push(userId === authUid ? currentUser : (selectedPlayersById.get(userId) || buildParticipantSnapshot({id: userId})));
    });

    if (nextParticipantIds.length > targetGroupSize) {
      const nextWaitlistIds = Array.from(new Set([...(slot.waitlistIds || []), authUid]));
      const nextWaitlist = [...(slot.waitlist || [])];

      if (!nextWaitlist.some((participant) => participant.id === authUid)) {
        nextWaitlist.push(currentUser);
      }

      transaction.set(slotRef, {
        waitlistIds: nextWaitlistIds,
        waitlist: nextWaitlist,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      return {
        slotId: slot.id,
        status: "waitlisted",
        slot: {
          ...slot,
          waitlistIds: nextWaitlistIds,
          waitlist: nextWaitlist,
        },
      };
    }

    transaction.set(slotRef, {
      participantIds: nextParticipantIds,
      participants: nextParticipants,
      currentParticipantCount: nextParticipantIds.length,
      status: nextParticipantIds.length >= targetGroupSize ? "filled" : "open",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastJoinedBy: authUid,
      source: "live",
    }, {merge: true});

    return {
      slotId: slot.id,
      status: "reserved",
      slot: {
        ...slot,
        participantIds: nextParticipantIds,
        participants: nextParticipants,
        currentParticipantCount: nextParticipantIds.length,
        targetGroupSize,
        status: nextParticipantIds.length >= targetGroupSize ? "filled" : "open",
        lastJoinedBy: authUid,
        source: "live",
      },
    };
  });

  await refreshDistrictLeaderboard(venue.location, date);
  return allocation;
};

export const seedBookingPresets = onCall({region: "asia-southeast1"}, async () => {
  await db.collection(BOOKING_PRESETS_COLLECTION).doc("catalog").set({
    sportRules: SPORT_BOOKING_PRESETS,
    version: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return {
    ok: true,
    sports: Object.keys(SPORT_BOOKING_PRESETS).length,
  };
});

export const rebuildWeeklyBookingLeaderboards = onSchedule({
  region: "asia-southeast1",
  schedule: "every 24 hours",
  timeZone: "Asia/Hong_Kong",
}, async () => {
  const snapshot = await db.collection(BOOKING_SLOTS_COLLECTION).get();
  const slots = snapshot.docs.map((documentSnapshot) => documentSnapshot.data() as SlotDocument);
  const groupedByDistrict = new Map<string, SlotDocument[]>();

  slots.forEach((slot) => {
    if (!slot.district) {
      return;
    }

    const existingSlots = groupedByDistrict.get(slot.district) || [];
    existingSlots.push(slot);
    groupedByDistrict.set(slot.district, existingSlots);
  });

  const writes: Promise<FirebaseFirestore.WriteResult>[] = [];
  groupedByDistrict.forEach((districtSlots, district) => {
    const weekKey = getWeekKey(districtSlots[0]?.date);
    const relevantSlots = districtSlots.filter((slot) => (slot.weekKey || getWeekKey(slot.date)) === weekKey);
    const entries = buildLeaderboardEntries(relevantSlots);
    const averageOccupancy = average(relevantSlots.map((slot) => {
      const participantCount = slot.participantIds?.length || 0;
      const targetGroupSize = slot.targetGroupSize || 4;
      return participantCount / Math.max(targetGroupSize, 1);
    }));

    writes.push(db.collection(BOOKING_LEADERBOARDS_COLLECTION).doc(`${district}__${weekKey}`).set({
      district,
      weekKey,
      entries,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true}));
    writes.push(db.collection(BOOKING_DISTRICT_METRICS_COLLECTION).doc(`${district}__${weekKey}`).set({
      district,
      weekKey,
      totalTrackedSlots: relevantSlots.length,
      averageOccupancy,
      joinRandomEligibleCount: relevantSlots.filter((slot) => {
        const participantCount = slot.participantIds?.length || 0;
        const targetGroupSize = slot.targetGroupSize || 4;
        return participantCount > 0 && participantCount < targetGroupSize;
      }).length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true}));
  });

  await Promise.all(writes);
});

export const reserveLiveBookingSlot = onCall({region: "asia-southeast1"}, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to reserve a live booking slot.");
  }
  return reserveLiveBookingSlotInternal({
    authUid: request.auth.uid,
    payload: request.data as ReserveLiveBookingRequest,
  });
});

export const reserveLiveBookingSlotHttp = onRequest({region: "asia-southeast1"}, async (request, response) => {
  applyCorsHeaders(response, String(request.headers.origin || ""));

  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({error: "Only POST is supported for live booking reservations."});
    return;
  }

  try {
    const token = extractBearerToken(String(request.headers.authorization || ""));
    const decodedToken = await admin.auth().verifyIdToken(token);
    const allocation = await reserveLiveBookingSlotInternal({
      authUid: decodedToken.uid,
      payload: request.body as ReserveLiveBookingRequest,
    });

    response.status(200).json(allocation);
  } catch (error) {
    const status = toHttpStatus(error);
    const message = error instanceof HttpsError ? error.message : "Live booking could not be completed.";
    response.status(status).json({error: message});
  }
});

export const getVenueWeather = onCall({region: "asia-southeast1", secrets: [OPENWEATHER_API_KEY]}, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to load venue weather.");
  }

  const venueId = String(request.data?.venueId || "").trim();
  const lat = Number(request.data?.lat);
  const lon = Number(request.data?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new HttpsError("invalid-argument", "Valid latitude and longitude are required.");
  }

  const cacheId = venueId || `weather_${lat.toFixed(3)}_${lon.toFixed(3)}`;
  const cacheRef = db.collection(VENUE_WEATHER_CACHE_COLLECTION).doc(cacheId);
  const cacheSnapshot = await cacheRef.get();
  const cacheData = cacheSnapshot.data();
  const cachedAt = cacheData?.updatedAt?.toMillis?.() || 0;

  if (cacheSnapshot.exists && cachedAt > Date.now() - WEATHER_CACHE_TTL_MS && cacheData?.weather) {
    return cacheData.weather;
  }

  const apiKey = OPENWEATHER_API_KEY.value();
  const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`);
  if (!response.ok) {
    throw new HttpsError("internal", `OpenWeather request failed with status ${response.status}.`);
  }

  const weather = toWeatherCachePayload(await response.json());
  await cacheRef.set({
    venueId,
    lat,
    lon,
    weather,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return weather;
});
