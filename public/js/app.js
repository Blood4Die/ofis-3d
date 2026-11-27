import { STATUSES, TASK_STATES, MOODS, AVATAR_OPTS, DEFAULT_AVATAR, VAPID_PUBLIC } from './config.js';
import { SupabaseBackend, DemoBackend, todayStr } from './data.js';
import { Office, AvatarPreview } from './office.js';
import { initExt } from './ext.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = (iso) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (d) => d ? new Date(d + 'T00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : '';

const isDemo = new URLSearchParams(location.search).has('demo');
const api = isDemo ? new DemoBackend() : new SupabaseBackend();

const S = { names: new Map(), cat: '', msgs: [], chatOpen: false, chatWith: null, me: null, profiles: new Map(), tasks: new Map(), online: new Set(), tab: 'bugun', onlyMine: false, selected: null, started: false };
const office = new Office($('#scene'), { onAvatarClick: (id) => selectPerson(id), onFloorsChanged: () => renderFloors() });
let preview = null;

// ---------------------------------------------------------------- Yardımcılar
const meP = () => S.profiles.get(S.me);
const nameOf = (id) => S.profiles.get(id)?.display_name ?? S.names.get(id) ?? '—';
const canEdit = (t) => { const m = meP(); return !!m && (t.assignee === S.me || t.created_by === S.me || m.is_admin); };
const canDelete = (t) => { const m = meP(); return !!m && (t.created_by === S.me || m.is_admin); };
function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 4200);
  return el;
}
async function guard(fn) {
  try { await fn(); } catch (e) { console.error(e); toast('⚠️ ' + (e.message || 'İşlem başarısız')); }
}
const openCount = (id) => [...S.tasks.values()].filter((t) => t.assignee === id && t.state !== 'bitti').length;
let ext = null; // initExt aşağıda, yardımcılar tanımlandıktan sonra

// ---------------------------------------------------------------- Giriş
$$('.auth-tabs button').forEach((b) => b.onclick = () => {
  $$('.auth-tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $('#loginForm').hidden = b.dataset.auth !== 'login';
  $('#signupForm').hidden = b.dataset.auth !== 'signup';
  $('#authErr').hidden = true;
});
function authErr(msg) { const e = $('#authErr'); e.textContent = msg; e.hidden = false; }
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  try { await api.signIn(f.get('email'), f.get('password')); await start(); } catch (err) { authErr(err.message); }
};
$('#signupForm').onsubmit = async (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  const btn = e.target.querySelector('button'); btn.disabled = true;
  try { await api.signUp(Object.fromEntries(f)); await start(); } catch (err) { authErr(err.message); } finally { btn.disabled = false; }
};
if (isDemo) {
  $('#demoTag').hidden = false;
  $('[data-auth="signup"]').click();
  $('#signupForm [name=email]').remove(); $('#signupForm [name=password]').remove(); $('#signupForm [name=code]').remove();
  $('[data-auth="login"]').hidden = true;
  $('#auth .small').innerHTML = 'Demo: veri yalnız bu tarayıcıda. Aynı adresi birkaç sekmede aç, farklı adlarla gir. <a href="./">Gerçek sisteme dön</a>';
}
$('#logoutBtn').onclick = async () => { await api.signOut(); location.reload(); };

// ---------------------------------------------------------------- Başlat
async function start() {
  if (S.started) return;
  S.me = api.user.id;
  await reloadAll(false);
  if (!meP()) { authErr('Profil bulunamadı veya hesabın pasif. Yöneticiye başvur.'); await api.signOut(); return; }
  S.started = true;
  $('#auth').hidden = true;
  ['#topbar', '#teamPanel', '#taskPanel', '#mobileTabs', '#fitBtnDesk'].forEach((s) => $(s).hidden = false);
  buildStatusPicker(); renderMe(); renderFloors();
  if (!meP().avatar || !Object.keys(meP().avatar).length) { selectPerson(S.me, false); toast('👋 Hoş geldin! Önce avatarını oluştur.'); }
  api.subscribe({
    onProfile: onProfileChange, onTask: onTaskChange, onActivity: (row) => addFeed(row, true),
    onPresence: (set) => { S.online = set; refreshOnline(); },
    onMessage: onMessage,
    onTable: (t, c) => ext.onTable(t, c),
    onConnection: (state, wasReconnect) => {
      $('#conn').classList.toggle('off', state !== 'online');
      $('#offlineBanner').hidden = state === 'online';
      if (state === 'online' && wasReconnect) reloadAll(true).catch(console.error);
    },
  });
  setInterval(tickClock, 15000); tickClock();
  initPush().catch(console.warn);
  await ext.load().catch(console.warn);
  handleDeepLink(new URL(location.href));
}

