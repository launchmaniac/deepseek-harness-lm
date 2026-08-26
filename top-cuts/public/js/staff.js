// Staff console page: PIN gate -> daily books + walk-in logging (shared core in console.js).
import { getConfig, toast } from './common.js';
import { staffLogin, hasLiveSession, mountBooks } from './console.js';

function el(sel) {
  return document.querySelector(sel);
}

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
}

async function boot() {
  const cfg = await getConfig();
  document.title = `Staff console — ${cfg.business.name}`;
  el('#shop-phone').textContent = cfg.business.phone;

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

  if (sessionStorage.getItem('tc-staff-token') && (await hasLiveSession())) {
    await showConsole();
  } else {
    showGate();
  }
}

boot().catch((err) => console.error(err));
