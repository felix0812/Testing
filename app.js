'use strict';

/* ================= Konstanten & Zustand ================= */
const API = 'https://creativecommons.tankerkoenig.de/json';
const DEMO_KEY = '00000000-0000-0000-0000-000000000002';
const FUELS = { e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' };
const FUEL_KEYS = Object.keys(FUELS);
const REQUEST_GAP = 60000;          // ms zwischen API-Anfragen: Tankerkönig erlaubt max. 1 Anfrage pro Minute je Schlüssel
const DEMO_REQUEST_GAP = 1500;      // Demo-Schlüssel: nur Testdaten, kürzere Drosselung
const NATIONAL_MIN_GAP = 3600000;   // Deutschland-Scan per Auto-Update max. stündlich
const HOUR = 3600000;

const state = {
  settings: { apiKey: '', interval: 10, fuel: 'e5', onlyOpen: true, maxAge: 86400000, range: 604800000, scope: 'all', auto: false, nationalAuto: false },
  stations: new Map(),   // id -> Station (aktueller Stand)
  history: [],           // {sid, ts, e5, e10, diesel} – nur bei Preisänderung
  areas: [],             // {id, name, lat, lng, rad, lastFetch, count}
  origin: null,          // letzter Suchmittelpunkt
  listLimit: 100,
  charts: {},
  timer: null,
  busy: false,
  scanning: false,
  scanStop: false,
  map: null, layer: null, originMarker: null, areaCircle: null,
  mapNeedsFit: true,
};

/* ================= Hilfsfunktionen ================= */
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function priceHtml(v) {
  if (v == null) return '–';
  const s = v.toFixed(3).replace('.', ',');
  return `${s.slice(0, -1)}<sup>${s.slice(-1)}</sup>`;
}
const priceTxt = v => v == null ? '–' : v.toFixed(3).replace('.', ',') + ' €';
const ct = v => (v * 100).toFixed(1).replace('.', ',') + ' ct';
const fmtNum = n => n.toLocaleString('de-DE');
const fmtTime = ts => new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 48) return `vor ${h} Std.`;
  return `vor ${Math.round(h / 24)} Tagen`;
}
function distKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
const normPrice = v => (typeof v === 'number' && v > 0.5 && v < 5) ? Math.round(v * 1000) / 1000 : null;
function titleCase(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (s === s.toUpperCase() && s.length > 4) return s.toLowerCase().replace(/(^|[\s\-/])\S/g, c => c.toUpperCase());
  return s;
}
function brandKey(b) {
  const k = String(b || '').trim().toUpperCase();
  return k || 'FREIE TANKSTELLE';
}
function brandLabel(k) {
  const known = { ARAL: 'Aral', SHELL: 'Shell', ESSO: 'Esso', TOTALENERGIES: 'TotalEnergies', TOTAL: 'Total', AVIA: 'AVIA', JET: 'JET', STAR: 'star', AGIP: 'Agip', ENI: 'ENI', HEM: 'HEM', OMV: 'OMV', ORLEN: 'ORLEN', 'RAIFFEISEN': 'Raiffeisen', 'FREIE TANKSTELLE': 'Freie Tankstelle', WESTFALEN: 'Westfalen', HOYER: 'Hoyer', 'BFT': 'bft', TAMOIL: 'Tamoil', GULF: 'Gulf', CLASSIC: 'Classic', SB: 'SB' };
  return known[k] || titleCase(k);
}

/* ================= Einstellungen (localStorage) ================= */
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('tankradar.settings') || '{}');
    Object.assign(state.settings, s);
  } catch { /* ignorieren */ }
}
function saveSettings() {
  try { localStorage.setItem('tankradar.settings', JSON.stringify(state.settings)); } catch { /* ignorieren */ }
}
function loadMeta(key, fallback) {
  try { return JSON.parse(localStorage.getItem('tankradar.' + key)) ?? fallback; } catch { return fallback; }
}
function saveMeta(key, value) {
  try { localStorage.setItem('tankradar.' + key, JSON.stringify(value)); } catch { /* ignorieren */ }
}