async function reloadAll(animate) {
  const data = await api.loadAll();
  data.profiles.forEach((p) => S.names.set(p.id, p.display_name));
  const act = data.profiles.filter((p) => p.active !== false), ids = new Set(act.map((p) => p.id));
  S.profiles.forEach((_, id) => { if (!ids.has(id)) { S.profiles.delete(id); office.removePerson(id); } });
  act.forEach((p) => { S.profiles.set(p.id, p); });
  S.tasks = new Map(data.tasks.map((t) => [t.id, t]));
  S.profiles.forEach((p) => office.upsertPerson(p, { animate, online: S.online.has(p.id), openTasks: openCount(p.id), isMe: p.id === S.me }));
  $('#feed').innerHTML = ''; data.activity.forEach((r) => addFeed(r, false));
  try { S.msgs = await api.loadMessages(); } catch (e) { console.error(e); }
  renderChat();
  renderTeam(); renderTasks(); renderAssigneeSelect();
}

// ---------------------------------------------------------------- Canlı olaylar
function onProfileChange({ type, row, old }) {
  if (row?.id) S.names.set(row.id, row.display_name);
  if (type === 'DELETE' || row?.active === false) { const id = old?.id || row.id; S.profiles.delete(id); office.removePerson(id); if (id === S.me) { alert('Hesabın pasife alındı.'); api.signOut().then(() => location.reload()); return; } }
  else {
    S.profiles.set(row.id, row);
    office.upsertPerson(row, { animate: true, online: S.online.has(row.id), openTasks: openCount(row.id), isMe: row.id === S.me });
  }
  renderTeam(); renderTasks(); renderAssigneeSelect();
  if (row?.id === S.me) { buildStatusPicker(); renderMe(); }
  if (S.selected && S.selected !== S.me && (row?.id === S.selected || old?.id === S.selected)) selectPerson(S.selected, false);
}

function onTaskChange({ type, row, old }) {
  const prev = S.tasks.get(type === 'DELETE' ? old.id : row.id);
  if (type === 'DELETE') S.tasks.delete(old.id); else S.tasks.set(row.id, row);
  const t = type === 'DELETE' ? prev : row;
  if (type !== 'DELETE' && row.state === 'bitti' && prev?.state !== 'bitti' && prev) {
    office.celebrate(row.assignee || row.created_by);
  }
  if (type !== 'DELETE' && row.assignee === S.me && row.created_by !== S.me && (!prev || prev.assignee !== S.me)) {
    toast(`📌 ${nameOf(row.created_by)} sana görev atadı: ${row.title}`);
  }
  const affected = new Set([t?.assignee, prev?.assignee].filter(Boolean));
  affected.forEach((id) => office.setTaskCount(id, openCount(id)));
  renderTeam(); renderTasks(); ext.refreshTask();
  if (S.selected && S.selected !== S.me) selectPerson(S.selected, false);
}

function refreshOnline() {
  S.profiles.forEach((p) => office.setOnline(p.id, S.online.has(p.id)));
  renderTeam();
}

// ---------------------------------------------------------------- Üst çubuk
function buildStatusPicker() {
  const me = meP(); const box = $('#statusPicker'); box.innerHTML = '';
  Object.entries(STATUSES).forEach(([k, s]) => {
    const b = document.createElement('button');
    b.innerHTML = me.status === k ? `<span>${s.icon}</span>${s.label}` : `<span>${s.icon}</span>`; b.title = s.label;
    if (me.status === k) { b.classList.add('active'); b.style.background = s.color; }
    b.onclick = () => guard(() => api.updateProfile({ status: k, status_note: $('#statusNote').value.trim() }));
    box.appendChild(b);
  });
  if (document.activeElement !== $('#statusNote')) $('#statusNote').value = me.status_note || '';
  const mb = $('#moodPicker'); mb.innerHTML = '';
  Object.entries(MOODS).forEach(([k, m]) => {
    const b = document.createElement('button'); b.textContent = m.icon; b.title = 'Duygu durumu: ' + m.label;
    b.classList.toggle('active', (me.mood || 'normal') === k);
    b.onclick = () => guard(() => api.updateProfile({ mood: k }));
    mb.appendChild(b);
  });
}

// ---------------------------------------------------------------- Katlar
function renderFloors() {
  const box = $('#floorTabs'); if (!box) return;
  const floors = office.floorList;
  box.hidden = floors.length < 2 || !S.started;
  if (box.hidden) return;
  const cnt = office.floorCounts();
  box.innerHTML = floors.map((f) => `<button data-f="${esc(f.id)}" class="${office.active === f.id ? 'active' : ''}">${esc(f.name)} <span class="muted">${cnt[f.id] || 0}</span></button>`).join('');
  $$('#floorTabs button').forEach((b) => b.onclick = () => { office.setFloor(b.dataset.f); office.fitView(); });
}
$('#statusNote').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#statusNote').addEventListener('change', (e) => guard(() => api.updateProfile({ status_note: e.target.value.trim() })));
function renderMe() { const m = meP(); $('#meBtn').innerHTML = `<span class="dot" style="display:inline-block;background:${esc(m.color)}"></span> ${esc(m.display_name)}`; }
$('#meBtn').onclick = () => selectPerson(S.me);
function tickClock() { $('#clock').textContent = new Date().toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }

// ---------------------------------------------------------------- Ekip
function renderTeam() {
  const list = [...S.profiles.values()].sort((a, b) => (S.online.has(b.id) - S.online.has(a.id)) || a.display_name.localeCompare(b.display_name, 'tr'));
  $('#onlineCount').textContent = `${list.filter((p) => S.online.has(p.id)).length}/${list.length} çevrimiçi`;
  $('#teamList').innerHTML = list.map((p) => {
    const s = STATUSES[p.status] ?? STATUSES.musait, n = openCount(p.id), on = S.online.has(p.id);
    return `<li data-id="${esc(p.id)}" class="${on ? '' : 'off'} ${S.selected === p.id ? 'sel' : ''}" title="${on ? 'Çevrimiçi' : 'Çevrimdışı'}">
      <span class="dot" style="background:${esc(p.color)};${on ? '' : 'opacity:.35'}"></span>
      <span class="mood" title="${esc(MOODS[p.mood || 'normal']?.label)}">${MOODS[p.mood || 'normal']?.icon ?? ''}</span><span class="nm">${esc(p.display_name)}${p.id === S.me ? ' <span class="muted">(sen)</span>' : ''}${ext?.leaveToday(p.id) ? ' <span title="Bugün izinli">🏖️</span>' : ''}</span>
      ${n ? `<span class="cnt">${n} iş</span>` : ''}
      <span class="chip" style="background:${s.color}">${s.icon} ${s.label}</span></li>`;
  }).join('');
  $$('#teamList li').forEach((li) => li.onclick = () => selectPerson(li.dataset.id));
}

function addFeed(row, isNew) {
  const ul = $('#feed');
  const li = document.createElement('li');
  li.innerHTML = `<time>${hhmm(row.created_at)}</time>${esc(row.message)}`;
  if (isNew) li.classList.add('new');
  ul.prepend(li);
  while (ul.children.length > 50) ul.lastChild.remove();
}

