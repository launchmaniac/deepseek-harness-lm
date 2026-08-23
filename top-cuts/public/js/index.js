// Homepage rendering: services, stylists, hours, contact — all driven by /api/config
import { getConfig, fmtMoney, fmtTime, esc } from './common.js';

function svcCard(svc) {
  return `
    <button type="button" class="svc-card" data-goto="/booking.html?service=${encodeURIComponent(svc.id)}">
      <span class="svc-card__top">
        <span class="svc-card__name">${esc(svc.name)}</span>
        <span class="svc-card__price">${fmtMoney(svc.price)}${svc.priceNote ? `<span class="svc-card__note"> ${esc(svc.priceNote)}</span>` : ''}</span>
      </span>
      <span class="svc-card__desc">${esc(svc.description)}</span>
      <span class="svc-card__meta">≈ ${svc.minutes} min${svc.group === 'color' ? ' · please book ahead' : ' · walk-ins ok'}</span>
    </button>`;
}

async function boot() {
  const cfg = await getConfig();

  // Contact points
  document.querySelectorAll('[data-phone]').forEach((elN) => (elN.textContent = cfg.business.phone));
  document.querySelectorAll('[data-address]').forEach((elN) => (elN.textContent = cfg.business.address));
  document.querySelectorAll('[data-map-link]').forEach((elN) => (elN.href = cfg.business.mapUrl));

  // Services
  document.querySelector('#cuts-grid').innerHTML = cfg.services.filter((s) => s.group === 'cuts').map(svcCard).join('');
  document.querySelector('#color-grid').innerHTML = cfg.services.filter((s) => s.group === 'color').map(svcCard).join('');
  document.querySelectorAll('[data-goto]').forEach((btn) =>
    btn.addEventListener('click', () => (location.href = btn.dataset.goto))
  );

  // Stylists
  document.querySelector('#stylist-grid').innerHTML = cfg.stylists
    .map(
      (c) => `
      <article class="stylist-card">
        <div class="stylist-card__avatar" aria-hidden="true">${esc((c.name || '?').trim()[0] || 'T')}</div>
        <div>
          <h3 class="stylist-card__name">${esc(c.name)}</h3>
          <p class="stylist-card__role">${esc(c.role)}</p>
          <p class="stylist-card__bio">${esc(c.bio)}</p>
        </div>
      </article>`
    )
    .join('');

  // Hours (Monday-first, today highlighted)
  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const todayIdx = new Date().getDay();
  const order = [1, 2, 3, 4, 5, 6, 0];
  document.querySelector('#hours-table').innerHTML = order
    .map((d) => {
      const ranges = cfg.hours[String(d)];
      return `<tr class="${d === todayIdx ? 'is-today' : ''}">
        <td scope="row">${WEEKDAYS[d]}</td>
        <td>${ranges ? ranges.map(([o, c]) => `${fmtTime(o)} – ${fmtTime(c)}`).join(', ') : 'Closed'}</td>
      </tr>`;
    })
    .join('');

  // Footer year
  const y = document.querySelector('#year');
  if (y) y.textContent = new Date().getFullYear();
}

boot().catch((err) => console.error(err));