/* ================= IndexedDB ================= */
const DB = {
  db: null,
  async open() {
    if (!('indexedDB' in window)) return;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('tankradar', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('stations', { keyPath: 'id' });
        const p = d.createObjectStore('prices', { keyPath: 'k', autoIncrement: true });
        p.createIndex('sid', 'sid');
        d.createObjectStore('areas', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  all(store) {
    if (!this.db) return Promise.resolve([]);
    return new Promise((res, rej) => {
      const q = this.db.transaction(store).objectStore(store).getAll();
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  },
  put(store, items) {
    if (!this.db || !items.length) return Promise.resolve();
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      for (const i of items) s.put(i);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  },
  del(store, key) {
    if (!this.db) return Promise.resolve();
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, 'readwrite');
      t.objectStore(store).delete(key);
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  },
  clear() {
    if (!this.db) return Promise.resolve();
    return new Promise((res, rej) => {
      const t = this.db.transaction(['stations', 'prices', 'areas'], 'readwrite');
      ['stations', 'prices', 'areas'].forEach(s => t.objectStore(s).clear());
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
    });
  },
};

/* ================= API ================= */
function apiKey() { return (state.settings.apiKey || '').trim(); }
const isDemo = () => apiKey() === DEMO_KEY;

/* ---------- Demo-Modus: realistische simulierte Preise ----------
   Der Demo-Schlüssel liefert echte Tankstellen, aber überall 1,009 €. Für ein realistisches
   Bild werden die Preise hier simuliert: Grundpreis + Marke + Region + Autobahn + Tagesverlauf. */
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
const DEMO_BASE = { e5: 1.719, e10: 1.659, diesel: 1.599 };
const DEMO_BRAND = { ARAL: 0.04, SHELL: 0.04, ESSO: 0.025, TOTALENERGIES: 0.025, TOTAL: 0.025, AVIA: 0.01, AGIP: 0.015, ENI: 0.015, 'AGIP ENI': 0.015,
  JET: -0.02, STAR: -0.005, HEM: -0.015, ORLEN: -0.01, SPRINT: -0.02, 'FREIE TANKSTELLE': -0.01, RAIFFEISEN: -0.005, BFT: -0.01, GLOBUS: -0.035, KAUFLAND: -0.035, MARKANT: -0.02 };
// typischer Tagesverlauf in Cent: Spitze morgens, günstigste Zeit abends, Sprung um 22 Uhr
const DEMO_HOURS = [7, 7, 7, 7, 8, 9, 11, 12, 10, 8, 6, 7, 8, 6, 5, 6, 6, 4, 2, 0, -1, 0, 7, 7];

function demoPrices(st, now = Date.now()) {
  const id = st.id || '';
  const r1 = hash01(id), r2 = hash01(id + 'b'), r3 = hash01(id + 'c');
  const brand = brandKey(st.brand);
  const brandOff = DEMO_BRAND[brand] ?? (r3 - 0.5) * 0.03;
  const plz = String(st.postCode || '').padStart(5, '0');
  const regionOff = (hash01('plz' + plz.slice(0, 2)) - 0.5) * 0.05;            // Regionen unterscheiden sich
  const text = `${st.name} ${st.street}`.toUpperCase();
  const autobahn = /\b(BAB|AUTOBAHN|RASTHOF|RASTSTÄTTE|RASTSTAETTE|AUTOHOF)\b|\bA ?\d{1,3}\b/.test(text) ? 0.16 : 0;
  // jede Tankstelle reagiert etwas zeitversetzt (0–50 Min.) und passt Preise im 30-Min.-Takt an
  const lag = r1 * 50 * 60000;
  const slot = Math.floor((now - lag) / (30 * 60000));
  const t = new Date(slot * 30 * 60000 + lag);
  const hourOff = DEMO_HOURS[t.getHours()] / 100;
  const dayIdx = Math.floor(t.getTime() / 86400000);
  const dayOff = Math.sin(dayIdx / 3.1) * 0.02 + (hash01('day' + dayIdx) - 0.5) * 0.015;   // Schwankung über Tage
  const noise = (hash01(id + slot) - 0.5) * 0.012;
  const stationOff = (r2 - 0.5) * 0.04;
  // manche Tankstellen haben nachts geschlossen
  const nightClosed = r3 < 0.25 && (t.getHours() >= 22 || t.getHours() < 6);
  const out = { ...st, isOpen: nightClosed ? false : st.isOpen !== false };
  for (const f of FUEL_KEYS) {
    const extra = f === 'diesel' ? (r2 - 0.5) * 0.02 : 0;
    const v = DEMO_BASE[f] + brandOff + regionOff + autobahn + hourOff + dayOff + noise + stationOff + extra;
    out[f] = Math.floor(v * 100) / 100 + 0.009;                                      // Preise enden auf 9
  }
  if (r1 > 0.93) out.diesel = null;                                                  // nicht jede bietet alles an
  if (r2 > 0.95) out.e10 = null;
  return out;
}

// Entfernt die unrealistischen 1,009-€-Einheitspreise früherer Demo-Abfragen
async function purgeFlatDemoPrices() {
  const flat = r => r.e5 != null && r.e5 === r.e10 && r.e10 === r.diesel;
  const bad = new Set(state.history.filter(flat).map(r => r.sid));
  const flatStations = [...state.stations.values()].filter(flat);
  if (!bad.size && !flatStations.length) return 0;
  const removed = state.history.filter(flat);
  state.history = state.history.filter(r => !flat(r));
  for (const st of flatStations) {
    for (const f of FUEL_KEYS) st[f] = null;
    st.min = {}; st.max = {}; st.priceTs = {};
  }
  try {
    await DB.put('stations', flatStations);
    for (const r of removed) if (r.k != null) await DB.del('prices', r.k);
  } catch (e) { console.warn(e); }
  return removed.length;
}

// Hält den Mindestabstand zwischen zwei API-Anfragen ein – für alle Aufrufer (Suche, Auto-Update, Scan, Wiederholungen)
let lastRequest = 0;
async function waitForSlot() {
  const gap = isDemo() ? DEMO_REQUEST_GAP : REQUEST_GAP;
  let wait;
  while ((wait = lastRequest + gap - Date.now()) > 0) {
    if (wait > 2000) setStatus(`Warte auf API-Limit (1 Anfrage/Min.) … noch ${Math.ceil(wait / 1000)} s`);
    await sleep(Math.min(wait, 1000));
  }
  lastRequest = Date.now();
}

async function apiList(lat, lng, rad) {
  const key = apiKey();
  if (!key) throw new Error('Kein API-Schlüssel eingetragen');
  const url = `${API}/list.php?lat=${lat}&lng=${lng}&rad=${rad}&sort=dist&type=all&apikey=${encodeURIComponent(key)}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitForSlot();
    try {
      const r = await fetch(url);
      if (r.status === 503 || r.status === 429) throw new Error('API überlastet (HTTP ' + r.status + ')');
      const j = await r.json();
      if (!j.ok) throw Object.assign(new Error(j.message || 'API-Fehler'), { fatal: true });
      return isDemo() ? (j.stations || []).map(st => demoPrices(st)) : (j.stations || []);
    } catch (e) {
      lastErr = e;
      if (e.fatal) break;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=de&limit=1&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'Accept-Language': 'de' } });
  const j = await r.json();
  if (!j.length) throw new Error('Ort nicht gefunden');
  const name = j[0].display_name.split(',').slice(0, 2).join(',').trim();
  return { lat: +(+j[0].lat).toFixed(5), lng: +(+j[0].lon).toFixed(5), name };
}

async function reverseName(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=12&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'de' } });
    const j = await r.json();
    const a = j.address || {};
    return a.city || a.town || a.village || a.municipality || a.county || 'Mein Standort';
  } catch { return 'Mein Standort'; }
}

/* ================= Datenaufnahme ================= */
async function ingest(list, ts = Date.now()) {
  const rows = [], upd = [];
  for (const s of list) {
    if (!s || !s.id) continue;
    const old = state.stations.get(s.id);
    const st = {
      id: s.id,
      name: titleCase(s.name) || brandLabel(brandKey(s.brand)),
      brand: brandKey(s.brand),
      street: titleCase(s.street),
      houseNumber: String(s.houseNumber || '').trim(),
      postCode: s.postCode ? String(s.postCode).padStart(5, '0') : (old?.postCode || ''),
      place: titleCase(s.place),
      lat: s.lat, lng: s.lng,
      isOpen: !!s.isOpen,
      lastSeen: ts,
      firstSeen: old?.firstSeen || ts,
      changes: old?.changes || 0,
      min: { ...(old?.min || {}) }, max: { ...(old?.max || {}) },
      priceTs: { ...(old?.priceTs || {}) },
    };
    let changed = !old;
    for (const f of FUEL_KEYS) {
      const v = normPrice(s[f]);
      if (v == null) { st[f] = old?.[f] ?? null; continue; }   // geschlossen/keine Angabe: letzten Preis behalten
      st[f] = v;
      if (!old || old[f] !== v) { changed = true; st.priceTs[f] = ts; }
      if (st.min[f] == null || v < st.min[f]) st.min[f] = v;
      if (st.max[f] == null || v > st.max[f]) st.max[f] = v;
    }
    if (changed) {
      if (old) st.changes++;
      rows.push({ sid: st.id, ts, e5: st.e5, e10: st.e10, diesel: st.diesel });
    }
    state.stations.set(st.id, st);
    upd.push(st);
  }
  const outOfOrder = state.history.length && state.history[state.history.length - 1].ts > ts;
  state.history.push(...rows);
  if (outOfOrder) state.history.sort((a, b) => a.ts - b.ts);
  try {
    await DB.put('stations', upd);
    await DB.put('prices', rows);
  } catch (e) { console.warn('Speichern fehlgeschlagen', e); }
  return { stations: upd.length, changes: rows.length };
}

/* ================= Gebiete & Aktualisierung ================= */
async function addArea(lat, lng, rad, name) {
  const existing = state.areas.find(a => distKm(a, { lat, lng }) < 1 && a.rad === rad);
  const area = existing || { id: 'a' + Date.now(), name, lat, lng, rad, lastFetch: 0, count: 0 };
  if (!existing) state.areas.push(area);
  await fetchArea(area);
  state.settings.scope = area.id;
  saveSettings();
  return area;
}

async function fetchArea(area) {
  const list = await apiList(area.lat, area.lng, area.rad);
  const res = await ingest(list);
  area.lastFetch = Date.now();
  area.count = list.length;
  await DB.put('areas', [area]);
  return res;
}

async function refreshAll(manual = false) {
  if (state.busy) return;
  if (!apiKey()) { if (manual) toast('Bitte zuerst einen API-Schlüssel eintragen'); return; }
  if (!state.areas.length && !state.scanning) {
    if (manual) toast('Noch kein Gebiet – suche zuerst nach einem Ort.');
    const national = loadMeta('national', null);
    if (!(state.settings.nationalAuto && national)) return;
  }
  state.busy = true;
  setBusy(true);
  let changes = 0, errors = 0;
  try {
    for (let i = 0; i < state.areas.length; i++) {
      setStatus(`Aktualisiere ${state.areas[i].name} (${i + 1}/${state.areas.length}) …`);
      try { changes += (await fetchArea(state.areas[i])).changes; } catch (e) { errors++; console.warn(e); if (e.fatal) { toast(e.message); break; } }
    }
    saveMeta('lastUpdate', Date.now());
    if (manual || changes) toast(`${changes} Preisänderung${changes === 1 ? '' : 'en'} erfasst${errors ? `, ${errors} Fehler` : ''}.`);
  } finally {
    state.busy = false;
    setBusy(false);
    renderAll();
  }
  const national = loadMeta('national', null);
  if (!manual && state.settings.nationalAuto && national && !state.scanning && Date.now() - (national.finished || 0) > NATIONAL_MIN_GAP) {
    scanGermany(true);
  }
}

function scheduleAuto() {
  clearInterval(state.timer);
  state.timer = null;
  if (state.settings.auto) {
    const ms = Math.max(5, +state.settings.interval || 10) * 60000;
    state.timer = setInterval(() => refreshAll(false), ms);
  }
}

/* ================= Deutschland-Scan ================= */
const GRID = germanyGrid(25);

async function scanGermany(auto = false) {
  if (state.scanning) return;
  if (!apiKey()) { toast('Bitte zuerst einen API-Schlüssel eintragen'); return; }
  const meta = loadMeta('national', {});
  const start = !auto && meta.next && meta.next < GRID.length ? meta.next : 0;
  state.scanning = true; state.scanStop = false;
  $('#scanBtn').hidden = true; $('#scanStopBtn').hidden = false;
  let changes = 0;
  const t0 = Date.now();
  try {
    for (let i = start; i < GRID.length; i++) {
      if (state.scanStop) break;
      while (state.busy) await sleep(500);
      const p = GRID[i];
      try {
        changes += (await ingest(await apiList(p.lat, p.lng, 25))).changes;
      } catch (e) {
        console.warn('Scan-Fehler', e);
        if (e.fatal) { toast(e.message); state.scanStop = true; break; }
      }
      const done = i + 1;
      saveMeta('national', { ...meta, next: done, running: true, finished: meta.finished || 0 });
      updateScanUi(done, `Scanne Deutschland … ${done}/${GRID.length} Rasterfelder, ${fmtNum(state.stations.size)} Tankstellen bekannt`);
      if (done % 15 === 0) renderAll();
    }
    const complete = !state.scanStop;
    const m2 = { ...loadMeta('national', {}), running: false };
    if (complete) { m2.finished = Date.now(); m2.next = GRID.length; m2.duration = Date.now() - t0; }
    saveMeta('national', m2);
    saveMeta('lastUpdate', Date.now());
    toast(complete ? `Deutschland-Scan fertig: ${fmtNum(state.stations.size)} Tankstellen, ${fmtNum(changes)} Preisänderungen.` : 'Scan pausiert – kann fortgesetzt werden.');
    if (complete && !auto) { state.settings.scope = 'all'; saveSettings(); state.mapNeedsFit = true; }
  } finally {
    state.scanning = false;
    $('#scanBtn').hidden = false; $('#scanStopBtn').hidden = true;
    renderScanStatus();
    renderAll();
  }
}

function updateScanUi(done, text) {
  $('#scanBar').style.width = (done / GRID.length * 100).toFixed(1) + '%';
  $('#scanStatus').textContent = text;
}
function renderScanStatus() {
  const m = loadMeta('national', null);
  $('#gridCount').textContent = GRID.length;
  $('#gridTime').textContent = Math.ceil(GRID.length * ((isDemo() ? DEMO_REQUEST_GAP : REQUEST_GAP) + 400) / 60000);
  if (!m) { updateScanUi(0, 'Noch nicht gescannt.'); $('#scanBtn').textContent = 'Deutschland scannen'; return; }
  const partial = m.next && m.next < GRID.length;
  updateScanUi(partial ? m.next : (m.finished ? GRID.length : 0),
    partial ? `Pausiert bei ${m.next}/${GRID.length} Rasterfeldern.` + (m.finished ? ` Letzter vollständiger Scan: ${fmtTime(m.finished)}.` : '')
      : `Letzter vollständiger Scan: ${fmtTime(m.finished)} (${ago(m.finished)}).`);
  $('#scanBtn').textContent = partial ? 'Scan fortsetzen' : 'Erneut scannen';
}

/* ================= Auswahl / Filter ================= */
function scopeArea() { return state.areas.find(a => a.id === state.settings.scope) || null; }

function scopedStations() {
  const area = scopeArea();
  const all = [...state.stations.values()];
  if (!area) return all;
  return all.filter(s => distKm(area, s) <= area.rad + 0.3);
}

// Stationen mit gültigem Preis für den gewählten Kraftstoff
function priced(list, fuel = state.settings.fuel) {
  const now = Date.now(), maxAge = +state.settings.maxAge;
  return list.filter(s => s[fuel] != null
    && (!state.settings.onlyOpen || s.isOpen)
    && (!maxAge || now - s.lastSeen <= maxAge));
}

function summary(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { n: sorted.length, min: sorted[0], max: sorted[sorted.length - 1], avg: sum / sorted.length, median: q(0.5), p05: q(0.05), p95: q(0.95) };
}

/* ================= Rendering ================= */
function setStatus(t) { $('#statusLine').textContent = t; }
function setBusy(b) { $('#refreshBtn').disabled = b; }

function renderStatus() {
  const last = loadMeta('lastUpdate', 0);
  setStatus(state.stations.size
    ? `${fmtNum(state.stations.size)} Tankstellen · ${fmtNum(state.history.length)} Preispunkte · Stand ${last ? ago(last) : '–'}`
    : 'Noch keine Daten');
  $('#keyBanner').hidden = !!apiKey();
  $('#demoBanner').hidden = !isDemo();
}

function renderScopeSelect() {
  const sel = $('#scopeSelect');
  sel.innerHTML = `<option value="all">Alle getrackten Tankstellen (${fmtNum(state.stations.size)})</option>` +
    state.areas.map(a => `<option value="${a.id}">${esc(a.name)} – ${a.rad} km</option>`).join('');
  if (!scopeArea()) state.settings.scope = 'all';
  sel.value = state.settings.scope;
}

function renderKpis() {
  const f = state.settings.fuel;
  const list = priced(scopedStations());
  const s = summary(list.map(x => x[f]));
  const best = list.reduce((b, x) => (!b || x[f] < b[f] ? x : b), null);
  const worst = list.reduce((b, x) => (!b || x[f] > b[f] ? x : b), null);
  const openCount = scopedStations().filter(x => x.isOpen).length;
  const trend = trendDelta(f);
  $('#kpis').innerHTML = s ? `
    <div class="kpi clickable" data-station="${best.id}">
      <div class="label">Günstigste · ${FUELS[f]}</div>
      <div class="value">${priceHtml(best[f])} €</div>
      <div class="hint">${esc(best.name)}, ${esc(best.place)}</div>
    </div>
    <div class="kpi">
      <div class="label">Durchschnitt</div>
      <div class="value">${priceHtml(s.avg)} €</div>
      <div class="hint">Median ${priceTxt(s.median)}${trend != null ? ` · ${trend >= 0 ? '▲' : '▼'} ${ct(Math.abs(trend))} ggü. vor 24 h` : ''}</div>
    </div>
    <div class="kpi clickable" data-station="${worst.id}">
      <div class="label">Teuerste</div>
      <div class="value">${priceHtml(worst[f])} €</div>
      <div class="hint">${esc(worst.name)}, ${esc(worst.place)}</div>
    </div>
    <div class="kpi">
      <div class="label">Ersparnis-Potenzial</div>
      <div class="value">${((s.max - s.min) * 50).toFixed(2).replace('.', ',')} €</div>
      <div class="hint">pro 50-Liter-Tankfüllung (Spanne ${ct(s.max - s.min)})</div>
    </div>
    <div class="kpi">
      <div class="label">Tankstellen</div>
      <div class="value">${fmtNum(s.n)}</div>
      <div class="hint">mit Preis · ${fmtNum(openCount)} geöffnet · ${fmtNum(scopedStations().length)} gesamt</div>
    </div>`
    : `<div class="kpi"><div class="label">Keine Daten</div><div class="value">–</div><div class="hint">Suche einen Ort oder starte den Deutschland-Scan.</div></div>`;
}

function renderList() {
  const f = state.settings.fuel;
  const q = $('#listFilter').value.trim().toLowerCase();
  let list = priced(scopedStations()).sort((a, b) => a[f] - b[f] || (a.name > b.name ? 1 : -1));
  const bestPrice = list[0]?.[f];
  if (q) list = list.filter(s => `${s.name} ${brandLabel(s.brand)} ${s.place} ${s.postCode} ${s.street}`.toLowerCase().includes(q));
  const shown = list.slice(0, state.listLimit);
  const origin = scopeArea() || state.origin;
  $('#stationList').innerHTML = shown.length ? shown.map((s, i) => `
    <div class="st ${s[f] === bestPrice ? 'best' : ''}" data-station="${s.id}">
      <div class="rank">${i + 1}.</div>
      <div class="price">${priceHtml(s[f])}</div>
      <div style="min-width:0">
        <div class="name">${esc(s.name)} ${s[f] === bestPrice ? '<span class="badge best">günstigste</span>' : ''}</div>
        <div class="addr">${esc(s.street)} ${esc(s.houseNumber)}, ${esc(s.postCode)} ${esc(s.place)}</div>
      </div>
      <div class="meta">
        <span class="badge ${s.isOpen ? 'open' : 'closed'}">${s.isOpen ? 'offen' : 'zu'}</span><br>
        ${origin ? distKm(origin, s).toFixed(1).replace('.', ',') + ' km · ' : ''}${ago(s.lastSeen)}
      </div>
    </div>`).join('')
    : `<div class="empty">${state.stations.size ? 'Keine Tankstellen für diese Filter.' : 'Noch keine Tankstellen erfasst.<br>Suche oben nach einem Ort oder nutze „Standort“.'}</div>`;
  $('#moreBtn').hidden = list.length <= state.listLimit;
  $('#moreBtn').textContent = `Mehr anzeigen (${fmtNum(list.length - state.listLimit)} weitere)`;
}

/* ---------- Karte ---------- */
function initMap() {
  if (!window.L) { $('#map').innerHTML = '<div class="empty">Karte konnte nicht geladen werden (keine Internetverbindung?).</div>'; return; }
  state.map = L.map('map', { preferCanvas: true, zoomControl: true }).setView([51.1, 10.4], 6);
  addTiles();
  state.layer = L.layerGroup().addTo(state.map);
  state.map.on('popupopen', e => {
    const btn = e.popup.getElement().querySelector('[data-station]');
    if (btn) btn.addEventListener('click', () => openDetail(btn.dataset.station));
  });
}

// Hintergrundkarte: TopPlusOpen (grau) des Bundesamts für Kartographie und Geodäsie.
// Funktioniert ohne Schlüssel auch per file:// – tile.openstreetmap.org und CARTO blockieren
// Anfragen ohne Referer.
function addTiles() {
  L.tileLayer('https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web_grau/default/WEBMERCATOR/{z}/{y}/{x}.png', {
    maxZoom: 18,
    attribution: '© <a href="https://gdz.bkg.bund.de/index.php/default/webdienste/topplus-produkte/wmts-topplusopen-wmts-topplus-open.html" target="_blank" rel="noopener">BKG</a> (' + new Date().getFullYear() + '), Datenquellen: <a href="https://sg.geodatenzentrum.de/web_public/gdz/datenquellen/Datenquellen_TopPlusOpen.html" target="_blank" rel="noopener">TopPlusOpen</a>',
  }).addTo(state.map);
}

function hexToRgb(h) { const n = parseInt(h.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; }
function priceColor(v, lo, hi) {
  const t = hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0.5;
  return t < 0.5 ? mix(cssVar('--cheap'), cssVar('--mid'), t * 2) : mix(cssVar('--mid'), cssVar('--pricey'), (t - 0.5) * 2);
}

function renderMap() {
  if (!state.map) return;
  const f = state.settings.fuel;
  const list = priced(scopedStations());
  const s = summary(list.map(x => x[f]));
  state.layer.clearLayers();
  $('#legendRange').textContent = s ? `${priceTxt(s.p05)} … ${priceTxt(s.p95)} (5.–95. Perzentil)` : '';
  if (!s) return;
  const surface = cssVar('--surface');
  const sorted = [...list].sort((a, b) => b[f] - a[f]);   // günstigste zuletzt = oben
  const best = sorted[sorted.length - 1];
  for (const st of sorted) {
    const isBest = st[f] === best[f];
    const m = L.circleMarker([st.lat, st.lng], {
      radius: isBest ? 9 : (list.length > 3000 ? 4 : 6),
      color: surface, weight: isBest ? 3 : 1.5,
      fillColor: priceColor(st[f], s.p05, s.p95), fillOpacity: 0.95,
    });
    m.bindTooltip(`${priceTxt(st[f])} · ${esc(st.name)}`, { direction: 'top' });
    m.bindPopup(() => `<strong>${esc(st.name)}</strong><br>${esc(st.street)} ${esc(st.houseNumber)}<br>${esc(st.postCode)} ${esc(st.place)}<br>
      E5 ${priceTxt(st.e5)} · E10 ${priceTxt(st.e10)} · Diesel ${priceTxt(st.diesel)}<br>
      <span class="muted">${st.isOpen ? 'geöffnet' : 'geschlossen'} · ${ago(st.lastSeen)}</span><br>
      <button class="btn" data-station="${st.id}">Details &amp; Verlauf</button>`);
    state.layer.addLayer(m);
  }
  if (state.areaCircle) { state.areaCircle.remove(); state.areaCircle = null; }
  const area = scopeArea();
  if (area) state.areaCircle = L.circle([area.lat, area.lng], { radius: area.rad * 1000, color: cssVar('--accent'), weight: 1, fill: false, dashArray: '4 4', interactive: false }).addTo(state.map);
  if (state.mapNeedsFit) {
    state.mapNeedsFit = false;
    if (area) state.map.fitBounds(L.latLng(area.lat, area.lng).toBounds(area.rad * 2000));
    else state.map.fitBounds(L.latLngBounds(list.map(x => [x.lat, x.lng])), { padding: [20, 20], maxZoom: 13 });
  }
}

/* ---------- Zeitreihen ---------- */
// Durchschnitt über Stationen je Zeitfenster; letzter bekannter Preis wird fortgeschrieben.
function averageSeries(ids, fromTs, bucketMs) {
  const rows = state.history;
  if (!rows.length) return [];
  const cur = new Map();
  const sum = { e5: 0, e10: 0, diesel: 0 }, cnt = { e5: 0, e10: 0, diesel: 0 };
  const out = [];
  const firstTs = rows.find(r => !ids || ids.has(r.sid))?.ts;
  if (firstTs == null) return [];
  let bucketEnd = Math.max(fromTs, Math.floor(firstTs / bucketMs) * bucketMs) + bucketMs;
  const emit = () => out.push({ ts: bucketEnd - bucketMs, e5: cnt.e5 ? sum.e5 / cnt.e5 : null, e10: cnt.e10 ? sum.e10 / cnt.e10 : null, diesel: cnt.diesel ? sum.diesel / cnt.diesel : null, n: cur.size });
  for (const r of rows) {
    if (ids && !ids.has(r.sid)) continue;
    while (r.ts >= bucketEnd) { if (bucketEnd - bucketMs >= fromTs) emit(); bucketEnd += bucketMs; }
    const prev = cur.get(r.sid) || {};
    for (const f of FUEL_KEYS) {
      if (prev[f] != null) { sum[f] -= prev[f]; cnt[f]--; }
      if (r[f] != null) { sum[f] += r[f]; cnt[f]++; }
    }
    cur.set(r.sid, r);
  }
  const now = Date.now();
  while (bucketEnd - bucketMs <= now) { if (bucketEnd - bucketMs >= fromTs) emit(); bucketEnd += bucketMs; }
  return out;
}

function scopeIds() {
  return scopeArea() ? new Set(scopedStations().map(s => s.id)) : null;
}

function trendDelta(f) {
  const series = averageSeries(scopeIds(), Date.now() - 26 * HOUR, HOUR);
  if (series.length < 24) return null;
  const now = series[series.length - 1][f], then = series[series.length - 25]?.[f];
  return now != null && then != null ? now - then : null;
}

/* ---------- Diagramme ---------- */
function chartDefaults() {
  if (!window.Chart) return;
  const text = cssVar('--text-2'), grid = cssVar('--grid');
  Chart.defaults.color = text;
  Chart.defaults.borderColor = grid;
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  Chart.defaults.plugins.tooltip.backgroundColor = cssVar('--text');
  Chart.defaults.plugins.tooltip.titleColor = cssVar('--surface');
  Chart.defaults.plugins.tooltip.bodyColor = cssVar('--surface');
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation = false;
}

function makeChart(id, config) {
  if (state.charts[id]) state.charts[id].destroy();
  const el = document.getElementById(id);
  if (!el || !window.Chart) return null;
  state.charts[id] = new Chart(el, config);
  return state.charts[id];
}

function timeTick(range) {
  return v => {
    const d = new Date(v);
    return range && range <= 86400000
      ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + (range && range <= 604800000 ? ' ' + d.getHours() + ' h' : '');
  };
}

function lineDatasets(points, key = f => f) {
  return FUEL_KEYS.map(f => ({
    label: FUELS[f],
    data: points.filter(p => p[f] != null).map(p => ({ x: p.ts, y: key(p[f]) })),
    borderColor: cssVar('--' + f), backgroundColor: cssVar('--' + f),
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: cssVar('--surface'),
    tension: 0, spanGaps: true,
  }));
}

function renderTrend() {
  const range = +state.settings.range;
  const now = Date.now();
  const from = range ? now - range : 0;
  const span = range || (now - (state.history[0]?.ts || now));
  const bucket = span <= 86400000 ? 15 * 60000 : span <= 604800000 ? HOUR : span <= 2592000000 ? 3 * HOUR : 6 * HOUR;
  const pts = averageSeries(scopeIds(), from, bucket);
  const enough = pts.filter(p => p.n).length >= 2;
  $('#trendEmpty').hidden = enough;
  makeChart('chartTrend', {
    type: 'line',
    data: { datasets: lineDatasets(pts) },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'linear', min: pts[0]?.ts, max: now, ticks: { callback: timeTick(span), maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { callback: v => v.toFixed(2).replace('.', ',') + ' €' } },
      },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { usePointStyle: true, pointStyle: 'line', boxWidth: 18 } },
        tooltip: { callbacks: { title: it => fmtTime(it[0].parsed.x), label: c => ` ${c.dataset.label}: ${priceTxt(c.parsed.y)}` } },
      },
    },
  });
}

function renderHours() {
  const f = state.settings.fuel;
  const pts = averageSeries(scopeIds(), Date.now() - 30 * 86400000, HOUR).filter(p => p[f] != null);
  const byDay = new Map();
  for (const p of pts) {
    const d = new Date(p.ts); const k = d.toDateString();
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push({ h: d.getHours(), v: p[f] });
  }
  const acc = Array.from({ length: 24 }, () => ({ s: 0, n: 0 }));
  for (const arr of byDay.values()) {
    if (arr.length < 12) continue;   // nur Tage mit halbwegs vollständigen Daten
    const mean = arr.reduce((a, b) => a + b.v, 0) / arr.length;
    for (const x of arr) { acc[x.h].s += (x.v - mean) * 100; acc[x.h].n++; }
  }
  const data = acc.map(a => a.n ? +(a.s / a.n).toFixed(2) : null);
  const has = data.filter(v => v != null).length >= 12;
  $('#hoursEmpty').hidden = has;
  const cheap = cssVar('--cheap'), pricey = cssVar('--pricey');
  makeChart('chartHours', {
    type: 'bar',
    data: { labels: acc.map((_, h) => h + ' Uhr'), datasets: [{ data: has ? data : [], backgroundColor: data.map(v => v < 0 ? cheap : pricey), borderRadius: 4, borderSkipped: false, barPercentage: 0.8, categoryPercentage: 0.9 }] },
    options: {
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }, y: { ticks: { callback: v => (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',') } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y > 0 ? '+' : ''}${c.parsed.y.toFixed(1).replace('.', ',')} ct ggü. Tagesmittel` } } },
    },
  });
}

