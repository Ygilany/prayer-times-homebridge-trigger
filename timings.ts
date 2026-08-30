// daily-scheduler.ts
// Simple scheduler that calls DAILY_URL to get times for today
// and triggers a HomeKit scene through Homebridge HTTP webhooks.

import 'dotenv/config';
import axios from 'axios';
import { readFileSync, writeFileSync } from 'node:fs';

// <<< CONFIGURE THESE >>>
// Configuration via environment variables (recommended) or defaults below
// Create a .env file in the project root to override these values

// API Configuration
const API_CITY = process.env.API_CITY || 'Mason';
const API_COUNTRY = process.env.API_COUNTRY || 'US';
const API_STATE = process.env.API_STATE || 'OH';
const API_METHOD = process.env.API_METHOD || '2';  // 2 = ISNA
const API_TIMEZONE = process.env.API_TIMEZONE || 'America/New_York';
const TIME_TUNE = `0,1,1,1,1,0,0,0,0`

// Coordinates are the PRIMARY lookup. Aladhan's /timingsByCity endpoint needs
// its geocoding service, which fails for days at a time with
// `503 Geocoding is temporarily unavailable` - that outage silently cost us
// several multi-week gaps in triggers. /timings takes lat+lon directly and has
// no such dependency, so we use it first and keep the city lookup as fallback.
// Defaults are Mason, OH.
const LATITUDE = process.env.LATITUDE || '39.3601';
const LONGITUDE = process.env.LONGITUDE || '-84.3099';

// Retry policy for the daily fetch. A single failed request used to cost a
// whole day of triggers, because nothing retried until the next midnight.
const FETCH_ATTEMPTS = Number(process.env.FETCH_ATTEMPTS || 6);
const FETCH_BACKOFF_MS = Number(process.env.FETCH_BACKOFF_MS || 30_000);

// Last known good times, so a total API outage degrades to "yesterday's times"
// rather than to silence. Prayer times drift about a minute a day, so this is
// a good approximation for a short outage and a safe one for a long outage.
const CACHE_FILE = process.env.CACHE_FILE || './.last-known-times.json';

// Overridable so the failure paths can be exercised against an unreachable host.
const API_BASE = process.env.ALADHAN_BASE_URL || 'https://api.aladhan.com/v1';

/**
 * Today's date as YYYY-MM-DD in LOCAL time.
 *
 * Deliberately not toISOString(), which is UTC: after ~20:00 EDT that rolls
 * over and would request tomorrow's times, then schedule them against today.
 */
function localDateString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// Endpoint that returns today's trigger times.
function getDailyUrl(): string {
  const date = localDateString();
  return `${API_BASE}/timings/${date}?latitude=${LATITUDE}&longitude=${LONGITUDE}&method=${API_METHOD}&shafaq=general&timezonestring=${API_TIMEZONE}&tune=${TIME_TUNE}`;
}

// Fallback endpoint, used only if the coordinate lookup fails.
function getFallbackUrl(): string {
  const date = localDateString();
  return `${API_BASE}/timingsByCity/${date}?city=${API_CITY}&country=${API_COUNTRY}&state=${API_STATE}&method=${API_METHOD}&shafaq=general&timezonestring=${API_TIMEZONE}&tune=${TIME_TUNE}`;
}

// Homebridge HTTP webhooks config
// For Raspberry Pi: use '127.0.0.1' or 'localhost' (both script and Homebridge on same Pi)
// For remote setup: use your Pi's IP address (e.g., '192.168.1.100')
const HOME_BRIDGE_HOST = process.env.HOME_BRIDGE_HOST || '127.0.0.1';
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 63743;  // must match webhook_port in Dummy plugin config
const ACCESSORY_ID = process.env.ACCESSORY_ID || 'dailyScene';  // must match the "id" for your pushbutton

// <<< END CONFIG >>>

// Track active timers so we can clear them when rescheduling
let activeTimers: NodeJS.Timeout[] = [];

/**
 * Clear all active prayer time timers
 */
function clearActiveTimers(): void {
  activeTimers.forEach((timerId) => clearTimeout(timerId));
  activeTimers = [];
  console.log('Cleared all active timers');
}

/**
 * Call Homebridge HTTP webhooks to "press" the Daily Scene Trigger button.
 */
