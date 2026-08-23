// Booking wizard: service -> date/time -> contact -> confirmed.
import { api, getConfig, fmtMoney, fmtDate, fmtTime, todayStr, addDays, param, normalizePhoneDigits, toast, downloadIcs, esc } from './common.js';

const state = { serviceId: null, date: null, time: null, chairId: 'any', submitting: false };

function el(sel) {
  return document.querySelector(sel);
}

function showStep(n) {
  document.querySelectorAll('[data-step]').forEach((s) => {
    s.hidden = Number(s.dataset.step) !== n;
  });
  document.querySelectorAll('.stepper__dot').forEach((d, i) => {
    d.classList.toggle('is-active', i + 1 <= n);
    d.classList.toggle('is-current', i + 1 === n);
  });
  const heading = { 1: 'Pick your service', 2: 'Pick a day & time', 3: 'Your details', 4: "You're booked!" };
  el('#step-title').textContent = heading[n];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- Step 1: services ---------------- */

function serviceCard(svc) {
  return `
    <button type="button" class="svc-card ${state.serviceId === svc.id ? 'is-selected' : ''}" data-service="${svc.id}"
      aria-pressed="${state.serviceId === svc.id}">
      <span class="svc-card__top">
        <span class="svc-card__name">${esc(svc.name)}</span>
        <span class="svc-card__price">${fmtMoney(svc.price)}${svc.priceNote ? `<span class="svc-card__note"> ${esc(svc.priceNote)}</span>` : ''}</span>
      </span>
      <span class="svc-card__desc">${esc(svc.description)}</span>
      <span class="svc-card__meta">≈ ${svc.minutes} min${svc.group === 'color' ? ' · book ahead' : ''}</span>
    </button>`;
}

function renderServices(cfg) {
  const cuts = cfg.services.filter((s) => s.group === 'cuts');
  const color = cfg.services.filter((s) => s.group === 'color');
  el('#cuts-grid').innerHTML = cuts.map(serviceCard).join('');
  el('#color-grid').innerHTML = color.map(serviceCard).join('');

  document.querySelectorAll('[data-service]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.serviceId = btn.dataset.service;
      state.time = null;
      state.date = null;
      document.querySelectorAll('[data-service]').forEach((b) => {
        const on = b.dataset.service === state.serviceId;
        b.classList.toggle('is-selected', on);
        b.setAttribute('aria-pressed', on);
      });
      el('#to-step-2').disabled = false;
    });
  });

  const pre = param('service');
  if (pre) {
    const btn = document.querySelector(`[data-service="${CSS.escape(pre)}"]`);
    if (btn) btn.click();
  }
}

/* ---------------- Step 2: date chips + time grid ---------------- */

function renderDates(cfg) {
  const holder = el('#date-chips');
  const days = [];
  let cursor = todayStr();
  for (let i = 0; i < cfg.business.bookingWindowDays; i++) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  holder.innerHTML = days
    .map((date) => {
      const [y, m, d] = date.split('-').map(Number);
      const dt = new Date(y, m - 1, d, 12);
      const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
      const closed = !cfg.hours[String(dt.getDay())];
      return `
        <button type="button" class="chip" data-date="${date}" ${closed ? 'data-closed title="Closed this day"' : ''}
          aria-pressed="${state.date === date}">
          <span class="chip__wd">${wd}</span><span class="chip__day">${d}</span>
        </button>`;
    })
    .join('');

  holder.querySelectorAll('[data-date]').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (chip.hasAttribute('data-closed')) {
        toast('The shop is closed that day — pick another.', 'warn');
        return;
      }
      state.date = chip.dataset.date;
      state.time = null;
      holder.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c.dataset.date === state.date));
      loadSlots();
    });
  });
}

function renderChairPicker(cfg) {
  const holder = el('#chair-picker');
  holder.innerHTML = [
    { id: 'any', name: 'First available', role: 'Whoever is free soonest' },
    ...cfg.stylists.map((c) => ({ id: c.id, name: c.name, role: c.role })),
  ]
    .map(
      (c) => `
      <label class="radio-card">
        <input type="radio" name="chair" value="${c.id}" ${state.chairId === c.id ? 'checked' : ''} />
        <span class="radio-card__body"><strong>${esc(c.name)}</strong><small>${esc(c.role)}</small></span>
      </label>`
    )
    .join('');
  holder.querySelectorAll('input[name=chair]').forEach((r) =>
    r.addEventListener('change', () => {
      state.chairId = r.value;
      if (state.date) loadSlots();
    })
  );
}