function renderBrands() {
  const f = state.settings.fuel;
  const groups = new Map();
  for (const s of priced(scopedStations())) {
    if (!groups.has(s.brand)) groups.set(s.brand, []);
    groups.get(s.brand).push(s[f]);
  }
  let rows = [...groups].filter(([, v]) => v.length >= 3).map(([k, v]) => ({ k, n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length }));
  rows = rows.sort((a, b) => b.n - a.n).slice(0, 12).sort((a, b) => a.avg - b.avg);
  const base = rows[0]?.avg || 0;
  makeChart('chartBrands', {
    type: 'bar',
    data: { labels: rows.map(r => brandLabel(r.k)), datasets: [{ data: rows.map(r => +((r.avg - base) * 100).toFixed(2)), backgroundColor: cssVar('--' + f), borderRadius: 4, borderSkipped: 'start', barPercentage: 0.75 }] },
    options: {
      indexAxis: 'y',
      scales: { x: { beginAtZero: true, ticks: { callback: v => '+' + v.toFixed(1).replace('.', ',') } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const r = rows[c.dataIndex]; return ` Ø ${priceTxt(r.avg)} · +${c.parsed.x.toFixed(1).replace('.', ',')} ct · ${r.n} Tankstellen`; } } } },
    },
  });
}

