// Customer portal: look up appointments by confirmation code or phone, cancel upcoming visits.
import { api, getConfig, fmtMoney, fmtDate, fmtTime, param, normalizePhoneDigits, toast, esc } from './common.js';

let lookup = { code: '', phone: '' };
const CANCEL_WINDOW_HOURS = 2;

function el(sel) {
  return document.querySelector(sel);
}

function isUpcoming(appt) {
  const startsAt = new Date(`${appt.date}T${appt.time}:00`);
  return appt.status === 'confirmed' && startsAt.getTime() > Date.now();
}

function apptCard(appt) {
  const upcoming = isUpcoming(appt);
  const statusLabel = appt.status === 'cancelled' ? 'Cancelled' : appt.status === 'completed' ? 'Visited' : upcoming ? 'Upcoming' : 'Past visit';
  const canCancel = upcoming && Date.now() < new Date(`${appt.date}T${appt.time}:00`).getTime() - CANCEL_WINDOW_HOURS * 3600 * 1000;
  return `
    <article class="appt-card ${upcoming ? '' : 'appt-card--past'}">
      <header class="appt-card__head">
        <span class="badge ${appt.status === 'confirmed' && upcoming ? 'badge--ok' : ''}">${statusLabel}</span>
        <span class="appt-card__code">${esc(appt.code)}</span>
      </header>
      <h3 class="appt-card__service">${esc(appt.serviceName)}</h3>
      <p class="appt-card__when">${fmtDate(appt.date, { long: true })} · ${fmtTime(appt.time)}</p>
      <dl class="summary summary--tight">
        <div><dt>With</dt><dd>${esc(appt.chairName)}</dd></div>
        <div><dt>Booked for</dt><dd>${esc(appt.name)}${appt.phonePretty ? ` · ${esc(appt.phonePretty)}` : ''}</dd></div>
        ${appt.servicePrice != null ? `<div><dt>Price</dt><dd>${fmtMoney(appt.servicePrice)}</dd></div>` : ''}
      </dl>
      ${canCancel ? `<button type="button" class="btn btn--danger btn--small" data-cancel="${esc(appt.code)}">Cancel this visit</button>` : ''}
      ${upcoming && !canCancel ? '<p class="muted">Online changes closed — please call the shop to change this one.</p>' : ''}
    </article>`;
}

function renderResults(appointments) {
  const box = el('#results');
  if (!appointments.length) {
    box.innerHTML = `
      <div class="empty-note">
        <strong>No visits found.</strong>
        <p>Double-check the number or code — or if this is your first time booking online, your next cut could be minutes away.</p>
        <a class="btn btn--primary" href="/booking.html">Book an appointment</a>
      </div>`;
    return;
  }
  const sorted = [...appointments].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const upcoming = sorted.filter(isUpcoming).reverse();
  const rest = sorted.filter((a) => !isUpcoming(a));
  box.innerHTML = `
    ${upcoming.length ? `<h2 class="section-subtitle">Upcoming</h2>${upcoming.map(apptCard).join('')}` : ''}
    ${rest.length ? `<h2 class="section-subtitle">History</h2><div class="history">${rest.map(apptCard).join('')}</div>` : ''}
    <div class="btn-row"><a class="btn btn--primary" href="/booking.html">Book another visit</a></div>`;

  box.querySelectorAll('[data-cancel]').forEach((btn) =>
    btn.addEventListener('click', () => confirmCancel(btn.dataset.cancel))
  );
}

async function runLookup() {
  const box = el('#results');
  const rawInput = el('#lookup-input').value.trim();
  const digits = normalizePhoneDigits(rawInput);
  if (!rawInput) return toast('Enter your phone number or confirmation code.', 'warn');

  if (/^TC-/i.test(rawInput)) lookup = { code: rawInput.toUpperCase(), phone: '' };
  else if (digits.length === 10) lookup = { code: '', phone: digits };
  else return toast('Enter a 10-digit phone number or a TC- code.', 'warn');

  box.innerHTML = '<p class="muted">Looking up…</p>';
  try {
    const qs = new URLSearchParams(lookup.code ? { code: lookup.code } : { phone: lookup.phone });
    const data = await api(`/api/appointments?${qs}`);
    renderResults(data.appointments);
  } catch (err) {
    box.innerHTML = `<div class="empty-note"><strong>Lookup failed.</strong><p>${esc(err.message)}</p></div>`;
  }
}

function confirmCancel(code) {
  const modal = el('#cancel-modal');
  modal.hidden = false;
  el('#cancel-confirm').dataset.code = code;
  el('#cancel-confirm').focus();
}

async function doCancel(code) {
  try {
    await api('/api/appointments/cancel', { method: 'POST', body: { code, phone: lookup.phone || undefined } });
    toast('Visit cancelled. We hope to see you soon!', 'ok');
    el('#cancel-modal').hidden = true;
    await runLookup();
  } catch (err) {
    el('#cancel-modal').hidden = true;
    toast(err.message, 'error');
  }
}

async function boot() {
  const cfg = await getConfig();
  el('#shop-phone').textContent = cfg.business.phone;
  el('#lookup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    runLookup();
  });
  el('#cancel-close').addEventListener('click', () => (el('#cancel-modal').hidden = true));
  el('#cancel-dismiss').addEventListener('click', () => (el('#cancel-modal').hidden = true));
  el('#cancel-confirm').addEventListener('click', (e) => doCancel(e.target.dataset.code));

  // Deep link: /portal.html?code=TC-XXXX
  const code = param('code');
  if (code) {
    el('#lookup-input').value = code.toUpperCase();
    runLookup();
  } else {
    el('#results').innerHTML = `
      <div class="empty-note">
        <strong>Welcome back.</strong>
        <p>Look up your visits with the phone number you booked with, or the TC- code from your confirmation.</p>
      </div>`;
  }
}

boot().catch((err) => console.error(err));