async function loadSlots() {
  const box = el('#slot-area');
  if (!state.date) {
    box.innerHTML = '<p class="muted">Choose a day above to see open times.</p>';
    el('#to-step-3').hidden = true;
    return;
  }
  box.innerHTML = '<p class="muted">Checking the books…</p>';
  try {
    const qs = new URLSearchParams({ date: state.date, serviceId: state.serviceId, chair: state.chairId });
    const data = await api(`/api/availability?${qs}`);
    if (data.closed || !data.slots.length) {
      box.innerHTML = `
        <div class="empty-note">
          <strong>No open times ${fmtDate(state.date, { long: true }).split(',')[0]}.</strong>
          <p>${esc(data.reason || 'That day fills up fast — try another day, or call the shop and we will squeeze you in if we can.')}</p>
        </div>`;
      el('#to-step-3').hidden = true;
      return;
    }
    const morning = data.slots.filter((s) => s.time < '12:00');
    const afternoon = data.slots.filter((s) => s.time >= '12:00');
    const group = (label, slots) =>
      slots.length
        ? `<h4 class="slot-group__title">${label}</h4><div class="slot-grid">${slots
            .map((s) => `<button type="button" class="slot" data-time="${s.time}" aria-pressed="${state.time === s.time}">${fmtTime(s.time)}</button>`)
            .join('')}</div>`
        : '';
    box.innerHTML = group('Morning', morning) + group('Afternoon', afternoon);
    box.querySelectorAll('[data-time]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.time = btn.dataset.time;
        box.querySelectorAll('.slot').forEach((b) => b.setAttribute('aria-pressed', b.dataset.time === state.time));
        el('#to-step-3').hidden = false;
        el('#to-step-3').textContent = `Continue with ${fmtTime(state.time)} →`;
      })
    );
  } catch (err) {
    box.innerHTML = `<div class="empty-note"><strong>Could not load times.</strong><p>${esc(err.message)}</p></div>`;
  }
}

/* ---------------- Step 3: details form ---------------- */

function wireDetailsForm() {
  const phoneInput = el('#f-phone');
  phoneInput.addEventListener('input', () => {
    const digits = normalizePhoneDigits(phoneInput.value).slice(0, 10);
    phoneInput.value =
      digits.length > 6 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
      : digits.length > 3 ? `(${digits.slice(0, 3)}) ${digits.slice(3)}`
      : digits;
  });
  el('#details-form').addEventListener('submit', (e) => e.preventDefault());
}

async function submitBooking() {
  if (state.submitting) return;
  state.submitting = true;
  const btn = el('#confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Booking…';
  try {
    const payload = {
      serviceId: state.serviceId,
      date: state.date,
      time: state.time,
      chairId: state.chairId,
      name: el('#f-name').value,
      phone: el('#f-phone').value,
      email: el('#f-email').value,
      notes: el('#f-notes').value,
    };
    const { appointment } = await api('/api/book', { method: 'POST', body: payload });
    renderConfirmation(appointment);
    showStep(4);
  } catch (err) {
    toast(err.message, 'error');
    if (err.status === 409) {
      // Slot got taken under us — back to the grid.
      showStep(2);
      loadSlots();
    }
  } finally {
    state.submitting = false;
    btn.disabled = false;
    btn.textContent = 'Confirm booking';
  }
}

/* ---------------- Step 4: confirmation ---------------- */

function renderConfirmation(appt) {
  el('#confirm-box').innerHTML = `
    <div class="code-banner">Confirmation code <strong>${esc(appt.code)}</strong></div>
    <dl class="summary">
      <div><dt>Service</dt><dd>${esc(appt.serviceName)}</dd></div>
      <div><dt>When</dt><dd>${fmtDate(appt.date, { long: true })} · ${fmtTime(appt.time)}</dd></div>
      <div><dt>With</dt><dd>${esc(appt.chairName)}</dd></div>
      <div><dt>Price</dt><dd>${appt.servicePrice != null ? fmtMoney(appt.servicePrice) : '—'} <small>(pay at the shop)</small></dd></div>
    </dl>
    <p class="muted">Save your code — you can view or cancel anytime from the customer portal. Need to change within 2 hours of your visit? Please call.</p>
    <div class="btn-row">
      <button type="button" class="btn btn--primary" id="ics-btn">Add to calendar (.ics)</button>
      <a class="btn btn--ghost" href="/portal.html?code=${encodeURIComponent(appt.code)}">Manage in portal</a>
    </div>`;
  el('#ics-btn').addEventListener('click', () => downloadIcs(appt));
}

/* ---------------- Boot ---------------- */

async function boot() {
  const cfg = await getConfig();
  renderServices(cfg);
  renderDates(cfg);
  renderChairPicker(cfg);
  wireDetailsForm();
  showStep(1);

  el('#to-step-1').addEventListener('click', () => showStep(1));
  el('#to-step-2').addEventListener('click', () => {
    if (!state.serviceId) return;
    showStep(2);
    loadSlots();
  });
  el('#to-step-3').addEventListener('click', () => {
    if (!state.time) return;
    const svc = cfg.services.find((s) => s.id === state.serviceId);
    el('#review-line').textContent = `${svc.name} · ${fmtDate(state.date, { long: true })} at ${fmtTime(state.time)}`;
    showStep(3);
  });
  el('#back-to-2').addEventListener('click', () => showStep(2));
  el('#confirm-btn').addEventListener('click', () => {
    const digits = normalizePhoneDigits(el('#f-phone').value);
    if (!el('#f-name').value.trim()) return toast('Please add your name.', 'warn');
    if (digits.length !== 10) return toast('Please enter a 10-digit phone number.', 'warn');
    submitBooking();
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('afterbegin', `<div class="toast toast--error is-in">Could not reach the salon server: ${esc(err.message)}</div>`);
});