function renderHist() {
  const f = state.settings.fuel;
  const vals = priced(scopedStations()).map(s => s[f]);
  const s = summary(vals);
  let labels = [], data = [];
  if (s) {
    const lo = Math.floor(s.p05 * 100) - 2, hi = Math.ceil(s.p95 * 100) + 2;
    const bins = new Map();
    for (const v of vals) { const c = Math.min(hi, Math.max(lo, Math.floor(v * 100 + 1e-6))); bins.set(c, (bins.get(c) || 0) + 1); }
    for (let c = lo; c <= hi; c++) { labels.push(c); data.push(bins.get(c) || 0); }
  }
  makeChart('chartHist', {
    type: 'bar',
    data: { labels: labels.map(c => (c / 100).toFixed(2).replace('.', ',')), datasets: [{ data, backgroundColor: cssVar('--' + f), borderRadius: 4, borderSkipped: 'start', barPercentage: 1, categoryPercentage: 0.9 }] },
    options: {
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: it => { const i = it[0].dataIndex; const c = labels[i]; return `${(c / 100).toFixed(2).replace('.', ',')} €` + (i === 0 ? ' und darunter' : i === labels.length - 1 ? ' und darüber' : ''); }, label: c => ` ${c.parsed.y} Tankstellen` } } },
    },
  });
}

