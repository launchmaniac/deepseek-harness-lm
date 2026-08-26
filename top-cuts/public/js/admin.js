// Site admin page: PIN gate -> live editors for business info, hours, services,
// stylists, and PIN — plus the shared daily books (console.js).
import { getConfig, toast, esc } from './common.js';
import { staffLogin, hasLiveSession, mountBooks, authed } from './console.js';

let config = null;
let draftServices = [];
let draftStylists = [];

const el = (sel) => document.querySelector(sel);

/* ---------------- gate ---------------- */

function showGate() {
  el('#gate').hidden = false;
  el('#console').hidden = true;
  el('#pin-input').focus();
}

async function showConsole() {
  el('#gate').hidden = true;
  el('#console').hidden = false;
  el('#signout').hidden = false;

  await mountBooks({
    rowsEl: el('#appt-list'),
    refreshBtn: el('#refresh'),
    signoutBtn: el('#signout'),
    walkin: {
      formEl: el('#walkin-form'),
      nameEl: el('#w-name'),
      phoneEl: el('#w-phone'),
      serviceEl: el('#w-service'),
      chairEl: el('#w-chair'),
      dateEl: el('#w-date'),
      timeEl: el('#w-time'),
    },
  });

  populateBusiness();
  populateHours();
  populateServices();
  populateStylists();
}

/* ---------------- generic section saver ---------------- */

async function saveSection(section, value) {
  try {
    const res = await authed('/api/admin/config', { method: 'PUT', body: { section, value } });
    config = res.config;
    toast('Saved — the site reflects it immediately.', 'ok');
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  }
}

/* ---------------- business info ---------------- */

function populateBusiness() {
  const b = config.business;
  el('#b-name').value = b.name || '';
  el('#b-phone').value = b.phone || '';
  el('#b-address').value = b.address || '';
  el('#b-map').value = b.mapUrl || '';
  el('#b-years').value = b.yearsInBusiness ?? '';
  el('#b-window').value = b.bookingWindowDays ?? 21;
  el('#b-lead').value = b.minLeadMinutes ?? 30;
  el('#b-slot').value = b.slotIntervalMinutes ?? 15;
  el('#b-buffer').value = b.turnoverBufferMinutes ?? 10;
  el('#b-cutoff').value = b.cancelCutoffHours ?? 2;
}

function collectBusiness() {
  const num = (id, fallback) => {
    const v = Number(el(id).value);
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback;
  };
  return {
    name: el('#b-name').value.trim(),
    address: el('#b-address').value.trim(),
    shortAddress: config.business.shortAddress || el('#b-address').value.trim().split(',')[0],
    mapUrl: el('#b-map').value.trim(),
    phone: el('#b-phone').value.trim(),
    phoneAssumption: config.business.phoneAssumption,
    yearsInBusiness: num('#b-years', config.business.yearsInBusiness),
    bookingWindowDays: num('#b-window', 21),
    minLeadMinutes: num('#b-lead', 30),
    slotIntervalMinutes: num('#b-slot', 15),
    turnoverBufferMinutes: num('#b-buffer', 10),
    cancelCutoffHours: num('#b-cutoff', 2),
  };
}

/* ---------------- weekly hours ---------------- */

const DAY_ORDER = [
  ['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'],
  ['5', 'Friday'], ['6', 'Saturday'], ['0', 'Sunday'],
];

function populateHours() {
  el('#hours-editor').innerHTML = DAY_ORDER.map(([day, name]) => {
    const range = config.hours[day]?.[0];
    return `
      <div class="hours-row" data-day="${day}">
        <span class="day-name">${name}</span>
        <label class="check-row"><input type="checkbox" class="h-open" ${range ? 'checked' : ''} /> Open</label>
        <input type="time" class="input h-from" value="${range ? range[0] : '09:00'}" ${range ? '' : 'disabled'} />
        <span aria-hidden="true">–</span>
        <input type="time" class="input h-to" value="${range ? range[1] : '17:00'}" ${range ? '' : 'disabled'} />
      </div>`;
  }).join('');

  el('#hours-editor').querySelectorAll('.hours-row').forEach((row) => {
    const open = row.querySelector('.h-open');
    const sync = () => {
      row.querySelector('.h-from').disabled = !open.checked;
      row.querySelector('.h-to').disabled = !open.checked;
    };
    open.addEventListener('change', sync);
  });
}

