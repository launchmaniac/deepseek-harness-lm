import assert from 'node:assert/strict';
import test from 'node:test';
import { createGhlClient, GhlApiError, partsInTimeZone, zonedDateTimeToIso } from '../ghl.js';

const LOCATION_ID = 'location-1';
const CALENDARS = { 'chair-1': 'calendar-1', 'chair-2': 'calendar-2' };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('converts Pacific wall-clock values across daylight-saving changes', () => {
  assert.equal(zonedDateTimeToIso('2026-08-30', '10:00', 'America/Los_Angeles'), '2026-08-30T17:00:00.000Z');
  assert.equal(zonedDateTimeToIso('2026-12-30', '10:00', 'America/Los_Angeles'), '2026-12-30T18:00:00.000Z');
  assert.deepEqual(partsInTimeZone('2026-08-30T17:15:00.000Z', 'America/Los_Angeles'), {
    date: '2026-08-30',
    time: '10:15',
    hour: 10,
    minute: 15,
  });
});

test('reads calendar events with scoped GHL authentication', async () => {
  const calls = [];
  const client = createGhlClient({
    token: 'private-token',
    locationId: LOCATION_ID,
    calendarIds: CALENDARS,
    baseUrl: 'https://ghl.test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ events: [{ id: 'event-1' }] });
    },
  });

  const events = await client.listCalendarEvents({ calendarId: 'calendar-1', startMs: 1000, endMs: 2000 });

  assert.deepEqual(events, [{ id: 'event-1' }]);
  assert.equal(calls[0].url.pathname, '/calendars/events');
  assert.equal(calls[0].url.searchParams.get('locationId'), LOCATION_ID);
  assert.equal(calls[0].url.searchParams.get('calendarId'), 'calendar-1');
  assert.equal(calls[0].url.searchParams.get('startTime'), '1000');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer private-token');
  assert.equal(calls[0].options.headers.Version, 'v3');
});

test('upserts a contact and creates an appointment with notifications disabled', async () => {
  const calls = [];
  const client = createGhlClient({
    token: 'private-token',
    locationId: LOCATION_ID,
    calendarIds: CALENDARS,
    baseUrl: 'https://ghl.test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.pathname === '/contacts/upsert') return jsonResponse({ contact: { id: 'contact-1' } });
      return jsonResponse({ id: 'event-1' });
    },
  });

  const contact = await client.upsertContact({
    name: 'Demo Customer',
    phone: '2535550123',
    email: '',
    source: 'Top Cuts website',
  });
  const event = await client.createAppointment({
    calendarId: 'calendar-1',
    contactId: contact.id,
    title: 'Adult Cut — Demo Customer',
    description: 'Confirmation: TC-DEMO',
    address: '33505 Pacific Hwy S Ste B',
    startTime: '2026-08-30T17:00:00.000Z',
    endTime: '2026-08-30T17:30:00.000Z',
  });

  assert.equal(event.id, 'event-1');
  const contactBody = JSON.parse(calls[0].options.body);
  assert.equal(contactBody.phone, '+12535550123');
  assert.equal(contactBody.locationId, LOCATION_ID);
  assert.equal('email' in contactBody, false);
  const eventBody = JSON.parse(calls[1].options.body);
  assert.equal(eventBody.calendarId, 'calendar-1');
  assert.equal(eventBody.contactId, 'contact-1');
  assert.equal(eventBody.toNotify, false);
  assert.equal(eventBody.ignoreFreeSlotValidation, true);
});

test('creates a walk-in contact with GHL first and last name fields', async () => {
  const calls = [];
  const client = createGhlClient({
    token: 'private-token',
    locationId: LOCATION_ID,
    calendarIds: CALENDARS,
    baseUrl: 'https://ghl.test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ contact: { id: 'contact-2' } });
    },
  });

  const contact = await client.createContact({ name: 'Demo Walk-In Customer', source: 'Top Cuts store dashboard' });

  assert.equal(contact.id, 'contact-2');
  assert.equal(calls[0].url.pathname, '/contacts/');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.firstName, 'Demo');
  assert.equal(body.lastName, 'Walk-In Customer');
  assert.equal('name' in body, false);
});

test('reports GHL failures without exposing the private token', async () => {
  const client = createGhlClient({
    token: 'private-token',
    locationId: LOCATION_ID,
    calendarIds: CALENDARS,
    baseUrl: 'https://ghl.test',
    fetchImpl: async () => jsonResponse({ message: 'Calendar is unavailable' }, 503),
  });

  await assert.rejects(
    () => client.listCalendarEvents({ calendarId: 'calendar-1', startMs: 1000, endMs: 2000 }),
    (error) => {
      assert.ok(error instanceof GhlApiError);
      assert.equal(error.upstreamStatus, 503);
      assert.match(error.message, /Calendar is unavailable/);
      assert.doesNotMatch(error.message, /private-token/);
      return true;
    },
  );
});