function renderTables() {
  const base = scopedStations();
  $('#fuelTable').innerHTML = `<table><thead><tr><th>Kraftstoff</th><th class="num">Min</th><th class="num">Ø</th><th class="num">Max</th><th class="num">Anzahl</th></tr></thead><tbody>${
    FUEL_KEYS.map(f => { const s = summary(priced(base, f).map(x => x[f])); return `<tr><td><span style="color:var(--${f})">●</span> ${FUELS[f]}</td>${s ? `<td class="num">${priceTxt(s.min)}</td><td class="num">${priceTxt(s.avg)}</td><td class="num">${priceTxt(s.max)}</td><td class="num">${fmtNum(s.n)}</td>` : '<td class="num" colspan="4">–</td>'}</tr>`; }).join('')
  }</tbody></table>`;

  const f = state.settings.fuel;
  const list = priced(base).sort((a, b) => a[f] - b[f]);
  $('#topTable').innerHTML = list.length ? `<table><thead><tr><th>#</th><th>Tankstelle</th><th>Ort</th><th class="num">${FUELS[f]}</th></tr></thead><tbody>${
    list.slice(0, 10).map((s, i) => `<tr class="clickable" data-station="${s.id}"><td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.postCode)} ${esc(s.place)}</td><td class="num">${priceTxt(s[f])}</td></tr>`).join('')
  }</tbody></table>` : '<p class="muted">Keine Daten.</p>';

  const reg = new Map();
  for (const s of list) {
    const k = (s.postCode || '').slice(0, 2);
    if (!k) continue;
    if (!reg.has(k)) reg.set(k, { vals: [], places: new Map() });
    const r = reg.get(k); r.vals.push(s[f]); r.places.set(s.place, (r.places.get(s.place) || 0) + 1);
  }
  const regions = [...reg].filter(([, r]) => r.vals.length >= 3).map(([k, r]) => ({
    k, n: r.vals.length, avg: r.vals.reduce((a, b) => a + b, 0) / r.vals.length, min: Math.min(...r.vals),
    place: [...r.places].sort((a, b) => b[1] - a[1])[0][0],
  })).sort((a, b) => a.avg - b.avg);
  $('#regionTable').innerHTML = regions.length ? `<table><thead><tr><th>PLZ</th><th>größter Ort</th><th class="num">Ø</th><th class="num">Min</th><th class="num">n</th></tr></thead><tbody>${
    regions.map(r => `<tr><td>${r.k}xxx</td><td>${esc(r.place)}</td><td class="num">${priceTxt(r.avg)}</td><td class="num">${priceTxt(r.min)}</td><td class="num">${r.n}</td></tr>`).join('')
  }</tbody></table>` : '<p class="muted">Keine Daten.</p>';
}