function collectHours() {
  const out = {};
  let clientProblem = null;
  el('#hours-editor').querySelectorAll('.hours-row').forEach((row) => {
    const day = row.dataset.day;
    if (!row.querySelector('.h-open').checked) {
      out[day] = null;
      return;
    }
    const from = row.querySelector('.h-from').value;
    const to = row.querySelector('.h-to').value;
    if (from && to && from >= to) clientProblem = `${DAY_ORDER.find(([d]) => d === day)[1]}: close must be after open`;
    out[day] = [[from || '09:00', to || '17:00']];
  });
  return { value: out, clientProblem };
}

/* ---------------- services & prices ---------------- */

function slugify(name, fallbackPrefix) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return slug || `${fallbackPrefix}-${Math.random().toString(36).slice(2, 6)}`;
}

function populateServices() {
  draftServices = JSON.parse(JSON.stringify(config.services));
  renderServices();
}

function renderServices() {
  el('#services-editor').innerHTML = draftServices
    .map(
      (svc, i) => `
      <div class="line-item" data-idx="${i}">
        <div class="line-item__head">
          <span class="line-item__title">${esc(svc.name || 'New service')}</span>
          <button type="button" class="btn btn--danger btn--small" data-remove="${i}">Remove</button>
        </div>
        <div class="inline-fields">
          <div class="field"><label class="label">Name</label><input class="input" data-f="name" value="${esc(svc.name)}" /></div>
          <div class="field"><label class="label">Price ($)</label><input class="input" data-f="price" type="number" step="0.5" min="0" value="${svc.price}" /></div>
          <div class="field"><label class="label">Price note</label><input class="input" data-f="priceNote" value="${esc(svc.priceNote || '')}" placeholder="and up" /></div>
          <div class="field"><label class="label">Minutes</label><input class="input" data-f="minutes" type="number" min="5" step="5" value="${svc.minutes}" /></div>
          <div class="field">
            <label class="label">Group</label>
            <select class="input" data-f="group">
              <option value="cuts"${svc.group === 'cuts' ? ' selected' : ''}>Walk-in cut</option>
              <option value="color"${svc.group === 'color' ? ' selected' : ''}>Color / chemical</option>
            </select>
          </div>
          <div class="field">
            <label class="check-row"><input type="checkbox" data-f="walkinFriendly"${svc.walkinFriendly ? ' checked' : ''} /> Walk-in friendly</label>
          </div>
          <div class="field field--wide"><label class="label">Description</label><input class="input" data-f="description" value="${esc(svc.description || '')}" /></div>
        </div>
      </div>`
    )
    .join('');

  el('#services-editor').querySelectorAll('.line-item').forEach((item) => {
    const idx = Number(item.dataset.idx);
    item.querySelectorAll('[data-f]').forEach((input) =>
      input.addEventListener('input', () => {
        const f = input.dataset.f;
        draftServices[idx][f] = f === 'price' || f === 'minutes' ? Number(input.value) : f === 'walkinFriendly' ? input.checked : input.value;
        if (f === 'name') item.querySelector('.line-item__title').textContent = input.value || 'New service';
      })
    );
    item.querySelector('[data-remove]').addEventListener('click', () => {
      draftServices.splice(idx, 1);
      renderServices();
    });
  });
}

function collectServices() {
  return draftServices.map((s) => ({
    ...s,
    id: s.id || slugify(s.name, 'service'),
    minutes: Math.round(Number(s.minutes) || 30),
    price: Number.isFinite(Number(s.price)) ? Number(s.price) : 0,
  }));
}

/* ---------------- stylists & chairs ---------------- */

function populateStylists() {
  draftStylists = JSON.parse(JSON.stringify(config.stylists));
  renderStylists();
}