async function triggerHomeKitScene(): Promise<void> {
  const url = `http://${HOME_BRIDGE_HOST}:${WEBHOOK_PORT}`;

  // Force a genuine off->on transition on every trigger, regardless of
  // whatever state the switch is already in. Homebridge's Dummy plugin only
  // fires a real HomeKit characteristic change - and only fires any HomeKit
  // automation bound to this switch - on an actual state transition. A
  // repeat "set On" call while it's already on (e.g. restored "on" after a
  // Homebridge restart, since resetOnRestart is false, with nothing having
  // turned it off since) is a silent no-op: the webhook call still succeeds,
  // but nothing toggles and any automation listening for the "on" edge never
  // fires. This isn't just a logging concern - it can silently swallow the
  // actual trigger. Turning it off first, unconditionally, guarantees a real
  // edge every time.
  try {
    await axios.post(url, { id: ACCESSORY_ID, set: 'On', value: false });
  } catch (err) {
    // Not fatal - if it was already off this may itself be a no-op, and
    // either way the real "on" call below is what actually matters.
    console.error('Warning: pre-trigger off call failed:', (err as Error).message);
  }

  // Give Homebridge/HAP a moment to settle the off state before flipping back
  // on, so the two calls don't land close enough to be coalesced into one
  // internal state change.
  await sleep(300);

  try {
    const setValue = {
      id: ACCESSORY_ID,
      set: `On`,
      value: true,
    };
    await axios.post(url, setValue);
    console.log(new Date().toISOString(), 'Triggered HomeKit scene via', url, setValue);
  } catch (err) {
    const error = err as Error;
    console.error('Error triggering HomeKit scene:', error.message);
  }
}

/**
 * Parse a "HH:mm" string into a Date object for today.
 * Returns null if invalid or already passed.
 */
function parseTimeToday(timeStr: string): Date | null {
  if (typeof timeStr !== 'string') return null;

  const parts = timeStr.split(':');
  if (parts.length < 2) return null;

  const hour = Number(parts[0]);
  const minute = Number(parts[1]);

  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const now = new Date();
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    minute,
    0,
    0
  );

  if (target.getTime() <= Date.now()) {
    return null;
  }

  return target;
}

/**
 * Schedule all the times for today.
 */
function scheduleTimes(times: string[]): void {
  // Clear any existing timers before scheduling new ones
  clearActiveTimers();

  console.log('Scheduling times for today:', times);

  times.forEach((timeStr) => {
    const target = parseTimeToday(timeStr);
    if (!target) {
      console.log('Skipping time', timeStr, '(invalid or already passed)');
      return;
    }

    const delayMs = target.getTime() - Date.now();
    const seconds = Math.round(delayMs / 1000);
    console.log(
      'Will trigger at',
      target.toString(),
      `in ~${seconds} seconds`
    );

    const timerId = setTimeout(() => {
      console.log('Time reached:', timeStr, 'Triggering scene');
      triggerHomeKitScene();
      // Remove timer from active list when it fires
      activeTimers = activeTimers.filter((id) => id !== timerId);
    }, delayMs);

    // Track the timer so we can clear it later
    activeTimers.push(timerId);
  });
}

interface PrayerTimings {
  Fajr?: string;
  Dhuhr?: string;
  Asr?: string;
  Maghrib?: string;
  Isha?: string;
  [key: string]: string | undefined;
}

interface ApiResponse {
  data?: {
    timings?: PrayerTimings;
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pull the five prayer times out of an Aladhan response.
 * Returns null if the payload is not the shape we expect.
 */
function extractTimes(payload: ApiResponse): string[] | null {
  const timings = payload?.data?.timings;
  if (!timings || typeof timings !== 'object') return null;

  const prayerNames = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;
  const times = prayerNames
    .map((name) => timings[name])
    .filter((time): time is string => time != null)
    // The API sometimes appends a zone, e.g. "05:47 (EDT)". Keep only "HH:mm".
    .map((t) => String(t).trim().split(' ')[0]);

  if (times.length === 0) return null;

  // Sanity-check the shape of the day before trusting it. Aladhan answers 200
  // with plausible-looking garbage for bad coordinates - e.g. lat/lon 999
  // returns all five prayers within a minute of each other - and silently
  // wrong times are worse than none, because nothing looks broken.
  // A real day has five strictly increasing times.
  if (times.length !== 5) {
    console.error(`Expected 5 prayer times, got ${times.length}:`, times);
    return null;
  }

  const minutes = times.map((t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  });

  if (minutes.some(Number.isNaN)) {
    console.error('Unparseable time in response:', times);
    return null;
  }

  for (let i = 1; i < minutes.length; i++) {
    if (minutes[i] <= minutes[i - 1]) {
      console.error('Prayer times are not strictly increasing:', times);
      return null;
    }
  }

  return times;
}

/** Remember today's times so an API outage can fall back to them. */
function cacheTimes(times: string[]): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify({ date: localDateString(), times }));
  } catch (err) {
    console.error('Could not write cache:', (err as Error).message);
  }
}

/** Last known good times, or null. Used only when every request has failed. */
function readCachedTimes(): { date: string; times: string[] } | null {
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    if (Array.isArray(parsed?.times) && parsed.times.length > 0) return parsed;
  } catch {
    // No cache yet, or it is unreadable - both are fine.
  }
  return null;
}