function renderStats() {
  if (!$('#tab-stats').classList.contains('active')) return;
  chartDefaults();
  $$('.fuelName').forEach(e => { e.textContent = FUELS[state.settings.fuel]; });
  renderTrend(); renderHours(); renderBrands(); renderHist(); renderTables();
}

function renderAreas() {
  $('#areaList').innerHTML = state.areas.length ? state.areas.map(a => `
    <div class="area">
      <div><strong>${esc(a.name)}</strong> <span class="muted small">· ${a.rad} km · ${a.count} Tankstellen · ${a.lastFetch ? ago(a.lastFetch) : 'nie'}</span></div>
      <div class="btn-row" style="margin:0">
        <button class="btn" data-area-show="${a.id}">Anzeigen</button>
        <button class="btn danger" data-area-del="${a.id}" title="Gebiet nicht mehr tracken">✕</button>
      </div>
    </div>`).join('') : '<p class="muted">Noch keine Gebiete. Suche oben nach einem Ort.</p>';
}

function renderData() {
  const oldest = state.history[0]?.ts;
  $('#dataInfo').textContent = `${fmtNum(state.stations.size)} Tankstellen, ${fmtNum(state.history.length)} erfasste Preisstände${oldest ? `, seit ${fmtTime(oldest)}` : ''}, ${state.areas.length} Gebiete.`;
}

