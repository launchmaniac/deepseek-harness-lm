#!/usr/bin/env node
// Top Cuts — zero-dependency web + booking server.
// Run: node server.js   (PORT/HOST env optional)
//
// Wall-clock convention: the salon operates in its own local time. Appointments and
// hours are stored as local wall times ("YYYY-MM-DD", "HH:MM") with no timezone
// offsets, so availability never shifts with machine timezone settings.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createGhlClientFromEnv, GhlApiError, partsInTimeZone, zonedDateTimeToIso } from './ghl.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const TIMEZONE = 'America/Los_Angeles';

let ghl;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Config

/** Returns a list of problems; empty list means the config is valid. */
function validateConfig(raw) {
  const problems = [];
  const b = raw.business || {};
  for (const field of ['name', 'address', 'phone']) {
    if (typeof b[field] !== 'string' || !b[field].trim()) problems.push(`business.${field} is required`);
  }
  for (const field of ['bookingWindowDays', 'minLeadMinutes', 'slotIntervalMinutes', 'turnoverBufferMinutes', 'cancelCutoffHours', 'yearsInBusiness']) {
    if (b[field] !== undefined && (!Number.isInteger(b[field]) || b[field] < 0)) {
      problems.push(`business.${field} must be a non-negative integer`);
    }
  }
  if (!raw.hours || !Object.keys(raw.hours).length) problems.push('hours must define weekday keys 0-6');
  for (const [day, ranges] of Object.entries(raw.hours || {})) {
    if (!/^[0-6]$/.test(day)) continue; // ignore _comment-style keys
    if (ranges === null) continue;
    if (!Array.isArray(ranges) || !ranges.length) problems.push(`hours.${day} must be null or a non-empty array of ranges`);
    for (const range of ranges || []) {
      const [open, close] = range;
      if (!isHHMM(open) || !isHHMM(close) || hhmmToMin(open) >= hhmmToMin(close)) {
        problems.push(`hours.${day} range ${JSON.stringify(range)} must be ["HH:MM","HH:MM"] with open < close`);
      }
    }
  }
  if (!Array.isArray(raw.stylists) || raw.stylists.length === 0) problems.push('at least one stylist is required');
  for (const s of raw.stylists || []) {
    if (!s.id || !String(s.id).trim()) problems.push('every stylist needs an id');
    if (!s.name || !String(s.name).trim()) problems.push('every stylist needs a name');
  }
  const chairIds = new Set((raw.stylists || []).map((s) => s.id));
  if (chairIds.size !== (raw.stylists || []).length) problems.push('stylist ids must be unique');

  if (!Array.isArray(raw.services) || raw.services.length === 0) problems.push('at least one service is required');
  const serviceIds = new Set();
  for (const svc of raw.services || []) {
    if (!svc.id || !svc.name) problems.push('every service needs id and name');
    if (serviceIds.has(svc.id)) problems.push(`duplicate service id ${svc.id}`);
    serviceIds.add(svc.id);
    if (!Number.isInteger(svc.minutes) || svc.minutes <= 0) problems.push(`service ${svc.id}: minutes must be a positive integer`);
    if (typeof svc.price !== 'number' || svc.price < 0) problems.push(`service ${svc.id}: price must be a number`);
    if (svc.group !== 'cuts' && svc.group !== 'color') problems.push(`service ${svc.id}: group must be "cuts" or "color"`);
  }
  return problems;
}

function loadConfig() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    throw new Error(`config.json is missing or not valid JSON: ${err.message}`);
  }
  const problems = validateConfig(raw);
  if (problems.length) throw new Error(`config.json invalid:\n  - ${problems.join('\n  - ')}`);
  return raw;
}