/**
 * Fetch today's times, retrying with backoff, then falling back to the city
 * endpoint, then to the last known good times.
 *
 * The old version made exactly one request and gave up. Because that request
 * only happens at midnight, one 503 cost a full day of triggers - and
 * Aladhan's geocoding has been down for days at a stretch.
 */
async function fetchTimesResilient(): Promise<string[] | null> {
  const urls = [getDailyUrl(), getFallbackUrl()];

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    for (const url of urls) {
      try {
        console.log(`Requesting times (attempt ${attempt}) from`, url);
        const response = await axios.get<ApiResponse>(url, { timeout: 20_000 });
        const times = extractTimes(response.data);
        if (times) {
          console.log('Extracted prayer times:', times);
          cacheTimes(times);
          return times;
        }
        console.error('Response had no usable timings:', response.data);
      } catch (err) {
        console.error(`  failed: ${(err as Error).message}`);
      }
    }

    if (attempt < FETCH_ATTEMPTS) {
      // Exponential backoff, capped so a long outage still retries hourly.
      const waitMs = Math.min(FETCH_BACKOFF_MS * 2 ** (attempt - 1), 60 * 60_000);
      console.log(`All endpoints failed; retrying in ${Math.round(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
  }

  const cached = readCachedTimes();
  if (cached) {
    console.error(
      `Every request failed. Falling back to cached times from ${cached.date}:`,
      cached.times
    );
    return cached.times;
  }

  console.error('Every request failed and there is no cache. No triggers today.');
  return null;
}

/**
 * Fetch today's times and schedule timers for them.
 */
async function fetchAndScheduleToday(): Promise<void> {
  const times = await fetchTimesResilient();
  if (times) scheduleTimes(times);
}

/**
 * Milliseconds until next local midnight.
 */
function msUntilNextMidnight(): number {
  const now = new Date();
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0
  );
  return next.getTime() - now.getTime();
}

// Track the midnight refresh timer
let midnightTimer: NodeJS.Timeout | null = null;

/**
 * Main loop.
 * Fetch schedule for today, then schedule a refresh at next midnight.
 */
async function start(): Promise<void> {
  try {
    await fetchAndScheduleToday();
  } catch (err) {
    // Nothing above should throw, but if it ever does, the refresh chain must
    // still survive - losing the midnight timer means silent death until
    // someone notices days later and restarts by hand.
    console.error('Unexpected error while scheduling:', (err as Error).message);
  } finally {
    const delayMs = msUntilNextMidnight();
    const minutes = Math.round(delayMs / 1000 / 60);
    console.log('Will refresh schedule at next midnight in ~', minutes, 'minutes');

    if (midnightTimer) {
      clearTimeout(midnightTimer);
    }

    midnightTimer = setTimeout(() => {
      midnightTimer = null;
      // Re-entering an async function from a timer: catch here too, or a
      // rejection becomes an unhandled rejection and the chain stops.
      start().catch((err) => {
        console.error('Midnight refresh failed:', (err as Error).message);
      });
    }, delayMs);
  }
}

/**
 * Belt-and-braces: prove periodically that the scheduler still has work queued.
 *
 * Every observed outage looked identical from outside - process alive, zero
 * triggers, no output. Whatever the cause, if the midnight timer is gone we
 * can detect that and rebuild it rather than idling until someone notices.
 */
function startWatchdog(): void {
  const INTERVAL_MS = 15 * 60_000;

  setInterval(() => {
    const pending = activeTimers.length;
    console.log(
      `[watchdog] ${new Date().toISOString()} midnightTimer=${midnightTimer ? 'set' : 'MISSING'} pendingTriggers=${pending}`
    );

    if (!midnightTimer) {
      console.error('[watchdog] midnight timer missing - restarting the schedule');
      start().catch((err) => {
        console.error('[watchdog] restart failed:', (err as Error).message);
      });
    }
  }, INTERVAL_MS).unref?.();
}

// If something does go irrecoverably wrong, crash loudly. pm2 restarts a dead
// process; it cannot do anything about a live one that has stopped working,
// which is exactly how this failed before.
process.on('unhandledRejection', (reason) => {
  console.error('FATAL unhandledRejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('FATAL uncaughtException:', err);
  process.exit(1);
});

// Graceful shutdown handler for pm2 restarts
function cleanup(): void {
  console.log('Cleaning up timers before shutdown...');
  clearActiveTimers();
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
  }
}

// Handle process termination signals (pm2 restart, stop, etc.)
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  cleanup();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  cleanup();
  process.exit(0);
});

// Start the scheduler
start().catch((err) => {
  console.error('Initial start failed:', (err as Error).message);
  process.exit(1);
});
startWatchdog();

