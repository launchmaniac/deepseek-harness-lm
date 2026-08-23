// Staff console: PIN gate -> today/upcoming list + walk-in logging.
import { api, getConfig, fmtDate, fmtTime, todayStr, toast, esc } from './common.js';

const TOKEN_KEY = 'tc-staff-token';
let config = null;

function el(sel) {
  return document.querySelector(sel);
}

function token() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

async function authed(path, options = {}) {
  return api(path, { ...options, headers: { ...(options.headers || {}), authorization: `Bearer ${token()}` } });
}

/* ---------------- PIN gate ---------------- */

function showGate() {
  el('#gate').hidden = false;
  el('#console').hidden = true;
  el('#pin-input').focus();
}

async function login() {
  const pin = el('#pin-input').value;
  if (!pin) return;
  try {
    const { token: t } = await api('/api/staff/session', { method: 'POST', body: { pin } });
    sessionStorage.setItem(TOKEN_KEY, t);
    showConsole();
  } catch (err) {
    toast(err.message, 'error');
    el('#pin-input').select();
  }
}

/* ---------------- Console ---------------- */

function sourceBadge(appt) {
  return appt.source === 'walkin' ? '<span class="badge badge--walkin">Walk-in</span>' : '<span class="badge">Online</span>';
}

function statusBadge(appt) {
  if (appt.status === 'cancelled') return '<span class="badge badge--cancelled">Cancelled</span>';
  if (appt.status === 'completed') return '<span class="badge badge--done">Done</span>';
  return '';
}

function row(appt, isToday) {
  const cancelBtn =
    appt.status === 'confirmed'
      ? `<button type="button" class="btn btn--danger btn--small" data-cancel="${esc(appt.id)}" title="Cancel (no cutoff for staff)">Cancel</button>`
      : '';
  return `
    <tr class="${appt.status !== 'confirmed' ? 'row-muted' : ''}">
      <td class="row__time">${fmtTime(appt.time)}</td>
      <td>
        <strong>${esc(appt.name)}</strong>${appt.phonePretty ? `<small> · ${esc(appt.phonePretty)}</small>` : ''}
        ${appt.notes ? `<br /><small class="row__notes">“${esc(appt.notes)}”</small>` : ''}
      </td>
      <td>${esc(appt.serviceName)} <small>(${appt.minutes}m)</small></td>
      <td>${esc(appt.chairName)}</td>
      <td>${sourceBadge(appt)} ${statusBadge(appt)}</td>
      <td>${isToday ? '' : esc(fmtDate(appt.date))}</td>
      <td class="row__actions">${cancelBtn}</td>
    </tr>`;
}

function renderList(appointments) {
  const box = el('#appt-list');
  if (!appointments.length) {
    box.innerHTML = '<div class="empty-note"><strong>Nothing on the books.</strong><p>Walk-ins will appear here when you log them.</p></div>';
    return;
  }
  const today = todayStr();
  const byDate = new Map();
  for (const a of appointments) {
    if (!byDate.has(a.date)) byDate.set(a.date, []);
    byDate.get(a.date).push(a);
  }
  box.innerHTML = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rows]) => {
      const label = date === today ? 'Today' : fmtDate(date, { long: true });
      return `
        <section class="day-block">
          <h3 class="day-block__title">${label}${date === today ? ` · ${rows.filter((r) => r.status === 'confirmed').length} active` : ''}</h3>
          <table class="staff-table">
            <thead><tr><th>Time</th><th>Client</th><th>Service</th><th>Chair</th><th>Source</th><th></th><th></th></tr></thead>
            <tbody>${rows.map((a) => row(a, date === today)).join('')}</tbody>
          </table>
        </section>`;
    })
    .join('');
  box.querySelectorAll('[data-cancel]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await authed('/api/staff/cancel', { method: 'POST', body: { id: btn.dataset.cancel } });
        toast('Cancelled.', 'ok');
        refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    })
  );
}

async function refresh() {
  const data = await authed('/api/staff/appointments?days=7');
  renderList(data.appointments);
}

/* ---------------- Walk-in logging ---------------- */

async function wireWalkinForm(cfg) {
  const serviceSel = el('#w-service');
  serviceSel.innerHTML = cfg.services
    .map((s) => `<option value="${s.id}">${esc(s.name)} (${s.minutes}m)</option>`)
    .join('');
  const chairSel = el('#w-chair');
  chairSel.innerHTML =
    '<option value="">First available</option>' +
    cfg.stylists.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

  async function loadTimeOptions() {
    const timeSel = el('#w-time');
    const dateVal = el('#w-date').value || todayStr();
    timeSel.innerHTML = '<option value="">Loading…</option>';
    try {
      const qs = new URLSearchParams({ date: dateVal, serviceId: serviceSel.value, chair: el('#w-chair').value || 'any' });
      const data = await api(`/api/availability?${qs}`);
      if (!data.slots.length) {
        timeSel.innerHTML = `<option value="">No slots — closed day?</option>`;
        return;
      }
      timeSel.innerHTML = data.slots.map((s) => `<option value="${s.time}" ${s.time === data.slots[0].time ? 'selected' : ''}>${fmtTime(s.time)}</option>`).join('');
    } catch {
      timeSel.innerHTML = '<option value="">Unavailable</option>';
    }
  }

  el('#w-date').value = todayStr();
  serviceSel.addEventListener('change', loadTimeOptions);
  el('#w-chair').addEventListener('change', loadTimeOptions);
  el('#w-date').addEventListener('change', loadTimeOptions);
  await loadTimeOptions();

  el('#walkin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: el('#w-name').value,
      serviceId: serviceSel.value,
      chairId: el('#w-chair').value || 'any',
      date: el('#w-date').value || undefined,
      time: el('#w-time').value || undefined,
      phone: el('#w-phone').value || '',
    };
    try {
      await authed('/api/staff/walkin', { method: 'POST', body });
      toast('Walk-in logged — that chair now shows busy online.', 'ok');
      el('#walkin-form').reset();
      el('#w-date').value = todayStr();
      await loadTimeOptions();
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* ---------------- Boot ---------------- */

async function showConsole() {
  el('#gate').hidden = true;
  el('#console').hidden = false;
  el('#signout').hidden = false;
  await Promise.all([refresh(), wireWalkinForm(config)]);
}

async function boot() {
  config = await getConfig();
  el('#shop-phone').textContent = config.business.phone;

  el('#pin-form').addEventListener('submit', (e) => {
    e.preventDefault();
    login();
  });

  if (sessionStorage.getItem(TOKEN_KEY)) {
    try {
      await authed('/api/staff/appointments?days=1'); // validate stored token
      await showConsole();
      return;
    } catch {
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }
  showGate();

  el('#signout').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    location.reload();
  });
  el('#refresh').addEventListener('click', () => refresh().then(() => toast('Refreshed.', 'ok')));
}

boot().catch((err) => console.error(err));