// ---------------------------------------------------------------- Kişi kartı
function selectPerson(id, focus = true) {
  S.selected = id;
  office.setHighlight(id);
  const card = $('#personCard');
  if (!id || !S.profiles.has(id)) { card.hidden = true; S.selected = null; preview?.dispose(); preview = null; renderTeam(); return; }
  const p = S.profiles.get(id), s = STATUSES[p.status] ?? STATUSES.musait;
  if (focus) office.focus(id);
  if (window.innerWidth <= 900) $$('.panel').forEach((x) => x.classList.remove('open'));
  const tasks = [...S.tasks.values()].filter((t) => t.assignee === id && t.state !== 'bitti');
  const self = id === S.me;
  const takenDesks = new Set([...S.profiles.values()].filter((x) => x.id !== id).map((x) => x.desk_no));
  card.innerHTML = `<button class="x" title="Kapat">×</button>
    <h4><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.display_name)}
      <span class="chip" style="background:${s.color}">${s.icon} ${s.label}</span></h4>
    <div class="muted small">${MOODS[p.mood || 'normal'].icon} ${MOODS[p.mood || 'normal'].label} · ${p.status_note ? esc(p.status_note) + ' · ' : ''}${esc(office.deskName(p.desk_no))} · ${S.online.has(id) ? 'çevrimiçi' : 'çevrimdışı'} · son güncelleme ${hhmm(p.updated_at)}</div>
    ${!self ? `<button class="primary msg-btn" id="msgBtn">💬 Mesaj gönder</button>` : ''}
    ${tasks.length ? `<ul>${tasks.map((t) => `<li>${t.state === 'suruyor' ? '▶️' : '⏳'} ${esc(t.title)}${t.due_date ? ` <span class="muted small">${fmtDate(t.due_date)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">Açık görevi yok.</p>'}
    ${self ? editorHtml(p, takenDesks) : ''}`;
  card.hidden = false;
  card.querySelector('.x').onclick = () => selectPerson(null);
  const mb = $('#msgBtn'); if (mb) mb.onclick = () => { selectPerson(null); openChat(id); };
  preview?.dispose(); preview = null;
  const pf = $('#profForm');
  if (pf) {
    preview = new AvatarPreview($('#avPrev'));
    const draft = () => {
      const f = new FormData(pf);
      return { ...p, display_name: f.get('display_name').trim() || p.display_name, color: f.get('color'), desk_no: Number(f.get('desk_no')),
        avatar: { skin: f.get('skin'), hair: f.get('hair'), hairColor: f.get('hairColor'), extra: f.get('extra') } };
    };
    preview.show(draft());
    pf.oninput = pf.onchange = () => preview.show(draft());
    pf.onsubmit = (e) => {
      e.preventDefault(); const d = draft();
      guard(async () => { await api.updateProfile({ display_name: d.display_name, color: d.color, desk_no: d.desk_no, avatar: d.avatar, email_opt_out: !!pf.email_opt_out?.checked }); toast('Profil kaydedildi'); });
    };
  }
  renderTeam();
}

function editorHtml(p, takenDesks) {
  const av = { ...DEFAULT_AVATAR, ...(p.avatar || {}) };
  const swatches = (name, list, cur) => `<div class="sw">${list.map((c) => `<label><input type="radio" name="${name}" value="${c}" ${c === cur ? 'checked' : ''}/><i style="background:${c}"></i></label>`).join('')}</div>`;
  const opts = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('');
  return `<form class="editor" id="profForm">
    <canvas id="avPrev" width="220" height="260"></canvas>
    <div class="ed-fields">
      <input name="display_name" maxlength="40" value="${esc(p.display_name)}" required />
      <div class="ed-row"><span>Ten</span>${swatches('skin', AVATAR_OPTS.skin, av.skin)}</div>
      <div class="ed-row"><span>Saç</span><select name="hair">${opts(AVATAR_OPTS.hair, av.hair)}</select></div>
      <div class="ed-row"><span>Saç rengi</span>${swatches('hairColor', AVATAR_OPTS.hairColor, av.hairColor)}</div>
      <div class="ed-row"><span>Aksesuar</span><select name="extra">${opts(AVATAR_OPTS.extra, av.extra)}</select></div>
      <div class="ed-row"><span>Kıyafet</span><input name="color" type="color" value="${esc(p.color)}" /></div>
      <div class="ed-row"><span>Masa</span><select name="desk_no">${office.deskNumbers.map((n) =>
        `<option value="${n}" ${n === p.desk_no ? 'selected' : ''} ${takenDesks.has(n) ? 'disabled' : ''}>${esc(office.deskName(n))}${takenDesks.has(n) ? ' (dolu)' : ''}</option>`).join('')}</select></div>
      <label class="ed-row"><span>E-posta</span><span><input type="checkbox" name="email_opt_out" ${p.email_opt_out ? 'checked' : ''}/> Görev e-postası istemiyorum</span></label>
      <button class="primary" type="submit">Kaydet</button>
    </div></form>`;
}

// ---------------------------------------------------------------- Sohbet
const READ_KEY = () => 'ofis3d-read-' + S.me;
const lastRead = () => { try { return JSON.parse(localStorage.getItem(READ_KEY()) || '{}'); } catch { return {}; } };
function markRead(key) { const r = lastRead(); r[key] = new Date().toISOString(); try { localStorage.setItem(READ_KEY(), JSON.stringify(r)); } catch {} }
const convKey = (m) => (m.recipient ? (m.sender === S.me ? m.recipient : m.sender) : 'genel');
function unreadCount(key) {
  const r = lastRead()[key] || '1970';
  return S.msgs.filter((m) => convKey(m) === key && m.sender !== S.me && m.created_at > r).length;
}
function updateBadges() {
  const keys = ['genel', ...S.profiles.keys()].filter((k) => k !== S.me);
  const total = keys.reduce((n, k) => n + unreadCount(k), 0);
  [['#chatBadge'], ['#chatBadgeM']].forEach(([sel]) => { const b = $(sel); b.hidden = !total; b.textContent = total > 99 ? '99+' : total; });
  if (!total) { $('#chatBtn').classList.remove('ring'); $('#chatBtnM').classList.remove('ring'); }
}
function openChat(key) {
  S.chatOpen = true; S.chatWith = key ?? null;
  $('#chatPanel').hidden = false; renderNotifSettings();
  $$('#notifs .notif').forEach((n) => n.remove());
  if (window.innerWidth <= 900) $$('.panel').forEach((x) => x.classList.remove('open'));
  renderChat();
  if (S.chatWith) setTimeout(() => $('#chatForm [name=body]').focus(), 50);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') renderChat(); });
function closeChat() { S.chatOpen = false; $('#chatPanel').hidden = true; }
$('#chatBtn').onclick = $('#chatBtnM').onclick = () => (S.chatOpen ? closeChat() : openChat(null));
$('#chatClose').onclick = closeChat;
$('#chatBack').onclick = () => { S.chatWith = null; renderChat(); };
$('#chatForm').onsubmit = (e) => {
  e.preventDefault();
  const inp = e.target.body, body = inp.value.trim(); if (!body || !S.chatWith) return;
  const urgent = e.target.urgent.checked;
  inp.value = ''; e.target.urgent.checked = false;
  guard(() => api.sendMessage(S.chatWith === 'genel' ? null : S.chatWith, body, urgent));
};

function renderChat() {
  if (!S.me) return;
  updateBadges();
  if (!S.chatOpen) return;
  const list = $('#chatList'), thread = $('#chatThread'), form = $('#chatForm');
  const inThread = !!S.chatWith;
  list.hidden = inThread; thread.hidden = form.hidden = !inThread; $('#chatBack').hidden = !inThread;
  if (!inThread) {
    $('#chatTitle').textContent = 'Sohbet';
    const last = {}; S.msgs.forEach((m) => { last[convKey(m)] = m; });
    const people = [...S.profiles.values()].filter((p) => p.id !== S.me)
      .sort((a, b) => (last[b.id]?.created_at || '').localeCompare(last[a.id]?.created_at || '') || a.display_name.localeCompare(b.display_name, 'tr'));
    const row = (key, title, dot, sub) => {
      const n = unreadCount(key), lm = last[key];
      return `<li data-k="${esc(key)}"><span class="dot" style="background:${dot}"></span><div class="cl-main"><b>${title}</b>
        <span class="muted">${lm ? esc((lm.sender === S.me ? 'Sen: ' : (key === 'genel' ? nameOf(lm.sender) + ': ' : '')) + lm.body) : sub}</span></div>
        ${lm ? `<time>${hhmm(lm.created_at)}</time>` : ''}${n ? `<span class="badge">${n}</span>` : ''}</li>`;
    };
    list.innerHTML = row('genel', '📢 Genel (herkes)', '#1d2433', 'Herkese mesaj gönder') +
      people.map((p) => row(p.id, esc(p.display_name) + (S.online.has(p.id) ? ' <span class="on">●</span>' : ''), esc(p.color), STATUSES[p.status]?.label ?? '')).join('');
    $$('#chatList li').forEach((li) => li.onclick = () => openChat(li.dataset.k));
    return;
  }
  const key = S.chatWith;
  $('#chatTitle').textContent = key === 'genel' ? '📢 Genel sohbet' : nameOf(key);
  const msgs = S.msgs.filter((m) => convKey(m) === key);
  let prevDay = '';
  thread.innerHTML = msgs.length ? msgs.map((m) => {
    const mine = m.sender === S.me, d = new Date(m.created_at).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
    const sep = d !== prevDay ? `<li class="day">${d}</li>` : ''; prevDay = d;
    return `${sep}<li class="${mine ? 'mine' : ''} ${m.urgent ? 'urgent' : ''}">${!mine && key === 'genel' ? `<span class="who" style="color:${esc(S.profiles.get(m.sender)?.color || '#555')}">${esc(nameOf(m.sender))}</span>` : ''}
      <span class="txt">${m.urgent ? '🚨 ' : ''}${esc(m.body)}</span><time>${hhmm(m.created_at)}</time></li>`;
  }).join('') : '<li class="empty">Henüz mesaj yok. İlk mesajı sen yaz 👋</li>';
  thread.scrollTop = thread.scrollHeight;
  markRead(key); updateBadges();
}

function onMessage(m) {
  if (S.msgs.some((x) => x.id === m.id)) return;
  S.msgs.push(m); if (S.msgs.length > 600) S.msgs.shift();
  const key = convKey(m), mine = m.sender === S.me;
  if (!m.recipient) office.say(m.sender, m.body);
  else if (!mine) office.say(m.sender, '', { private: true, ms: 4000 });
  const viewing = S.chatOpen && S.chatWith === key && document.visibilityState === 'visible';
  if (!mine && m.urgent) showUrgent(m, key);
  else if (!mine && !viewing) notify(m, key);
  renderChat();
}

// ---------------------------------------------------------------- Bildirimler (ses + yanıp sönen kart + sekme başlığı + sistem bildirimi)
const MUTE_KEY = 'ofis3d-mute';
let audioCtx = null, titleTimer = null;
const baseTitle = document.title;
const isMuted = () => localStorage.getItem(MUTE_KEY) === '1';
// Tarayıcılar sesi ancak bir kullanıcı etkileşiminden sonra çalar: ilk tıklamada ses motorunu aç
window.addEventListener('pointerdown', () => {
  if (!audioCtx) try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  audioCtx?.resume?.();
}, { passive: true });
function chime(priv) {
  if (isMuted() || !audioCtx) return;
  const t0 = audioCtx.currentTime, notes = priv ? [880, 1175, 1568] : [660, 880];
  notes.forEach((f, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.12); g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.12 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.12 + 0.35);
    o.connect(g).connect(audioCtx.destination); o.start(t0 + i * 0.12); o.stop(t0 + i * 0.12 + 0.4);
  });
  navigator.vibrate?.(priv ? [120, 60, 120] : 80);
}
function flashTitle() {
  if (titleTimer) return;
  let on = false;
  titleTimer = setInterval(() => {
    const n = Number($('#chatBadge').textContent) || 0;
    if (!n || document.visibilityState === 'visible') { clearInterval(titleTimer); titleTimer = null; document.title = baseTitle; return; }
    on = !on; document.title = on ? `(${n}) 💬 Yeni mesaj` : baseTitle;
  }, 1000);
}
function notify(m, key) {
  const priv = !!m.recipient, p = S.profiles.get(m.sender);
  chime(priv);
  // Yanıp sönen bildirim kartı: tıklayınca sohbet açılır ve kart kapanır
  const box = $('#notifs'), el = document.createElement('div');
  el.className = 'notif ' + (priv ? 'priv' : 'pub');
  el.innerHTML = `<span class="dot" style="background:${esc(p?.color || '#888')}"></span>
    <div class="n-main"><b>${esc(nameOf(m.sender))}${priv ? ' · özel mesaj' : ' · Genel'}</b><span>${esc(m.body.slice(0, 140))}</span></div>
    <button class="n-x" title="Kapat">×</button>`;
  el.onclick = (e) => { el.remove(); if (!e.target.classList.contains('n-x')) openChat(key); };
  box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
  if (!priv) setTimeout(() => el.remove(), 9000);          // genel mesaj kartı kendiliğinden kapanır, özel mesaj tıklanana kadar kalır
  $('#chatBtn').classList.add('ring'); $('#chatBtnM').classList.add('ring');
  flashTitle();
  // Sekme arka plandaysa sistem bildirimi
  if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(`${nameOf(m.sender)}${priv ? ' (özel)' : ' (Genel)'}`, { body: m.body.slice(0, 140), tag: 'ofis3d-' + key, renotify: true });
      n.onclick = () => { window.focus(); openChat(key); n.close(); };
    } catch {}
  }
}
function renderNotifSettings() {
  const b = $('#muteBtn'); b.textContent = isMuted() ? '🔕' : '🔔'; b.title = isMuted() ? 'Sesi aç' : 'Sesi kapat';
  pushState().then((st) => {
    $('#notifAsk').hidden = true;
    const bar = $('#pushBar');
    const msg = {
      on: '',
      off: '🔔 Uygulama kapalıyken de bildirim almak için <button class="link" id="pushOn">bildirimleri aç</button>',
      denied: '🔕 Bildirimler bu tarayıcıda engellenmiş. Adres çubuğundaki kilit simgesinden "Bildirimler: İzin ver" yapıp sayfayı yenile.',
      ios: '📱 iPhone\'da bildirim için: Safari\'de <b>Paylaş → Ana Ekrana Ekle</b>, sonra uygulamayı ana ekrandan açıp bildirimleri aç.',
      unsupported: 'Bu tarayıcı arka plan bildirimlerini desteklemiyor.',
      demo: '',
    }[st];
    bar.innerHTML = msg; bar.hidden = !msg;
    const b2 = $('#pushOn'); if (b2) b2.onclick = () => guard(enablePush);
  });
}
$('#muteBtn').onclick = () => { localStorage.setItem(MUTE_KEY, isMuted() ? '0' : '1'); renderNotifSettings(); if (!isMuted()) chime(false); };
$('#notifAsk').onclick = () => guard(enablePush);

// ---------------------------------------------------------------- Web Push (uygulama kapalıyken bildirim)
let swReg = null;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; }).catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open') handleDeepLink(new URL(e.data.url)); });
}
function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4), raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function pushState() {
  if (isDemo) return 'demo';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return isIOS && !standalone ? 'ios' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = swReg || await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { renderNotifSettings(); throw new Error('Bildirim izni verilmedi'); }
  const reg = swReg || await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
  await api.savePush(sub);
  toast('🔔 Bildirimler açık — uygulama kapalıyken de mesaj ve görev bildirimi alacaksın');
  renderNotifSettings(); $('#pushPrompt')?.remove();
}
// Giriş sonrası: izin zaten verilmişse aboneliği sessizce tazele; verilmemişse bir kez hatırlat
async function initPush() {
  const st = await pushState();
  if (st === 'on') { try { const reg = swReg || await navigator.serviceWorker.ready; await api.savePush(await reg.pushManager.getSubscription()); } catch (e) { console.warn(e); } }
  else if (st === 'off' || st === 'ios') {
    const el = document.createElement('div'); el.className = 'notif pub prompt'; el.id = 'pushPrompt';
    el.innerHTML = `<span style="font-size:22px">🔔</span><div class="n-main"><b>Bildirimleri aç</b><span>${st === 'ios' ? 'Paylaş → Ana Ekrana Ekle, sonra uygulamadan aç' : 'Uygulama kapalıyken de acil mesaj ve görevleri gör'}</span></div>
      ${st === 'off' ? '<button class="primary">Aç</button>' : ''}<button class="n-x" title="Kapat">×</button>`;
    el.onclick = (e) => { if (e.target.classList.contains('primary')) guard(enablePush); if (e.target.classList.contains('n-x')) el.remove(); };
    $('#notifs').prepend(el);
  }
}
function handleDeepLink(url) {
  const c = url.searchParams.get('chat'), t = url.searchParams.get('task');
  if (c && S.started) openChat(c === 'genel' ? 'genel' : c);
  if (t && S.started) ext.openTask(Number(t));
}

// ---------------------------------------------------------------- Acil mesaj: tam ekran uyarı + tekrarlayan alarm
let urgentTimer = null;
function showUrgent(m, key) {
  const ov = $('#urgentOverlay'), p = S.profiles.get(m.sender);
  ov.innerHTML = `<div class="u-box"><div class="u-icon">🚨</div><div class="u-title">ACİL MESAJ</div>
    <div class="u-from"><span class="dot" style="background:${esc(p?.color || '#888')}"></span>${esc(nameOf(m.sender))}${m.recipient ? '' : ' · Genel'}</div>
    <div class="u-body">${esc(m.body)}</div>
    <div class="u-actions"><button class="ghost u-ok">Gördüm</button><button class="primary u-reply">Yanıtla</button></div></div>`;
  ov.hidden = false;
  const stop = () => { ov.hidden = true; clearInterval(urgentTimer); urgentTimer = null; };
  ov.querySelector('.u-ok').onclick = () => { stop(); markRead(key); updateBadges(); };
  ov.querySelector('.u-reply').onclick = () => { stop(); openChat(key); };
  clearInterval(urgentTimer);
  const ring = () => { const was = isMuted(); if (!was) { chime(true); setTimeout(() => chime(true), 450); } };
  ring(); urgentTimer = setInterval(ring, 2500);
  flashTitle();
  if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification('🚨 ACİL · ' + nameOf(m.sender), { body: m.body, requireInteraction: true, tag: 'urgent-' + m.id }); n.onclick = () => { window.focus(); n.close(); }; } catch {}
  }
}

// ---------------------------------------------------------------- Görevler
$$('#taskPanel .tabs button').forEach((b) => b.onclick = () => {
  S.tab = b.dataset.tab; $$('#taskPanel .tabs button').forEach((x) => x.classList.toggle('active', x === b)); renderTasks();
});
$('#onlyMine').onchange = (e) => { S.onlyMine = e.target.checked; renderTasks(); };

function visibleTasks() {
  const today = todayStr(), weekAgo = Date.now() - 7 * 864e5;
  let list = [...S.tasks.values()];
  if (S.onlyMine) list = list.filter((t) => t.assignee === S.me || (!t.assignee && t.created_by === S.me));
  if (S.cat) list = list.filter((t) => t.category === S.cat);
  if (S.tab === 'bugun') {
    list = list.filter((t) => t.kind === 'gunluk' && (t.state !== 'bitti' ? (!t.due_date || t.due_date <= today) : (t.done_at && new Date(t.done_at).toLocaleDateString('sv-SE') === today)));
    list.sort((a, b) => (a.state === 'bitti') - (b.state === 'bitti') || (b.assignee === S.me) - (a.assignee === S.me) || a.priority - b.priority);
  } else if (S.tab === 'planli') {
    list = list.filter((t) => t.state !== 'bitti' && (t.kind === 'planli' || (t.due_date && t.due_date > today)));
    list.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.priority - b.priority);
  } else {
    list = list.filter((t) => t.state === 'bitti' && t.done_at && new Date(t.done_at).getTime() > weekAgo);
    list.sort((a, b) => b.done_at.localeCompare(a.done_at));
  }
  return list;
}

function renderTasks() {
  if (!S.me) return;
  const today = todayStr(), list = visibleTasks(), ul = $('#taskList');
  if (!list.length) { ul.innerHTML = `<li class="empty" style="display:block">${S.tab === 'biten' ? 'Son 7 günde biten görev yok.' : 'Görev yok. Aşağıdan ekleyebilirsin.'}</li>`; return; }
  const people = [...S.profiles.values()].sort((a, b) => a.display_name.localeCompare(b.display_name, 'tr'));
  ul.innerHTML = list.map((t) => {
    const ed = canEdit(t), late = t.state !== 'bitti' && t.due_date && t.due_date < today;
    const asg = ed ? `<select class="asg" data-id="${t.id}"><option value="">Atanmamış</option>${people.map((p) => `<option value="${esc(p.id)}" ${p.id === t.assignee ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select>`
      : `<span>👤 ${esc(t.assignee ? nameOf(t.assignee) : 'Atanmamış')}</span>`;
    return `<li class="${t.state === 'bitti' ? 'done' : ''}">
      <button class="st ${t.state}" data-id="${t.id}" ${ed ? '' : 'disabled'} title="${TASK_STATES[t.state].label} → ${TASK_STATES[TASK_STATES[t.state].next].label}">${t.state === 'bitti' ? '✓' : t.state === 'suruyor' ? '▶' : ''}</button>
      <div><div class="tt" data-open="${t.id}">${t.priority === 1 ? '<span class="p1">❗</span> ' : ''}${esc(t.title)}</div>
        <div class="meta">${asg}${t.due_date ? `<span class="${late ? 'late' : ''}">📅 ${fmtDate(t.due_date)}${late ? ' (gecikti)' : ''}</span>` : ''}
        <span>${TASK_STATES[t.state].label}</span>${t.created_by !== t.assignee ? `<span>✍️ ${esc(nameOf(t.created_by))}</span>` : ''}${ext ? ext.taskMeta(t) : ''}</div></div>
      ${canDelete(t) ? `<button class="del" data-id="${t.id}" title="Sil">🗑</button>` : '<span></span>'}</li>`;
  }).join('');
  $$('#taskList .st').forEach((b) => b.onclick = () => {
    const t = S.tasks.get(Number(b.dataset.id)) ?? S.tasks.get(b.dataset.id);
    guard(() => api.updateTask(t.id, { state: TASK_STATES[t.state].next }));
  });
  $$('#taskList [data-open]').forEach((el) => el.onclick = () => ext.openTask(Number(el.dataset.open)));
  renderCatFilter();
  $$('#taskList .asg').forEach((s) => s.onchange = () => {
    const id = Number(s.dataset.id);
    guard(() => api.updateTask(id, { assignee: s.value || null }));
  });
  $$('#taskList .del').forEach((b) => b.onclick = () => {
    const t = S.tasks.get(Number(b.dataset.id));
    if (confirm(`"${t.title}" silinsin mi? Bu geri alınamaz.`)) guard(() => api.deleteTask(t.id));
  });
}

function renderCatFilter() {
  const sel = $('#catFilter'); if (!sel || !ext) return;
  const cats = ext.categories(), cur = S.cat;
  sel.innerHTML = '<option value="">Tüm kategoriler</option>' + cats.map((c) => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
  sel.hidden = !cats.length;
}
$('#catFilter').onchange = (e) => { S.cat = e.target.value; renderTasks(); };

function renderAssigneeSelect() {
  const sel = $('#taskForm [name=assignee]'), cur = sel.value || S.me;
  sel.innerHTML = [...S.profiles.values()].sort((a, b) => a.display_name.localeCompare(b.display_name, 'tr'))
    .map((p) => `<option value="${esc(p.id)}">${esc(p.display_name)}${p.id === S.me ? ' (ben)' : ''}</option>`).join('') + '<option value="">Atanmamış</option>';
  sel.value = S.profiles.has(cur) ? cur : S.me;
}
$('#taskForm [name=kind]').onchange = (e) => { const d = $('#taskForm [name=due_date]'); if (e.target.value === 'gunluk' && !d.value) d.value = todayStr(); };
$('#taskForm [name=due_date]').value = todayStr();
$('#taskForm').onsubmit = (e) => {
  e.preventDefault(); const f = new FormData(e.target);
  const task = { title: f.get('title').trim(), kind: f.get('kind'), assignee: f.get('assignee') || null,
    due_date: f.get('due_date') || null, priority: Number(f.get('priority')), category: (f.get('category') || '').trim() || null };
  if (!task.title) return;
  guard(async () => { await api.addTask(task); e.target.title.value = ''; e.target.title.focus(); ext.renderCatList(); });
};

// ---------------------------------------------------------------- Mobil
$('#fitBtn').onclick = $('#fitBtnDesk').onclick = () => { $$('.panel').forEach((x) => x.classList.remove('open')); office.fitView(); };
$$('#mobileTabs button[data-panel]').forEach((b) => b.onclick = () => {
  const p = $('#' + b.dataset.panel), open = !p.classList.contains('open');
  $$('.panel').forEach((x) => x.classList.remove('open')); if (open) p.classList.add('open');
});

// ---------------------------------------------------------------- Genişletilmiş özellikler
ext = initExt({ api, S, office, h: { $, $$, esc, toast, guard, nameOf, hhmm, fmtDate, todayStr, canEdit, canDelete, renderTasks, renderTeam } });

// ---------------------------------------------------------------- Açılış
(async () => {
  try { if (await api.session()) await start(); } catch (e) { console.error(e); authErr(e.message); }
})();
