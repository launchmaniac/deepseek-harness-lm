// Shared staff/admin console core: PIN session + appointment books + walk-in logging.
// Used by both /staff.html (stylists' daily view) and /admin.html (site management).

import { api, getConfig, fmtDate, fmtTime, todayStr, toast, esc } from './common.js';

const TOKEN_KEY = 'tc-staff-token';

export function staffToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setStaffToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

/** Authenticated request with the stored staff token. */
export async function authed(path, options = {}) {
  return api(path, {
    ...options,
    headers: { ...(options.headers || {}), authorization: `Bearer ${staffToken()}` },
  });
}

export async function staffLogin(pin) {
  const { token } = await api('/api/staff/session', { method: 'POST', body: { pin } });
  setStaffToken(token);
  return token;
}

/** True when the stored token is still valid server-side. */
export async function hasLiveSession() {
  try {
    await authed('/api/staff/appointments?days=1');
    return true;
  } catch {
    setStaffToken(null);
    return false;
  }
}

function sourceBadge(appt) {
  return appt.source === 'walkin'
    ? '<span class="badge badge--walkin">Walk-in</span>'
    : '<span class="badge">Online</span>';
}

function statusBadge(appt) {
  if (appt.status === 'cancelled') return '<span class="badge badge--cancelled">Cancelled</span>';
  if (appt.status === 'completed') return '<span class="badge badge--done">Done</span>';
  return '';
}

function apptRow(appt, isToday) {
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

/**
 * Mounts the next-7-days books into `rowsEl`, optionally wiring a refresh button,
 * sign-out button, and a walk-in logging form.
 * Returns { refresh } so hosts can trigger reloads after their own mutations.
 */
export async function mountBooks({ rowsEl, refreshBtn, signoutBtn, walkin }) {
  const cfg = await getConfig();

  async function refresh() {
    const data = await authed('/api/staff/appointments?days=7');
    renderList(data.appointments);
    return data.appointments;
  }

  function renderList(appointments) {
    if (!appointments.length) {
      rowsEl.innerHTML =
        '<div class="empty-note"><strong>Nothing on the books.</strong><p>Walk-ins will appear here when you log them.</p></div>';
      return;
    }
    const today = todayStr();
    const byDate = new Map();
    for (const a of appointments) {
      if (!byDate.has(a.date)) byDate.set(a.date, []);
      byDate.get(a.date).push(a);
    }
    rowsEl.innerHTML = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, rows]) => {
        const label = date === today ? 'Today' : fmtDate(date, { long: true });
        return `
          <section class="day-block">
            <h3 class="day-block__title">${label}${date === today ? ` · ${rows.filter((r) => r.status === 'confirmed').length} active` : ''}</h3>
            <table class="staff-table">
              <thead><tr><th>Time</th><th>Client</th><th>Service</th><th>Chair</th><th>Source</th><th></th><th></th></tr></thead>
              <tbody>${rows.map((a) => apptRow(a, date === today)).join('')}</tbody>
            </table>
          </section>`;
      })
      .join('');
    rowsEl.querySelectorAll('[data-cancel]').forEach((btn) =>
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

  async function wireWalkin() {
    const { formEl, nameEl, phoneEl, serviceEl, chairEl, dateEl, timeEl } = walkin;

    serviceEl.innerHTML = cfg.services.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} (${s.minutes}m)</option>`).join('');
    chairEl.innerHTML =
      '<option value="">First available</option>' +
      cfg.stylists.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');

    async function loadTimeOptions() {
      const dateVal = dateEl.value || todayStr();
      timeEl.innerHTML = '<option value="">Loading…</option>';
      try {
        const qs = new URLSearchParams({ date: dateVal, serviceId: serviceEl.value, chair: chairEl.value || 'any' });
        const data = await api(`/api/availability?${qs}`);
        timeEl.innerHTML = !data.slots.length
          ? '<option value="">No slots — closed day?</option>'
          : data.slots
              .map((s, i) => `<option value="${s.time}"${i === 0 ? ' selected' : ''}>${fmtTime(s.time)}</option>`)
              .join('');
      } catch {
        timeEl.innerHTML = '<option value="">Unavailable</option>';
      }
    }

    dateEl.value = todayStr();
    serviceEl.addEventListener('change', loadTimeOptions);
    chairEl.addEventListener('change', loadTimeOptions);
    dateEl.addEventListener('change', loadTimeOptions);
    await loadTimeOptions();

    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await authed('/api/staff/walkin', {
          method: 'POST',
          body: {
            name: nameEl.value,
            serviceId: serviceEl.value,
            chairId: chairEl.value || 'any',
            date: dateEl.value || undefined,
            time: timeEl.value || undefined,
            phone: phoneEl.value || '',
          },
        });
        toast('Walk-in logged — that chair now shows busy online.', 'ok');
        formEl.reset();
        dateEl.value = todayStr();
        await loadTimeOptions();
        refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  if (refreshBtn) refreshBtn.addEventListener('click', () => refresh().then(() => toast('Refreshed.', 'ok')));
  if (signoutBtn) signoutBtn.addEventListener('click', () => {
    setStaffToken(null);
    location.reload();
  });
  if (walkin) await wireWalkin();

  await refresh();
  return { refresh };
}