function renderAll() {
  renderStatus(); renderScopeSelect(); renderKpis(); renderList(); renderMap(); renderStats(); renderAreas(); renderData();
  $$('#fuelSeg button').forEach(b => b.classList.toggle('active', b.dataset.fuel === state.settings.fuel));
  $$('#rangeSeg button').forEach(b => b.classList.toggle('active', +b.dataset.range === +state.settings.range));
}

/* ---------- Detailansicht ---------- */
function openDetail(id) {
  const s = state.stations.get(id);
  if (!s) return;
  const rows = state.history.filter(r => r.sid === id);
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`;
  $('#detailBody').innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(s.name)}</h2>
        <div class="muted">${esc(brandLabel(s.brand))} · ${esc(s.street)} ${esc(s.houseNumber)}, ${esc(s.postCode)} ${esc(s.place)}</div>
        <div class="small muted">${s.isOpen ? '<span class="badge open">geöffnet</span>' : '<span class="badge closed">geschlossen</span>'} · zuletzt abgefragt ${ago(s.lastSeen)} · ${s.changes} Preisänderungen seit ${fmtTime(s.firstSeen)}</div>
      </div>
      <div><a class="btn" href="${nav}" target="_blank" rel="noopener">Route ↗</a></div>
    </div>
    <div class="detail-prices">${FUEL_KEYS.map(f => `
      <div class="kpi">
        <div class="label"><span style="color:var(--${f})">●</span> ${FUELS[f]}</div>
        <div class="value">${priceHtml(s[f])} €</div>
        <div class="hint">${s.min?.[f] != null ? `min ${priceTxt(s.min[f])} · max ${priceTxt(s.max[f])}` : 'kein Angebot'}</div>
      </div>`).join('')}
    </div>`;
  $('#stationEmpty').hidden = rows.length > 1;
  const dlg = $('#detailDlg');
  if (!dlg.open) dlg.showModal();
  chartDefaults();
  const pts = rows.map(r => ({ ts: r.ts, e5: r.e5, e10: r.e10, diesel: r.diesel }));
  if (pts.length) pts.push({ ...pts[pts.length - 1], ts: Math.max(Date.now(), pts[pts.length - 1].ts) });
  const ds = lineDatasets(pts).map(d => ({ ...d, stepped: 'before', pointRadius: 0 }));
  makeChart('chartStation', {
    type: 'line',
    data: { datasets: ds.filter(d => d.data.length) },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'linear', ticks: { callback: timeTick((pts.at(-1)?.ts || 0) - (pts[0]?.ts || 0)), maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { callback: v => v.toFixed(2).replace('.', ',') + ' €' } },
      },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { usePointStyle: true, pointStyle: 'line', boxWidth: 18 } },
        tooltip: { callbacks: { title: it => fmtTime(it[0].parsed.x), label: c => ` ${c.dataset.label}: ${priceTxt(c.parsed.y)}` } },
      },
    },
  });
  if (state.map) state.map.setView([s.lat, s.lng], Math.max(state.map.getZoom(), 13));
}

/* ================= Suche ================= */
async function search(lat, lng, name) {
  if (!apiKey()) { $('#settingsDlg').showModal(); return; }
  if (state.busy) return;
  const rad = +$('#radiusInput').value;
  state.busy = true; setBusy(true);
  setStatus(`Lade Tankstellen um ${name} …`);
  try {
    const area = await addArea(lat, lng, rad, name);
    state.origin = { lat, lng };
    state.listLimit = 100;
    state.mapNeedsFit = true;
    saveMeta('lastUpdate', Date.now());
    toast(`${area.count} Tankstellen um ${name} geladen – wird ab jetzt getrackt.`);
    if (!state.settings.auto) {
      state.settings.auto = true; $('#autoRefresh').checked = true; saveSettings(); scheduleAuto();
    }
  } catch (e) {
    toast('Fehler: ' + e.message, 6000);
  } finally {
    state.busy = false; setBusy(false);
    renderAll();
  }
}

/* ================= Export / Import ================= */
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  const j = JSON.parse(await file.text());
  if (!Array.isArray(j.stations) || !Array.isArray(j.history)) throw new Error('Ungültige Datei');
  for (const s of j.stations) {
    const old = state.stations.get(s.id);
    if (!old || s.lastSeen > old.lastSeen) state.stations.set(s.id, s);
  }
  const seen = new Set(state.history.map(r => r.sid + '|' + r.ts));
  const add = j.history.filter(r => !seen.has(r.sid + '|' + r.ts)).map(({ k, ...r }) => r);
  state.history.push(...add);
  state.history.sort((a, b) => a.ts - b.ts);
  for (const a of j.areas || []) if (!state.areas.find(x => x.id === a.id)) state.areas.push(a);
  await DB.put('stations', [...state.stations.values()]);
  await DB.put('prices', add);
  await DB.put('areas', state.areas);
  return add.length;
}

