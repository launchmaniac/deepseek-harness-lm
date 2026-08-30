/** Server-side GoHighLevel calendar client for the Top Cuts location. */

const DEFAULT_BASE_URL = 'https://services.leadconnectorhq.com';
const DEFAULT_VERSION = 'v3';

/** Error returned when GoHighLevel rejects or cannot complete a request. */
export class GhlApiError extends Error {
  /**
   * @param {string} message - Safe operator-facing failure description.
   * @param {number} upstreamStatus - HTTP status returned by GoHighLevel.
   */
  constructor(message, upstreamStatus) {
    super(message);
    this.name = 'GhlApiError';
    this.upstreamStatus = upstreamStatus;
  }
}

function requireValue(value, name) {
  if (!String(value || '').trim()) throw new Error(`${name} is required for GHL booking.`);
  return String(value).trim();
}

function jsonValue(payload, key) {
  return payload?.[key] ?? payload?.data?.[key];
}

function safeErrorMessage(payload, status) {
  const message = payload?.message || payload?.error || payload?.data?.message;
  return typeof message === 'string' && message.trim()
    ? `GHL request failed (${status}): ${message.trim()}`
    : `GHL request failed (${status}).`;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ''));
}

function toE164(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return undefined;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function contactNameFields(name) {
  const [firstName, ...rest] = String(name || '').trim().split(/\s+/);
  return compactObject({ firstName, lastName: rest.join(' ') });
}

/**
 * Return wall-clock date and time fields for an instant in an IANA timezone.
 *
 * @param {string | number | Date} instant - Date-compatible instant.
 * @param {string} timezone - IANA timezone name.
 * @returns {{ date: string, time: string, hour: number, minute: number }} Local fields.
 */
export function partsInTimeZone(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${fields.year}-${fields.month}-${fields.day}`,
    time: `${fields.hour}:${fields.minute}`,
    hour: Number(fields.hour),
    minute: Number(fields.minute),
  };
}

/**
 * Convert a local wall-clock value in an IANA timezone to an ISO instant.
 *
 * @param {string} date - Local date in YYYY-MM-DD form.
 * @param {string} time - Local time in HH:MM form.
 * @param {string} timezone - IANA timezone name.
 * @returns {string} UTC ISO timestamp for the local value.
 */
export function zonedDateTimeToIso(date, time, timezone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let pass = 0; pass < 3; pass += 1) {
    const local = partsInTimeZone(guess, timezone);
    const observed = Date.UTC(
      Number(local.date.slice(0, 4)),
      Number(local.date.slice(5, 7)) - 1,
      Number(local.date.slice(8, 10)),
      local.hour,
      local.minute,
    );
    guess += target - observed;
  }
  return new Date(guess).toISOString();
}

/**
 * Build an authenticated GHL client for the configured Top Cuts calendars.
 *
 * @param {object} options - Client configuration.
 * @param {string} options.token - Private Integration token.
 * @param {string} options.locationId - GHL sub-account location id.
 * @param {Record<string, string>} options.calendarIds - Local chair id to GHL calendar id.
 * @param {string} [options.baseUrl] - GHL API origin or a compatible test server.
 * @param {string} [options.version] - GHL API version header.
 * @param {typeof fetch} [options.fetchImpl] - Fetch implementation.
 * @returns {object} Calendar and contact operations.
 */
export function createGhlClient({
  token,
  locationId,
  calendarIds,
  baseUrl = DEFAULT_BASE_URL,
  version = DEFAULT_VERSION,
  fetchImpl = globalThis.fetch,
}) {
  const resolvedToken = requireValue(token, 'GHL_API_TOKEN');
  const resolvedLocationId = requireValue(locationId, 'GHL_LOCATION_ID');
  const calendars = Object.fromEntries(
    Object.entries(calendarIds || {}).map(([chairId, calendarId]) => [chairId, requireValue(calendarId, `GHL calendar for ${chairId}`)]),
  );
  if (!Object.keys(calendars).length) throw new Error('At least one GHL chair calendar is required.');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required for GHL booking.');

  async function request(pathname, { method = 'GET', query, body } = {}) {
    const url = new URL(pathname, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: compactObject({
          Accept: 'application/json',
          Authorization: `Bearer ${resolvedToken}`,
          Version: version,
          'Content-Type': body === undefined ? undefined : 'application/json',
        }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new GhlApiError('Could not reach GHL. Please try again.', 0);
    }
    let payload = {};
    try {
      payload = await response.json();
    } catch {
      // Some GHL failures return an empty or non-JSON body.
    }
    if (!response.ok) throw new GhlApiError(safeErrorMessage(payload, response.status), response.status);
    return payload;
  }

  function calendarIdForChair(chairId) {
    const calendarId = calendars[chairId];
    if (!calendarId) throw new Error(`No GHL calendar is configured for stylist ${chairId}.`);
    return calendarId;
  }

  function chairIdForCalendar(calendarId) {
    return Object.entries(calendars).find(([, id]) => id === calendarId)?.[0] || null;
  }

  return {
    locationId: resolvedLocationId,
    calendarIds: Object.freeze({ ...calendars }),
    calendarIdForChair,
    chairIdForCalendar,

    /** Verify that every configured calendar exists in the Top Cuts location. */
    async verifyCalendars() {
      await Promise.all(Object.values(calendars).map(async (calendarId) => {
        const payload = await request(`calendars/${encodeURIComponent(calendarId)}`);
        const calendar = jsonValue(payload, 'calendar');
        if (!calendar || calendar.locationId !== resolvedLocationId) {
          throw new Error(`GHL calendar ${calendarId} does not belong to location ${resolvedLocationId}.`);
        }
      }));
    },

    /** Read all events for one chair calendar between epoch-millisecond bounds. */
    async listCalendarEvents({ calendarId, startMs, endMs }) {
      const payload = await request('calendars/events', {
        query: {
          locationId: resolvedLocationId,
          calendarId,
          startTime: startMs,
          endTime: endMs,
        },
      });
      return jsonValue(payload, 'events') || [];
    },

    /** Create or update a customer contact using the location's duplicate policy. */
    async upsertContact({ name, phone, email, source }) {
      const payload = await request('contacts/upsert', {
        method: 'POST',
        body: compactObject({
          name,
          phone: toE164(phone),
          email,
          locationId: resolvedLocationId,
          source,
          country: 'US',
        }),
      });
      const contact = jsonValue(payload, 'contact');
      if (!contact?.id) throw new GhlApiError('GHL did not return a contact id.', 502);
      return contact;
    },

    /** Create a contact when a walk-in supplies no phone or email. */
    async createContact({ name, source }) {
      const payload = await request('contacts/', {
        method: 'POST',
        body: {
          ...contactNameFields(name),
          locationId: resolvedLocationId,
          source,
          country: 'US',
        },
      });
      const contact = jsonValue(payload, 'contact');
      if (!contact?.id) throw new GhlApiError('GHL did not return a contact id.', 502);
      return contact;
    },

    /** Create a confirmed appointment without triggering email or SMS automation. */
    async createAppointment({ calendarId, contactId, title, description, address, startTime, endTime }) {
      const payload = await request('calendars/events/appointments', {
        method: 'POST',
        body: {
          calendarId,
          locationId: resolvedLocationId,
          contactId,
          title,
          description,
          address,
          meetingLocationType: 'custom',
          overrideLocationConfig: true,
          appointmentStatus: 'confirmed',
          startTime,
          endTime,
          ignoreDateRange: false,
          ignoreFreeSlotValidation: true,
          toNotify: false,
        },
      });
      const event = jsonValue(payload, 'event') || jsonValue(payload, 'appointment') || payload;
      if (!event?.id) throw new GhlApiError('GHL did not return an appointment id.', 502);
      return event;
    },

    /** Mark a GHL appointment cancelled without triggering notifications. */
    async cancelAppointment(eventId) {
      const payload = await request(`calendars/events/appointments/${encodeURIComponent(eventId)}`, {
        method: 'PUT',
        body: { appointmentStatus: 'cancelled', toNotify: false },
      });
      return jsonValue(payload, 'event') || jsonValue(payload, 'appointment') || payload;
    },
  };
}

/**
 * Build the production client from environment variables.
 *
 * @param {NodeJS.ProcessEnv} env - Process environment.
 * @param {typeof fetch} [fetchImpl] - Fetch implementation.
 * @returns {ReturnType<typeof createGhlClient>} Configured client.
 */
export function createGhlClientFromEnv(env, fetchImpl = globalThis.fetch) {
  return createGhlClient({
    token: env.GHL_API_TOKEN,
    locationId: env.GHL_LOCATION_ID || 'x61zv3OlHwut6K4jZqJ3',
    calendarIds: {
      'chair-1': env.GHL_CALENDAR_CHAIR_1_ID,
      'chair-2': env.GHL_CALENDAR_CHAIR_2_ID,
    },
    baseUrl: env.GHL_API_BASE_URL || DEFAULT_BASE_URL,
    version: env.GHL_API_VERSION || DEFAULT_VERSION,
    fetchImpl,
  });
}