function renderStylists() {
  el('#stylists-editor').innerHTML = draftStylists
    .map(
      (c, i) => `
      <div class="line-item" data-idx="${i}">
        <div class="line-item__head">
          <span class="line-item__title">${esc(c.name || 'New chair')}</span>
          <button type="button" class="btn btn--danger btn--small" data-remove="${i}" ${draftStylists.length <= 1 ? 'disabled title="At least one chair required"' : ''}>Remove</button>
        </div>
        <div class="inline-fields">
          <div class="field"><label class="label">Name</label><input class="input" data-f="name" value="${esc(c.name)}" /></div>
          <div class="field"><label class="label">Role</label><input class="input" data-f="role" value="${esc(c.role || '')}" placeholder="Senior Stylist" /></div>
          <div class="field field--wide"><label class="label">Short bio</label><input class="input" data-f="bio" value="${esc(c.bio || '')}" /></div>
        </div>
      </div>`
    )
    .join('');

  el('#stylists-editor').querySelectorAll('.line-item').forEach((item) => {
    const idx = Number(item.dataset.idx);
    item.querySelectorAll('[data-f]').forEach((input) =>
      input.addEventListener('input', () => {
        draftStylists[idx][input.dataset.f] = input.value;
        if (input.dataset.f === 'name') item.querySelector('.line-item__title').textContent = input.value || 'New chair';
      })
    );
    item.querySelector('[data-remove]').addEventListener('click', () => {
      if (draftStylists.length <= 1) return;
      draftStylists.splice(idx, 1);
      renderStylists();
    });
  });
}

function collectStylists() {
  return draftStylists.map((c) => ({
    ...c,
    id: c.id || slugify(c.name, 'chair'),
    initials: (c.name || '?').trim()[0]?.toUpperCase() || 'T',
  }));
}

/* ---------------- boot ---------------- */

async function boot() {
  config = await getConfig();
  document.title = `Site admin — ${config.business.name}`;

  el('#pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await staffLogin(el('#pin-input').value);
      await showConsole();
    } catch (err) {
      toast(err.message, 'error');
      el('#pin-input').select();
    }
  });

  if (!(sessionStorage.getItem('tc-staff-token') && (await hasLiveSession()))) {
    showGate();
    return;
  }
  await showConsole();

  // wire savers once console is visible
  el('form[data-save="business"]').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSection('business', collectBusiness());
  });

  el('form[data-save="hours"]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { value, clientProblem } = collectHours();
    if (clientProblem) return toast(clientProblem, 'warn');
    await saveSection('hours', value);
  });

  el('#add-service').addEventListener('click', () => {
    draftServices.push({
      id: '', name: 'New Service', group: 'cuts', minutes: 30, price: 15,
      priceNote: '', walkinFriendly: true, description: '',
    });
    renderServices();
    el('#sec-services').scrollIntoView({ behavior: 'smooth', block: 'end' });
  });
  el('#save-services').addEventListener('click', async () => {
    if (!draftServices.length) return toast('Keep at least one service.', 'warn');
    if (await saveSection('services', collectServices())) setTimeout(() => location.reload(), 700);
  });

  el('#add-stylist').addEventListener('click', () => {
    draftStylists.push({ id: '', name: 'New Chair', role: 'Stylist', bio: '' });
    renderStylists();
  });
  el('#save-stylists').addEventListener('click', async () => {
    if (await saveSection('stylists', collectStylists())) setTimeout(() => location.reload(), 700);
  });

  el('#pin-change').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = el('#p-new').value.trim();
    if (!/^\d{4,8}$/.test(pin)) return toast('PIN must be 4 to 8 digits.', 'warn');
    if (pin !== el('#p-confirm').value.trim()) return toast('PINs do not match.', 'warn');
    try {
      await authed('/api/admin/pin', { method: 'POST', body: { pin } });
      toast('PIN changed — tell the other stylist!', 'ok');
      el('#pin-change').reset();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

boot().catch((err) => console.error(err));