/** Atomic write of a full validated config object. */
async function saveConfigFile(cfgRaw) {
  const tmp = `${CONFIG_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(cfgRaw, null, 2) + '\n');
  await fsp.rename(tmp, CONFIG_FILE);
}

// ---------------------------------------------------------------------------
// Persistence — JSON file, atomic tmp+rename writes.

let db;

async function loadDb() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    db = JSON.parse(await fsp.readFile(DB_FILE, 'utf8'));
  } catch {
    db = { appointments: [] };
    await saveDb();
  }
  db.appointments ||= [];
}

async function saveDb() {
  const tmp = `${DB_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
  await fsp.rename(tmp, DB_FILE);
}

// ---------------------------------------------------------------------------
// Time helpers (all local wall clock)

function isHHMM(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
function hhmmToMin(v) {
  const [h, m] = v.split(':').map(Number);
  return h * 60 + m;
}
function minToHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
function isDateStr(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T12:00:00`).getTime());
}
/** Local Date for a date string; midday avoids DST edge effects on the date itself. */
function localDate(dateStr) {
  const [y, m, d] = dateStr.split(':').join('-').split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}
function addDays(dateStr, n) {
  const d = localDate(dateStr);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) throw new ApiError(400, 'Please enter a valid 10-digit phone number.');
  return digits;
}
function prettyPhone(digits) {
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// ---------------------------------------------------------------------------
// Availability engine.
// A confirmed appointment blocks [start, start + duration + turnoverBuffer) on
// its chair. A candidate start fits when the whole service ends by close and
// never intersects a blocked interval.

function dayRanges(cfg, dateStr) {
  const weekday = String(localDate(dateStr).getDay());
  const ranges = cfg.hours[weekday];
  return ranges ? ranges.map(([o, c]) => [hhmmToMin(o), hhmmToMin(c)]) : [];
}

async function blockedIntervals(cfg, dateStr, chairId) {
  const timezone = cfg.business.timezone || TIMEZONE;
  const startMs = Date.parse(zonedDateTimeToIso(dateStr, '00:00', timezone));
  const endMs = Date.parse(zonedDateTimeToIso(addDays(dateStr, 1), '00:00', timezone));
  const events = await ghl.listCalendarEvents({
    calendarId: ghl.calendarIdForChair(chairId),
    startMs,
    endMs,
  });
  return events.flatMap((event) => {
    const status = event.appointmentStatus || event.status || 'confirmed';
    if (event.deleted || status === 'cancelled' || status === 'invalid') return [];
    const startAt = new Date(event.startTime);
    if (Number.isNaN(startAt.getTime())) return [];
    const localStart = partsInTimeZone(startAt, timezone);
    if (localStart.date !== dateStr) return [];
    const start = localStart.hour * 60 + localStart.minute;
    const endAt = new Date(event.endTime);
    const duration = Number.isNaN(endAt.getTime())
      ? 30
      : Math.max(1, Math.round((endAt.getTime() - startAt.getTime()) / 60_000));
    return [[start, start + duration + cfg.business.turnoverBufferMinutes]];
  });
}

function overlaps([s1, e1], [s2, e2]) {
  return s1 < e2 && s2 < e1;
}

/**
 * All bookable start times for one date + service across chairs.
 * Returns { closed, reason?, slots: [{ time, chairs: [chairId...] }] }
 */
async function availabilityFor(cfg, dateStr, service, onlyChair, { ignoreLead = false } = {}) {
  const chairs = onlyChair ? cfg.stylists.filter((c) => c.id === onlyChair) : cfg.stylists;
  if (!chairs.length) throw new ApiError(400, 'Unknown stylist.');

  const today = todayStr();
  if (dateStr < today) return { closed: false, past: true, slots: [] };
  if (dateStr > addDays(today, cfg.business.bookingWindowDays)) {
    return { closed: true, reason: `Booking opens ${cfg.business.bookingWindowDays} days ahead — call the shop for later dates.`, slots: [] };
  }
  const ranges = dayRanges(cfg, dateStr);
  if (!ranges.length) return { closed: true, reason: 'The shop is closed this day.', slots: [] };

  const lead = ignoreLead ? -1 : cfg.business.minLeadMinutes;
  const earliest = dateStr === today ? nowMinutes() + lead : -1;
  const perChair = new Map();
  const blockedByChair = new Map(await Promise.all(chairs.map(async (chair) => [
    chair.id,
    await blockedIntervals(cfg, dateStr, chair.id),
  ])));
  for (const chair of chairs) {
    const blocked = blockedByChair.get(chair.id);
    const times = [];
    for (const [open, close] of ranges) {
      for (let t = open; t + service.minutes <= close; t += cfg.business.slotIntervalMinutes) {
        if (t < earliest) continue;
        const candidate = [t, t + service.minutes];
        if (blocked.some((b) => overlaps(candidate, b))) continue;
        times.push(t);
      }
    }
    perChair.set(chair.id, times.sort((a, b) => a - b));
  }

  const byTime = new Map();
  for (const [chairId, times] of perChair) {
    for (const t of times) {
      if (!byTime.has(t)) byTime.set(t, []);
      byTime.get(t).push(chairId);
    }
  }
  return {
    closed: false,
    slots: [...byTime.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, chairList]) => ({ time: minToHHMM(t), chairs: chairList })),
  };
}

// ---------------------------------------------------------------------------
// Booking operations

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L lookalikes
let bookingQueue = Promise.resolve();

function newCode() {
  const bytes = crypto.randomBytes(5);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `TC-${code}`;
}

function serializeBooking(work) {
  const result = bookingQueue.then(work, work);
  bookingQueue = result.catch(() => {});
  return result;
}

function joinAppointment(cfg, appt) {
  const service = cfg.services.find((s) => s.id === appt.serviceId);
  const chair = cfg.stylists.find((c) => c.id === appt.chairId);
  return {
    ...appt,
    phonePretty: appt.phone ? prettyPhone(appt.phone) : '',
    serviceName: appt.serviceName || (service ? service.name : appt.serviceId),
    servicePrice: appt.servicePrice ?? (service ? service.price : null),
    chairName: appt.chairName || (chair ? chair.name : appt.chairId),
  };
}

async function createAppointment(cfg, { serviceId, date, time, chairId, name, phone, email, notes, source }) {
  if (!name || !String(name).trim()) throw new ApiError(400, 'A name is required.');
  const normalizedPhone = source === 'walkin' && !phone ? '' : normalizePhone(phone);

  const service = cfg.services.find((s) => s.id === serviceId);
  if (!service) throw new ApiError(400, 'Unknown service.');
  if (!isDateStr(date)) throw new ApiError(400, 'Invalid date.');
  if (!isHHMM(time)) throw new ApiError(400, 'Invalid time.');

  const wantChair = chairId && chairId !== 'any' ? chairId : null;
  if (wantChair && !cfg.stylists.some((c) => c.id === wantChair)) throw new ApiError(400, 'Unknown stylist.');

  const openSlots = await availabilityFor(cfg, date, service, wantChair, { ignoreLead: source === 'walkin' });
  const slot = openSlots.slots.find((s) => s.time === time);
  if (!slot) {
    if (openSlots.closed) throw new ApiError(409, openSlots.reason || 'The shop is closed this day.');
    throw new ApiError(409, 'Sorry — that time was just taken or is unavailable. Please pick another time.');
  }
  const assignedChair = wantChair || slot.chairs[0];
  const customerName = String(name).trim().slice(0, 80);
  const customerEmail = email ? String(email).trim().slice(0, 120) : '';
  const customerNotes = notes ? String(notes).trim().slice(0, 500) : '';
  const code = newCode();
  const contact = normalizedPhone || customerEmail
    ? await ghl.upsertContact({
        name: customerName,
        phone: normalizedPhone,
        email: customerEmail,
        source: source === 'walkin' ? 'Top Cuts store dashboard' : 'Top Cuts website',
      })
    : await ghl.createContact({ name: customerName, source: 'Top Cuts store dashboard' });
  const timezone = cfg.business.timezone || TIMEZONE;
  const startTime = zonedDateTimeToIso(date, time, timezone);
  const endTime = new Date(Date.parse(startTime) + service.minutes * 60_000).toISOString();
  const event = await ghl.createAppointment({
    calendarId: ghl.calendarIdForChair(assignedChair),
    contactId: contact.id,
    title: `${service.name} — ${customerName}`,
    description: [
      `Confirmation: ${code}`,
      `Service: ${service.name} (${serviceId})`,
      `Source: ${source === 'walkin' ? 'Store dashboard' : 'Website'}`,
      customerNotes ? `Notes: ${customerNotes}` : '',
    ].filter(Boolean).join('\n'),
    address: cfg.business.address,
    startTime,
    endTime,
  });

  const appt = {
    id: crypto.randomUUID(),
    code,
    status: 'confirmed',
    source: source || 'online',
    serviceId,
    minutes: service.minutes,
    date,
    time,
    chairId: assignedChair,
    name: customerName,
    phone: normalizedPhone,
    email: customerEmail,
    notes: customerNotes,
    ghlEventId: event.id,
    ghlContactId: contact.id,
    createdAt: new Date().toISOString(),
  };
  db.appointments.push(appt);
  return appt;
}

async function cancelAppointment(cfg, appt, { staffBypass = false } = {}) {
  if (appt.status !== 'confirmed') throw new ApiError(409, 'This appointment is not active.');
  if (!staffBypass) {
    const startsAt = localDate(appt.date);
    const [h, m] = appt.time.split(':').map(Number);
    startsAt.setHours(h, m, 0, 0);
    const cutoffMs = cfg.business.cancelCutoffHours * 3600 * 1000;
    if (startsAt.getTime() - Date.now() < cutoffMs) {
      throw new ApiError(409, `Online changes closed for this visit — please call the shop at ${cfg.business.phone}.`);
    }
  }
  if (appt.ghlEventId) await ghl.cancelAppointment(appt.ghlEventId);
  appt.status = 'cancelled';
  appt.cancelledAt = new Date().toISOString();
}

function normalizedEventStatus(event) {
  const status = event.appointmentStatus || event.status || 'confirmed';
  if (status === 'cancelled' || status === 'invalid') return 'cancelled';
  if (status === 'completed' || status === 'showed' || status === 'noshow') return 'completed';
  return 'confirmed';
}

function projectGhlEvent(cfg, event, chairId) {
  const timezone = cfg.business.timezone || TIMEZONE;
  const startAt = new Date(event.startTime);
  if (Number.isNaN(startAt.getTime())) return null;
  const local = partsInTimeZone(startAt, timezone);
  const endAt = new Date(event.endTime);
  const minutes = Number.isNaN(endAt.getTime())
    ? 30
    : Math.max(1, Math.round((endAt.getTime() - startAt.getTime()) / 60_000));
  const [serviceName, customerName] = String(event.title || 'GHL booking').split(' — ');
  const noteMatch = String(event.description || '').match(/(?:^|\n)Notes: (.+)/s);
  return {
    id: event.id,
    ghlEventId: event.id,
    code: `GHL-${String(event.id).slice(-6).toUpperCase()}`,
    status: normalizedEventStatus(event),
    source: 'ghl',
    serviceId: 'ghl-booking',
    serviceName: serviceName || 'GHL booking',
    servicePrice: null,
    minutes,
    date: local.date,
    time: local.time,
    chairId,
    name: customerName || event.contactName || 'GHL customer',
    phone: '',
    email: '',
    notes: noteMatch ? noteMatch[1].trim() : '',
    createdAt: event.dateAdded || event.createdAt || new Date().toISOString(),
  };
}

async function appointmentsForRange(cfg, from, to) {
  const timezone = cfg.business.timezone || TIMEZONE;
  const startMs = Date.parse(zonedDateTimeToIso(from, '00:00', timezone));
  const endMs = Date.parse(zonedDateTimeToIso(to, '00:00', timezone));
  const remoteRows = (await Promise.all(cfg.stylists.map(async (chair) => {
    const events = await ghl.listCalendarEvents({
      calendarId: ghl.calendarIdForChair(chair.id),
      startMs,
      endMs,
    });
    return events.map((event) => ({ event, chairId: chair.id }));
  }))).flat();
  const localByEvent = new Map(db.appointments
    .filter((appt) => appt.ghlEventId)
    .map((appt) => [appt.ghlEventId, appt]));
  const seen = new Set();
  const rows = remoteRows.flatMap(({ event, chairId }) => {
    seen.add(event.id);
    const local = localByEvent.get(event.id);
    if (local) return [{ ...local, status: normalizedEventStatus(event) }];
    const projected = projectGhlEvent(cfg, event, chairId);
    return projected ? [projected] : [];
  });
  for (const local of db.appointments) {
    if (local.ghlEventId && !seen.has(local.ghlEventId) && local.date >= from && local.date < to) rows.push(local);
  }
  return rows
    .filter((appt) => appt.date >= from && appt.date < to)
    .sort((left, right) => (left.date + left.time).localeCompare(right.date + right.time));
}

// ---------------------------------------------------------------------------
// Staff sessions (in-memory tokens; restart logs staff out)

const staffTokens = new Map(); // token -> expiresAt epoch ms
const STAFF_TTL_MS = 12 * 3600 * 1000;

function staffLogin(cfg, pin) {
  const expect = String(cfg.staffPin || '');
  const a = crypto.createHash('sha256').update(String(pin)).digest();
  const okLen = a.length === crypto.createHash('sha256').update(expect).digest().length;
  const match = okLen && crypto.timingSafeEqual(a, crypto.createHash('sha256').update(expect).digest());
  if (!match) throw new ApiError(401, 'Incorrect PIN.');
  const token = crypto.randomBytes(24).toString('hex');
  staffTokens.set(token, Date.now() + STAFF_TTL_MS);
  return token;
}

function requireStaff(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expiresAt = staffTokens.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    staffTokens.delete(token);
    throw new ApiError(401, 'Staff sign-in expired. Please enter your PIN again.');
  }
  staffTokens.set(token, Date.now() + STAFF_TTL_MS); // sliding expiry
}

// ---------------------------------------------------------------------------
// HTTP plumbing

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new ApiError(413, 'Request too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'Invalid JSON body.');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, urlPath) {
  let pathname = decodeURIComponent(new URL(urlPath, 'http://x').pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Friendly 404 page for navigations
      fs.readFile(path.join(PUBLIC_DIR, '404.html'), (err404, page) => {
        if (!err404) {
          res.writeHead(404, { 'Content-Type': MIME['.html'] }).end(page);
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        }
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

function publicConfig(cfg) {
  return {
    business: cfg.business,
    hours: cfg.hours,
    stylists: cfg.stylists.map(({ id, name, role, bio, initials }) => ({ id, name, role, bio, initials })),
    services: cfg.services.map(({ id, name, group, minutes, price, priceNote, walkinFriendly, description }) => ({
      id, name, group, minutes, price, priceNote, walkinFriendly, description,
    })),
  };
}

async function handleApi(req, res, url) {
  const cfg = loadConfig();
  const route = `${req.method} ${url.pathname}`;
  const q = url.searchParams;

  if (route === 'GET /api/health') return sendJson(res, 200, { ok: true, scheduling: 'ghl', locationId: ghl.locationId });

  if (route === 'GET /api/config') return sendJson(res, 200, publicConfig(cfg));

  if (route === 'GET /api/availability') {
    const date = q.get('date');
    const serviceId = q.get('serviceId');
    const chair = q.get('chair') || null;
    if (!isDateStr(date)) throw new ApiError(400, 'Invalid date.');
    const service = cfg.services.find((s) => s.id === serviceId);
    if (!service) throw new ApiError(400, 'Unknown service.');
    return sendJson(res, 200, { date, serviceId, ...(await availabilityFor(cfg, date, service, chair)) });
  }

  if (route === 'POST /api/book') {
    const body = await readJsonBody(req);
    const appt = await serializeBooking(() => createAppointment(cfg, { ...body, source: 'online' }));
    await saveDb();
    return sendJson(res, 201, { appointment: joinAppointment(cfg, appt) });
  }

  if (route === 'GET /api/appointments') {
    const code = (q.get('code') || '').trim().toUpperCase();
    const phoneRaw = q.get('phone');
    let matches = [];
    if (code) {
      matches = db.appointments.filter((a) => a.code.toUpperCase() === code);
    } else if (phoneRaw) {
      const phone = normalizePhone(phoneRaw);
      matches = db.appointments.filter((a) => a.phone === phone);
    } else {
      throw new ApiError(400, 'Enter your confirmation code or phone number.');
    }
    return sendJson(res, 200, { appointments: matches.map((a) => joinAppointment(cfg, a)) });
  }

  if (route === 'POST /api/appointments/cancel') {
    const body = await readJsonBody(req);
    const code = String(body.code || '').trim().toUpperCase();
    const appt = db.appointments.find((a) => a.code.toUpperCase() === code);
    if (!appt) throw new ApiError(404, 'No appointment found for that confirmation code.');
    if (body.phone) {
      const phone = normalizePhone(body.phone);
      if (appt.phone !== phone) throw new ApiError(403, 'That phone number does not match this booking.');
    }
    await cancelAppointment(cfg, appt);
    await saveDb();
    return sendJson(res, 200, { appointment: joinAppointment(cfg, appt) });
  }

  // ---- staff ----
  if (route === 'POST /api/staff/session') {
    const body = await readJsonBody(req);
    const token = staffLogin(cfg, body.pin);
    return sendJson(res, 200, { token });
  }

  requireStaff(req);

  if (route === 'GET /api/staff/appointments') {
    const from = isDateStr(q.get('from')) ? q.get('from') : todayStr();
    const days = Math.min(Math.max(Number(q.get('days')) || 7, 1), 31);
    const to = addDays(from, days);
    const rows = (await appointmentsForRange(cfg, from, to)).map((appt) => joinAppointment(cfg, appt));
    return sendJson(res, 200, { appointments: rows });
  }

  if (route === 'POST /api/staff/walkin') {
    const body = await readJsonBody(req);
    // Default start: next slot-grid minute after right now.
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const nextGrid = Math.ceil((nowMin + 1) / cfg.business.slotIntervalMinutes) * cfg.business.slotIntervalMinutes;
    const fallbackTime = nextGrid < 24 * 60 ? minToHHMM(nextGrid) : undefined;
    const appt = await serializeBooking(() => createAppointment(cfg, {
      serviceId: body.serviceId,
      date: body.date || todayStr(),
      time: body.time || fallbackTime,
      chairId: body.chairId || 'any',
      name: body.name,
      phone: body.phone || '',
      notes: body.notes,
      source: 'walkin',
    }));
    await saveDb();
    return sendJson(res, 201, { appointment: joinAppointment(cfg, appt) });
  }

  if (route === 'POST /api/staff/cancel') {
    const body = await readJsonBody(req);
    const appt = db.appointments.find((a) => a.id === body.id);
    if (appt) await cancelAppointment(cfg, appt, { staffBypass: true });
    else await ghl.cancelAppointment(body.id);
    await saveDb();
    return sendJson(res, 200, { appointment: appt ? joinAppointment(cfg, appt) : { id: body.id, status: 'cancelled' } });
  }

  // ---- admin (site management; same PIN gate as staff) ----

  if (route === 'POST /api/admin/pin') {
    const body = await readJsonBody(req);
    const pin = String(body.pin || '').trim();
    if (!/^\d{4,8}$/.test(pin)) throw new ApiError(400, 'PIN must be 4 to 8 digits.');
    cfg.staffPin = pin;
    delete cfg._staffPinComment;
    await saveConfigFile(cfg);
    return sendJson(res, 200, { ok: true });
  }

  if (route === 'PUT /api/admin/config') {
    const body = await readJsonBody(req);
    const section = body.section;
    if (!['business', 'hours', 'stylists', 'services'].includes(section)) {
      throw new ApiError(400, 'Unknown config section.');
    }
    const next = JSON.parse(JSON.stringify(cfg));
    next[section] = body.value;
    // Preserve _comment-style documentation keys when a section is rewritten.
    const prev = cfg[section];
    if (prev && typeof prev === 'object' && body.value && typeof body.value === 'object' && !Array.isArray(body.value)) {
      for (const key of Object.keys(prev)) {
        if (key.startsWith('_') && !(key in body.value)) next[section][key] = prev[key];
      }
    }

    const problems = validateConfig(next);
    if (problems.length) throw new ApiError(400, `Invalid ${section}: ${problems.join('; ')}`);
    if (section === 'stylists') {
      for (const stylist of next.stylists) ghl.calendarIdForChair(stylist.id);
    }

    if (section === 'services' && Array.isArray(cfg.services)) {
      // Services referenced by upcoming bookings cannot disappear.
      const keptIds = new Set(next.services.map((s) => s.id));
      const removed = cfg.services.filter((s) => !keptIds.has(s.id));
      const today = todayStr();
      for (const removedSvc of removed) {
        const blockers = db.appointments.filter(
          (a) => a.status === 'confirmed' && a.date >= today && a.serviceId === removedSvc.id
        );
        if (blockers.length) {
          throw new ApiError(409, `"${removedSvc.name}" has ${blockers.length} upcoming appointment${blockers.length === 1 ? '' : 's'} — cancel or rebook those first.`);
        }
      }
    }

    await saveConfigFile(next);
    return sendJson(res, 200, { ok: true, config: publicConfig(loadConfig()) });
  }

  throw new ApiError(404, 'Not found');
}

// ---------------------------------------------------------------------------

async function main() {
  const cfg = loadConfig();
  ghl = createGhlClientFromEnv(process.env);
  await ghl.verifyCalendars();
  await loadDb();

  const server = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(res, req.url);
      } else {
        sendJson(res, 405, { error: 'Method not allowed' });
      }
    } catch (err) {
      const status = err instanceof ApiError ? err.status : err instanceof GhlApiError ? 502 : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: err.message || 'Server error' });
      else res.end();
    } finally {
      console.log(`${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - startedAt}ms)`);
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Top Cuts server running at http://${HOST}:${PORT}`);
    console.log(`GHL schedule: ${ghl.locationId}`);
    console.log(`Data file: ${DB_FILE}`);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
