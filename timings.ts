// daily-scheduler.ts
// Simple scheduler that calls DAILY_URL to get times for today
// and triggers a HomeKit scene through Homebridge HTTP webhooks.

import 'dotenv/config';
import axios from 'axios';

// <<< CONFIGURE THESE >>>
// Configuration via environment variables (recommended) or defaults below
// Create a .env file in the project root to override these values

// API Configuration
const API_CITY = process.env.API_CITY || 'Mason';
const API_COUNTRY = process.env.API_COUNTRY || 'US';
const API_STATE = process.env.API_STATE || 'Ohio';
const API_METHOD = process.env.API_METHOD || '2';  // 2 = ISNA
const API_TIMEZONE = process.env.API_TIMEZONE || 'EST';

// Endpoint that returns today's trigger times
function getDailyUrl(): string {
  const date = new Date().toISOString().split('T')[0];
  return `https://api.aladhan.com/v1/timingsByCity/${date}?city=${encodeURIComponent(API_CITY)}&country=${encodeURIComponent(API_COUNTRY)}&state=${encodeURIComponent(API_STATE)}&method=${API_METHOD}&shafaq=general&timezonestring=${encodeURIComponent(API_TIMEZONE)}`;
}

// Homebridge HTTP webhooks config
// For Raspberry Pi: use '127.0.0.1' or 'localhost' (both script and Homebridge on same Pi)
// For remote setup: use your Pi's IP address (e.g., '192.168.1.100')
const HOME_BRIDGE_HOST = process.env.HOME_BRIDGE_HOST || '127.0.0.1';
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 51828;  // must match webhook_port in HttpWebHooks config
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
  const url = `http://${HOME_BRIDGE_HOST}:${WEBHOOK_PORT}/?accessoryId=${encodeURIComponent(
    ACCESSORY_ID
  )}&state=true`;

  try {
    await axios.get(url);
    console.log(new Date().toISOString(), 'Triggered HomeKit scene via', url);
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

/**
 * Call the DAILY_URL and schedule timers based on response.
 */
async function fetchAndScheduleToday(): Promise<void> {
  try {
    const dailyUrl = getDailyUrl();
    console.log('Requesting times from', dailyUrl);
    const response = await axios.get<ApiResponse>(dailyUrl);

    // Extract prayer timings from API response
    const timings = response.data?.data?.timings;
    if (!timings || typeof timings !== 'object') {
      console.error('API did not return timings object:', response.data);
      return;
    }

    // Extract the five required prayer times
    const prayerNames = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;
    const times = prayerNames
      .map((name) => timings[name])
      .filter((time): time is string => time != null) // Remove any missing times
      .map((t) => String(t)); // Normalize to strings

    if (times.length === 0) {
      console.error('No valid prayer times found in response:', timings);
      return;
    }

    console.log('Extracted prayer times:', times);
    scheduleTimes(times);
  } catch (err) {
    const error = err as Error;
    console.error('Error fetching daily times:', error.message);
  }
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
  await fetchAndScheduleToday();

  const delayMs = msUntilNextMidnight();
  const minutes = Math.round(delayMs / 1000 / 60);
  console.log('Will refresh schedule at next midnight in ~', minutes, 'minutes');

  // Clear previous midnight timer if it exists
  if (midnightTimer) {
    clearTimeout(midnightTimer);
  }

  midnightTimer = setTimeout(() => {
    midnightTimer = null;
    start();
  }, delayMs);
}

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
start();

