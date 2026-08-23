// Shared helpers for all Top Cuts pages.

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'content-type': 'application/json' } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response body */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let configCache = null;
export async function getConfig() {
  if (!configCache) configCache = api('/api/config');
  return configCache;
}

export function fmtMoney(n) {
  return `$${Number(n) % 1 === 0 ? Number(n) : n.toFixed(2)}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-25" -> "Tue, Aug 25" */
export function fmtDate(dateStr, { long = false } = {}) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  const wd = long ? WEEKDAYS[dt.getDay()] : WEEKDAYS[dt.getDay()].slice(0, 3);
  const mon = long ? ['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1] : MONTHS[m - 1];
  return `${wd}, ${mon} ${d}`;
}

/** "14:30" -> "2:30 PM" */
export function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function param(name) {
  return new URLSearchParams(location.search).get(name);
}

export function normalizePhoneDigits(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits;
}

/** Toast notifications. Single container reused across calls. */
export function toast(message, kind = 'info') {
  let holder = document.querySelector('.toast-holder');
  if (!holder) {
    holder = document.createElement('div');
    holder.className = 'toast-holder';
    holder.setAttribute('aria-live', 'polite');
    document.body.appendChild(holder);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.textContent = message;
  holder.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 350);
  }, 4200);
}

/** Human-readable hours block for footer/location sections. */
export function hoursRows(hoursCfg) {
  const rows = [];
  for (let d = 0; d < 7; d++) {
    const ranges = hoursCfg[String(d)];
    rows.push({
      day: WEEKDAYS[d],
      isToday: new Date().getDay() === d,
      text: !ranges ? 'Closed' : ranges.map(([o, c]) => `${fmtTime(o)} – ${fmtTime(c)}`).join(', '),
    });
  }
  // Monday-first display order
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((i) => rows[i]);
}

/** Build a downloadable .ics calendar invite (floating local time). */
export function downloadIcs(appt) {
  const compact = appt.date.replaceAll('-', '') + 'T' + appt.time.replace(':', '') + '00';
  const endMin = (() => {
    const [h, m] = appt.time.split(':').map(Number);
    const total = h * 60 + m + appt.minutes;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  })();
  const endCompact = appt.date.replaceAll('-', '') + 'T' + endMin.replace(':', '') + '00';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Top Cuts//Booking//EN', 'BEGIN:VEVENT',
    `UID:${appt.code}@topcuts`, `DTSTAMP:${stamp}`, `DTSTART:${compact}`, `DTEND:${endCompact}`,
    `SUMMARY:Top Cuts — ${appt.serviceName}`,
    `LOCATION:415 Main St, Hazard, KY 41701`,
    `DESCRIPTION:Confirmation ${appt.code} with ${appt.chairName}. Questions? Call the shop.`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `top-cuts-${appt.code}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Escape user strings before injecting into innerHTML templates. */
export function esc(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}
