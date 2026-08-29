#!/usr/bin/env node
// Populate data/db.json with tasteful demo appointments so the portal,
// staff console, and booking calendar look alive during demos.
//
// Stop the server first (node keeps its copy of the books in memory),
// run `node seed-demo.js`, then start the server again.
// Reset anytime by deleting data/db.json.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const OPEN_DAYS = new Set(
  Object.entries(cfg.hours)
    .filter(([k]) => /^[0-6]$/.test(k) && cfg.hours[k])
    .map(([k]) => Number(k))
);

function pad(n) {
  return String(n).padStart(2, '0');
}
function dateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function nextOpenDay(offsetDays) {
  let d = addDays(new Date(), offsetDays);
  while (!OPEN_DAYS.has(d.getDay())) d = addDays(d, 1);
  return dateStr(d);
}
function nextSaturday() {
  let d = addDays(new Date(), 1);
  while (d.getDay() !== 6) d = addDays(d, 1);
  return dateStr(d);
}
function code() {
  return 'TC-' + Array.from(crypto.randomBytes(5)).map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
function appt(serviceId, date, time, chairId, name, phone, status = 'confirmed', source = 'online') {
  const svc = cfg.services.find((s) => s.id === serviceId);
  return {
    id: crypto.randomUUID(),
    code: code(),
    status,
    source,
    serviceId,
    minutes: svc.minutes,
    date,
    time,
    chairId,
    name,
    phone,
    email: '',
    notes: '',
    createdAt: new Date().toISOString(),
  };
}

let pastDate = (() => {
  let d = addDays(new Date(), -9);
  while (!OPEN_DAYS.has(d.getDay())) d = addDays(d, 1);
  return dateStr(d);
})();

const dayA = nextOpenDay(1);
const dayB = nextOpenDay(2);
const sat = nextSaturday();

const appointments = [
  appt('adult-cut', pastDate, '10:00', 'chair-1', 'Dana Reyes', '2535550123', 'completed'),
  appt('buzz-cut', pastDate, '10:45', 'chair-2', 'Ray Noble', '2535550444', 'completed', 'walkin'),
  appt('full-color', dayA, '10:00', 'chair-1', 'Maria Combs', '2535550187'),
  appt('adult-cut', dayA, '14:30', 'chair-2', 'Tyler Adams', '2535550321'),
  appt('highlights', dayB, '10:00', 'chair-2', 'Bethany Hall', '2535550912'),
  appt('kids-cut', dayB, '15:00', 'chair-1', 'Mason & mom', '2535550765'),
  appt('root-touchup', sat, '09:30', 'chair-1', 'Carol Ritchie', '2535550567'),
];

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
fs.writeFileSync(DB_FILE, JSON.stringify({ appointments }, null, 2));
console.log(`Seeded ${appointments.length} demo appointments -> ${DB_FILE}`);
console.log('Portal demo: look up phone (253) 555-0123 (Dana Reyes).');
console.log(`Upcoming days used: ${[...new Set([dayA, dayB, sat])].join(', ')}`);