/* ================= Events ================= */
function bindEvents() {
  $('#searchForm').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#searchInput').value.trim();
    if (!q) return;
    try {
      setStatus('Suche Ort …');
      const g = await geocode(q);
      await search(g.lat, g.lng, g.name);
    } catch (err) { toast(err.message); renderStatus(); }
  });
  $('#locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Standortbestimmung nicht verfügbar');
    setStatus('Bestimme Standort …');
    navigator.geolocation.getCurrentPosition(async pos => {
      const lat = +pos.coords.latitude.toFixed(5), lng = +pos.coords.longitude.toFixed(5);
      await search(lat, lng, await reverseName(lat, lng));
    }, err => { toast('Standort nicht verfügbar: ' + err.message); renderStatus(); }, { enableHighAccuracy: false, timeout: 15000 });
  });
  $('#radiusInput').addEventListener('input', e => { $('#radiusOut').textContent = e.target.value + ' km'; });

  $('#fuelSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-fuel]'); if (!b) return;
    state.settings.fuel = b.dataset.fuel; saveSettings(); renderAll();
  });
  $('#rangeSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-range]'); if (!b) return;
    state.settings.range = +b.dataset.range; saveSettings(); renderAll();
  });
  $('#scopeSelect').addEventListener('change', e => {
    state.settings.scope = e.target.value; state.mapNeedsFit = true; state.listLimit = 100; saveSettings(); renderAll();
  });
  $('#ageSelect').addEventListener('change', e => { state.settings.maxAge = +e.target.value; saveSettings(); renderAll(); });
  $('#onlyOpen').addEventListener('change', e => { state.settings.onlyOpen = e.target.checked; saveSettings(); renderAll(); });
  $('#listFilter').addEventListener('input', () => { state.listLimit = 100; renderList(); });
  $('#moreBtn').addEventListener('click', () => { state.listLimit += 200; renderList(); });

  document.body.addEventListener('click', e => {
    const st = e.target.closest('[data-station]');
    if (st && !st.closest('.leaflet-popup')) openDetail(st.dataset.station);
    const show = e.target.closest('[data-area-show]');
    if (show) { state.settings.scope = show.dataset.areaShow; state.mapNeedsFit = true; saveSettings(); activateTab('overview'); renderAll(); }
    const del = e.target.closest('[data-area-del]');
    if (del) {
      const a = state.areas.find(x => x.id === del.dataset.areaDel);
      if (a && confirm(`Gebiet „${a.name}“ nicht mehr tracken? (Bereits erfasste Preise bleiben erhalten.)`)) {
        state.areas = state.areas.filter(x => x !== a); DB.del('areas', a.id); renderAll();
      }
    }
    if (e.target.closest('[data-open-settings]')) openSettings();
  });

  $$('.tab').forEach(t => t.addEventListener('click', () => activateTab(t.dataset.tab)));

  $('#refreshBtn').addEventListener('click', () => refreshAll(true));
  $('#autoRefresh').addEventListener('change', e => {
    state.settings.auto = e.target.checked; saveSettings(); scheduleAuto();
    toast(e.target.checked ? `Auto-Update alle ${state.settings.interval} Minuten aktiv (solange die Seite geöffnet ist).` : 'Auto-Update aus.');
  });
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#settingsForm').addEventListener('submit', e => {
    if (e.submitter?.value !== 'save') return;
    state.settings.apiKey = $('#apiKeyInput').value.trim();
    state.settings.interval = +$('#intervalInput').value;
    saveSettings(); scheduleAuto(); renderAll();
    if (state.areas.length) refreshAll(true);
  });
  $('#demoBtn').addEventListener('click', () => {
    state.settings.apiKey = DEMO_KEY; saveSettings(); renderAll();
    toast('Demo-Schlüssel aktiv – Preise sind Testwerte.');
  });
  $('#themeBtn').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    saveMeta('theme', root.dataset.theme);
    renderAll();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => renderAll());

  $('#scanBtn').addEventListener('click', () => scanGermany(false));
  $('#scanStopBtn').addEventListener('click', () => { state.scanStop = true; $('#scanStatus').textContent = 'Stoppe nach der aktuellen Anfrage …'; });
  $('#nationalAuto').addEventListener('change', e => { state.settings.nationalAuto = e.target.checked; saveSettings(); });

  $('#exportBtn').addEventListener('click', () => {
    download(`tankradar-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ version: 1, exported: Date.now(), stations: [...state.stations.values()], history: state.history, areas: state.areas }), 'application/json');
  });
  $('#exportCsvBtn').addEventListener('click', () => {
    const lines = ['zeit;tankstelle_id;name;marke;plz;ort;e5;e10;diesel'];
    for (const r of state.history) {
      const s = state.stations.get(r.sid) || {};
      const n = v => v == null ? '' : String(v).replace('.', ',');
      lines.push([new Date(r.ts).toISOString(), r.sid, `"${(s.name || '').replace(/"/g, '""')}"`, brandLabel(s.brand), s.postCode || '', `"${(s.place || '').replace(/"/g, '""')}"`, n(r.e5), n(r.e10), n(r.diesel)].join(';'));
    }
    download(`tankradar-preise-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + lines.join('\n'), 'text/csv');
  });
  $('#importInput').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try { const n = await importData(file); toast(`${n} Preisstände importiert.`); renderAll(); } catch (err) { toast('Import fehlgeschlagen: ' + err.message); }
    e.target.value = '';
  });
  $('#clearBtn').addEventListener('click', async () => {
    if (!confirm('Wirklich alle gespeicherten Tankstellen, Preisverläufe und Gebiete löschen?')) return;
    await DB.clear();
    state.stations.clear(); state.history = []; state.areas = [];
    saveMeta('national', null); saveMeta('lastUpdate', 0);
    renderScanStatus(); renderAll(); toast('Alle Daten gelöscht.');
  });
}

function activateTab(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.tabpanel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'overview' && state.map) setTimeout(() => state.map.invalidateSize(), 0);
  if (name === 'stats') renderStats();
}

function openSettings() {
  $('#apiKeyInput').value = state.settings.apiKey || '';
  $('#intervalInput').value = String(state.settings.interval);
  $('#settingsDlg').showModal();
}

/* ================= Start ================= */
async function init() {
  loadSettings();
  const theme = loadMeta('theme', null);
  if (theme) document.documentElement.dataset.theme = theme;
  $('#onlyOpen').checked = state.settings.onlyOpen;
  $('#ageSelect').value = String(state.settings.maxAge);
  $('#autoRefresh').checked = !!state.settings.auto;
  $('#nationalAuto').checked = !!state.settings.nationalAuto;
  bindEvents();
  initMap();
  try {
    await DB.open();
    const [stations, prices, areas] = await Promise.all([DB.all('stations'), DB.all('prices'), DB.all('areas')]);
    stations.forEach(s => state.stations.set(s.id, s));
    state.history = prices.sort((a, b) => a.ts - b.ts);
    state.areas = areas;
  } catch (e) {
    console.warn(e);
    toast('Lokaler Speicher nicht verfügbar – Daten gehen beim Schließen verloren.', 6000);
  }
  await purgeFlatDemoPrices();
  if (!window.Chart) toast('Diagramm-Bibliothek konnte nicht geladen werden (Internet nötig).', 6000);
  renderScanStatus();
  renderAll();
  scheduleAuto();
  // Beim Öffnen sofort aktualisieren, wenn der letzte Stand älter als das Intervall ist
  const last = loadMeta('lastUpdate', 0);
  if (state.settings.auto && state.areas.length && Date.now() - last > state.settings.interval * 60000) refreshAll(false);
  // Status-Zeile ("vor x Min.") aktuell halten
  setInterval(renderStatus, 60000);
}

init();
