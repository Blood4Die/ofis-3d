// Proje Asakai köprüsü.
// Günlük maddeler (dün/bugün), izinler ve takipler Asakai'nin Supabase'indeki tek tabloda (records) tutulur.
// Ofis 3D bu tabloya Asakai'nin kendi biçimiyle okur/yazar; kopya yok, eşitleme yok — iki ekran, tek kayıt.
// Yetki kuralı Asakai'deki gibidir: herkes yalnız kendi kaydını değiştirir, Asakai yöneticisi hepsini.
import { ASAKAI_URL, ASAKAI_KEY, ASAKAI_ADMIN, ASAKAI_SITE, ASAKAI_LEAVE_TYPES } from './config.js';

const SEP = '\u0001';
const KEYF = { items: (x) => String(x.id), actions: (x) => String(x.no), people: (x) => x.id, projects: (x) => x.id, follows: (x) => x.id, leaves: (x) => x.id, recurring: (x) => x.id, skips: (x) => x };
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isWE = (d) => d.getDay() === 0 || d.getDay() === 6;
const prevWork = (d) => { let x = addDays(d, -1); while (isWE(x)) x = addDays(x, -1); return x; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const numH = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return isFinite(n) && n > 0 ? Math.round(n * 4) / 4 : 0; };
const fmtH = (h) => (h ? String(Math.round(h * 100) / 100).replace('.', ',') + ' sa' : '');
const ORDER = { blk: 0, plan: 1, done: 2 };
const GUN = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const norm = (s) => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const dshort = (s) => parse(s).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' });

// ------------------------------------------------------------------ Gerçek bağlantı
class RealAK {
  constructor() {
    this.sb = window.supabase.createClient(ASAKAI_URL, ASAKAI_KEY, {
      auth: { storageKey: 'ofis3d-asakai-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  async user() { const { data } = await this.sb.auth.getSession(); return data.session?.user || null; }
  async login(email, password) { const { data, error } = await this.sb.auth.signInWithPassword({ email, password }); if (error) throw error; return data.user; }
  async logout() { await this.sb.auth.signOut(); }
  onSignedOut(cb) { this.sb.auth.onAuthStateChange((ev, s) => { if (ev === 'SIGNED_OUT' || !s) cb(); }); }
  async loadAll() {
    const all = []; let from = 0;
    for (;;) {
      const { data, error } = await this.sb.from('records').select('coll,id,data,deleted').eq('deleted', false).range(from, from + 999);
      if (error) throw error; all.push(...data); if (data.length < 1000) break; from += 1000;
    }
    return all;
  }
  subscribe(onRow) {
    if (this.ch) this.sb.removeChannel(this.ch);
    this.ch = this.sb.channel('ofis3d-records').on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, (pl) => { if (pl.new?.coll) onRow(pl.new); }).subscribe();
  }
  async put(coll, id, data) {
    const { error } = await this.sb.from('records').upsert({ coll, id, data, deleted: false, updated_at: new Date().toISOString() }, { onConflict: 'coll,id' });
    if (error) throw error;
  }
  async del(coll, id) {
    const { error } = await this.sb.from('records').upsert({ coll, id, data: null, deleted: true, updated_at: new Date().toISOString() }, { onConflict: 'coll,id' });
    if (error) throw error;
  }
}

// ------------------------------------------------------------------ Demo (yalnız bu tarayıcı)
const DKEY = 'ofis3d-demo-asakai-v1';
class DemoAK {
  constructor(profiles, meName) {
    this.bc = new BroadcastChannel('ofis3d-demo-ak');
    let db = JSON.parse(localStorage.getItem(DKEY) || 'null');
    if (!db) db = this._seed(profiles);
    const slug = norm(meName) || 'ben';
    this.email = slug + '@demo.local';
    if (!db.some((r) => r.coll === 'people' && r.data.email === this.email)) db.push({ coll: 'people', id: 'p' + slug, data: { id: 'p' + slug, name: meName, dept: 'Üretim Teknolojileri', email: this.email } });
    this.db = db; this._save();
  }
  _seed(profiles) {
    const today = iso(new Date()), y = iso(prevWork(new Date())), rows = [], add = (coll, data) => rows.push({ coll, id: KEYF[coll](data), data });
    add('projects', { id: 'j1', code: 'PRJ-2601', name: 'Kedi Kumu Projesi', customer: 'PG Kimya', phase: 1, due: iso(addDays(new Date(), 60)) });
    add('projects', { id: 'j2', code: 'PRJ-2603', name: 'Malaksör Robot Hattı', customer: 'Polat Makina', phase: 3, due: iso(addDays(new Date(), 90)) });
    const T = [['Teklif dosyası', 'plan', 2, 'j1'], ['PLC yedekleri', 'done', 1, ''], ['Pres testi — hidrolik kaçak', 'blk', 2, 'j2'], ['Robot yörünge düzeltme', 'plan', 3, 'j2'], ['Tedarikçi görüşmesi', 'plan', 1, '']];
    profiles.forEach((p, i) => {
      const pid = 'p' + norm(p.display_name);
      add('people', { id: pid, name: p.display_name, dept: 'Üretim Teknolojileri', email: norm(p.display_name) + '@demo.local' });
      if (i === 5) { add('leaves', { id: 'l' + i, p: pid, from: today, to: today, type: 'Yıllık izin', note: '' }); return; }
      if (i % 3 === 2) return; // bazıları bugün giriş yapmamış
      const [t, ty, h, pr] = T[i % T.length];
      add('items', { id: uid() + i, p: pid, d: today, pr, text: t, type: ty, h });
      add('items', { id: uid() + 'y' + i, p: pid, d: y, pr, text: 'Haftalık rapor', type: 'done', h: 1 });
    });
    return rows;
  }
  _save() { localStorage.setItem(DKEY, JSON.stringify(this.db)); }
  async user() { return { email: this.email }; }
  async login() { return this.user(); }
  async logout() {}
  onSignedOut() {}
  async loadAll() { return this.db.map((r) => ({ ...r, deleted: false })); }
  subscribe(onRow) { this.onRow = onRow; this.bc.onmessage = (e) => { this._apply(e.data); onRow(e.data); }; }
  _apply(row) { const i = this.db.findIndex((r) => r.coll === row.coll && r.id === row.id); if (row.deleted) { if (i >= 0) this.db.splice(i, 1); } else if (i >= 0) this.db[i] = row; else this.db.push(row); }
  async put(coll, id, data) { const row = { coll, id, data, deleted: false }; this._apply(row); this._save(); this.bc.postMessage(row); }
  async del(coll, id) { const row = { coll, id, data: null, deleted: true }; this._apply(row); this._save(); this.bc.postMessage(row); }
}

// ------------------------------------------------------------------ Modül
export function initAsakai({ S, api, office, h }) {
  const { $, $$, esc, toast } = h;
  const A = { be: null, user: null, connected: false, recs: new Map(), D: null, tab: 'bugun', mine: false, fAll: false, fDone: false, err: '', busy: false };
  const panel = $('#akPanel');
  const today = () => iso(new Date());
  const yday = () => iso(prevWork(new Date()));

  // ---------------- veri
  function rebuild() {
    const D = { items: [], people: [], projects: [], follows: [], leaves: [], recurring: [], skips: new Set() };
    A.recs.forEach((data, k) => {
      const c = k.slice(0, k.indexOf(SEP));
      if (c === 'skips') D.skips.add(data); else if (D[c] && data && typeof data === 'object') D[c].push(data);
    });
    A.D = D;
  }
  function applyRow(r) { const k = r.coll + SEP + r.id; if (r.deleted || r.data == null) A.recs.delete(k); else A.recs.set(k, r.data); }
  async function load() { const rows = await A.be.loadAll(); A.recs.clear(); rows.forEach(applyRow); rebuild(); }

  const email = () => (A.user?.email || '').toLowerCase();
  const isAdmin = () => email() === ASAKAI_ADMIN;
  const myPid = () => { const e = email(); return (e && A.D?.people.find((p) => (p.email || '').toLowerCase() === e)?.id) || ''; };
  const person = (pid) => A.D?.people.find((p) => p.id === pid);
  const proj = (id) => (id ? A.D?.projects.find((p) => p.id === id) : null);
  const canEdit = (pid) => isAdmin() || (pid && pid === myPid());

  function pidOf(profileId) {
    if (!A.D) return '';
    if (profileId === S.me && myPid()) return myPid();
    const p = S.profiles.get(profileId); if (!p) return '';
    if (p.asakai_pid && person(p.asakai_pid)) return p.asakai_pid;
    const n = norm(p.display_name); if (!n) return '';
    const hit = A.D.people.find((x) => norm(x.name) === n) || (n.length >= 5 && A.D.people.find((x) => { const m = norm(x.name); return m.length >= 5 && (m.includes(n) || n.includes(m)); }));
    return hit?.id || '';
  }
  const profileOf = (pid) => [...S.profiles.values()].find((p) => pidOf(p.id) === pid);
  const leaveOn = (pid, d) => A.D?.leaves.find((l) => l.p === pid && l.from <= d && l.to >= d) || null;

  // Asakai'deki dayItems ile aynı mantık: gerçek maddeler + o güne düşen tekrarlayan maddeler (atlanmadıysa)
  function dayItems(pid, d) {
    const real = A.D.items.filter((i) => i.p === pid && i.d === d), dt = parse(d);
    if (isWE(dt) || leaveOn(pid, d)) return real;
    const virt = A.D.recurring.filter((rc) => rc.p === pid && (rc.from || '') <= d && (rc.freq !== 'weekly' || dt.getDay() === rc.wd) && !A.D.skips.has(rc.id + '|' + d) && !real.some((i) => i.r === rc.id))
      .map((rc) => ({ id: 'v' + rc.id + d, p: pid, d, text: rc.text, pr: rc.pr || '', h: rc.h || 0, type: 'plan', virtual: true, r: rc.id }));
    return [...real, ...virt].sort((a, b) => (ORDER[a.type] ?? 1) - (ORDER[b.type] ?? 1));
  }

  // ---------------- yazma (önce ekranda, sonra Asakai'ye)
  async function write(coll, id, data) {
    applyRow({ coll, id, data, deleted: data == null }); rebuild(); renderAll();
    try { data == null ? await A.be.del(coll, id) : await A.be.put(coll, id, data); }
    catch (e) { toast('⚠️ Asakai\'ye kaydedilemedi: ' + (e.message || e)); await load().catch(() => {}); renderAll(); }
  }
  const putItem = (it) => { const { virtual, ...d } = it; return write('items', String(d.id), d); };
  const realize = (i, patch) => putItem({ id: uid(), p: i.p, d: i.d, pr: i.pr || '', text: i.text, type: 'plan', h: i.h || 0, r: i.r, ...patch });
  const toggleItem = (i) => (i.virtual ? realize(i, { type: 'done' }) : putItem({ ...i, type: i.type === 'plan' ? 'done' : i.type === 'done' ? 'plan' : 'done' }));
  const blkItem = (i) => (i.virtual ? realize(i, { type: 'blk' }) : putItem({ ...i, type: i.type === 'blk' ? 'plan' : 'blk' }));
  async function removeItem(i) {
    if (i.virtual) return write('skips', i.r + '|' + i.d, i.r + '|' + i.d);
    await write('items', String(i.id), null);
    if (i.r) await write('skips', i.r + '|' + i.d, i.r + '|' + i.d);
  }

  // ---------------- 3D ofis ve ekip listesi
  const planCount = (profileId) => { if (!A.connected) return 0; const pid = pidOf(profileId); return pid ? dayItems(pid, today()).filter((i) => i.type === 'plan').length : 0; };
  function flagOf(profileId) {
    const pid = pidOf(profileId); if (!pid) return '';
    const d = today(), lv = leaveOn(pid, d); if (lv) return '🏖️';
    return dayItems(pid, d).some((i) => i.type === 'blk') ? '⛔' : '';
  }
  function refreshAvatars() {
    S.profiles.forEach((p) => { office.setTaskCount(p.id, planCount(p.id)); office.setFlag?.(p.id, A.connected ? flagOf(p.id) : ''); });
  }
  function leaveToday(profileId) {
    const pid = pidOf(profileId), lv = pid && leaveOn(pid, today());
    return lv ? { kind: lv.type, note: lv.note } : null;
  }
  function cardHtml(profileId) {
    if (!A.connected) return `<p class="muted small">Günlük işler Asakai'de. Görevler panelinden bağlan.</p>`;
    const pid = pidOf(profileId);
    if (!pid) return `<p class="muted small">Asakai'de eşleşen kişi yok.</p>`;
    const d = today(), lv = leaveOn(pid, d), list = dayItems(pid, d);
    if (lv) return `<p class="small">🏖️ Bugün izinli · ${esc(lv.type || 'İzin')}</p>`;
    if (!list.length) return `<p class="muted small">Bugün için Asakai'ye giriş yapılmamış.</p>`;
    return `<ul class="ak-card">${list.map((i) => `<li class="${i.type}">${i.type === 'done' ? '✅' : i.type === 'blk' ? '⛔' : '⏳'} ${esc(i.text)}${proj(i.pr) ? ` <span class="muted small">${esc(proj(i.pr).code)}</span>` : ''}${i.h ? ` <span class="muted small">${fmtH(i.h)}</span>` : ''}</li>`).join('')}</ul>`;
  }

  // ---------------- panel
  function renderAll() { renderPanel(false); refreshAvatars(); h.onChange?.(); }

  function renderPanel(full = true) {
    if (!A.connected) return renderLogin();
    if (full || !$('#akList', panel)) {
      const fOpen = A.D.follows.filter((f) => f.status !== 'done' && f.by === myPid()).length;
      panel.innerHTML = `
        <div class="tabs ak-tabs"><button data-t="bugun" class="${A.tab === 'bugun' ? 'active' : ''}">Bugün</button><button data-t="dun" class="${A.tab === 'dun' ? 'active' : ''}">Dün</button><button data-t="takip" class="${A.tab === 'takip' ? 'active' : ''}">Takip${fOpen ? ` <span class="ak-n">${fOpen}</span>` : ''}</button></div>
        <div class="tfilters ak-filters">${A.tab === 'takip'
          ? `<label class="mine"><input type="checkbox" id="akFAll" ${A.fAll ? 'checked' : ''}/> Tüm ekip</label><label class="mine"><input type="checkbox" id="akFDone" ${A.fDone ? 'checked' : ''}/> Tamamlananlar</label>`
          : `<label class="mine"><input type="checkbox" id="akMine" ${A.mine ? 'checked' : ''}/> Sadece benim</label><span class="muted small">${dshort(A.tab === 'dun' ? yday() : today())}</span>`}
          <a class="ak-site" href="${ASAKAI_SITE}" target="_blank" rel="noopener" title="Proje Asakai">Asakai ↗</a></div>
        ${myPid() ? '' : `<p class="ak-warn">Asakai'deki kişi listesinde e-postan (${esc(email())}) yok; yalnız görüntüleyebilirsin. Asakai yöneticisinden "Ekibi düzenle"de e-postanı eklemesini iste.</p>`}
        <ul id="akList" class="tasks ak-list"></ul>
        <form id="akForm" class="task-form" autocomplete="off"></form>
        <div class="ak-foot muted small">Asakai: ${esc(email())} · <a href="#" id="akOut">bağlantıyı kes</a></div>`;
      $$('.ak-tabs button', panel).forEach((b) => b.onclick = () => { A.tab = b.dataset.t; renderPanel(); });
      const on = (id, fn) => { const el = $(id, panel); if (el) el.onchange = fn; };
      on('#akMine', (e) => { A.mine = e.target.checked; renderList(); });
      on('#akFAll', (e) => { A.fAll = e.target.checked; renderList(); });
      on('#akFDone', (e) => { A.fDone = e.target.checked; renderList(); });
      $('#akOut', panel).onclick = (e) => { e.preventDefault(); if (confirm('Bu cihazda Asakai bağlantısı kesilsin mi?')) disconnect(); };
      renderForm();
    }
    renderList();
  }

  function renderLogin() {
    panel.innerHTML = `<div class="ak-login">
      <h3>📊 Görevler artık Asakai'de</h3>
      <p class="muted small">Dün/bugün maddeleri, engeller, izinler ve takipler Proje Asakai ile ortak. Asakai hesabınla <b>bir kez</b> giriş yap; bu cihaz hatırlar. Burada eklediğin madde Asakai'de, Asakai'de eklenen burada anında görünür.</p>
      <form id="akLogin" autocomplete="on">
        <input type="email" name="email" placeholder="Asakai e-postan" value="${esc(h.myEmail?.() || '')}" required autocomplete="username" />
        <input type="password" name="pw" placeholder="Asakai şifren" required autocomplete="current-password" />
        <button class="primary" ${A.busy ? 'disabled' : ''}>${A.busy ? 'Bağlanıyor…' : 'Asakai\'ye bağlan'}</button>
      </form>
      ${A.err ? `<p class="ak-err">${esc(A.err)}</p>` : ''}
      <p class="muted small">Hesabın yoksa veya şifreni unuttuysan <a href="${ASAKAI_SITE}" target="_blank" rel="noopener">Asakai</a> üzerinden işlem yap.</p></div>`;
    $('#akLogin', panel).onsubmit = async (e) => {
      e.preventDefault(); const f = e.target; A.busy = true; A.err = ''; renderLogin();
      try { A.user = await A.be.login(f.email.value.trim(), f.pw.value); await afterConnect(); }
      catch (er) { A.err = /invalid/i.test(er.message || '') ? 'E-posta veya şifre hatalı.' : (er.message || String(er)); }
      A.busy = false; if (!A.connected) renderLogin();
    };
  }

  const projOpts = (sel) => `<option value="">Proje dışı</option>${A.D.projects.slice().sort((a, b) => (a.code || '').localeCompare(b.code || '')).map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.code)} · ${esc(p.name)}</option>`).join('')}`;

  function renderForm() {
    const f = $('#akForm', panel); if (!f) return;
    const me = myPid();
    if (!me && !isAdmin()) { f.hidden = true; return; }
    f.hidden = false;
    const people = A.D.people.slice().sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    const who = isAdmin() ? `<select name="p">${people.map((p) => `<option value="${esc(p.id)}" ${p.id === me ? 'selected' : ''}>${esc(p.name)}${p.id === me ? ' (ben)' : ''}</option>`).join('')}</select>` : '';
    if (A.tab === 'takip') {
      f.innerHTML = `<input name="topic" maxlength="140" placeholder="Takip konusu (ör. Teklif cevabı)" required />
        <div class="row"><input name="who" list="akWho" maxlength="60" placeholder="Kimden / kimde" /><input name="due" type="date" value="${iso(addDays(new Date(), 3))}" /></div>
        <datalist id="akWho">${people.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
        <div class="row"><select name="pr">${projOpts('')}</select>${who}</div>
        <input name="note" maxlength="200" placeholder="Not (isteğe bağlı)" />
        <button class="primary">Takibe ekle</button>`;
      f.onsubmit = (e) => {
        e.preventDefault(); const topic = f.topic.value.trim(); if (!topic) return;
        const note = f.note.value.trim(), id = 'f' + Date.now().toString(36);
        write('follows', id, { id, topic, who: f.who.value.trim(), pr: f.pr.value, due: f.due.value, by: f.p ? f.p.value : me, status: 'open', created: today(), log: note ? [{ d: today(), text: note }] : [] });
        f.topic.value = ''; f.who.value = ''; f.note.value = ''; f.topic.focus(); toast('👁 Takibe eklendi');
      };
      return;
    }
    const dun = A.tab === 'dun';
    f.innerHTML = `<input name="text" maxlength="200" placeholder="${dun ? 'Dün ne yaptın?' : 'Bugün ne yapacaksın / engel?'}" required />
      <div class="row"><select name="type">${[['plan', 'Yapılacak'], ['done', 'Yapıldı'], ['blk', 'Engel'], ['daily', '↻ Her gün'], ['weekly', '↻ Her hafta']].map(([v, l]) => `<option value="${v}" ${v === (dun ? 'done' : 'plan') ? 'selected' : ''}>${l}</option>`).join('')}</select><input name="h" type="number" min="0" max="24" step="0.25" placeholder="Saat" /></div>
      <div class="row"><select name="pr">${projOpts('')}</select>${who}</div>
      <button class="primary">Ekle</button>`;
    f.onsubmit = (e) => {
      e.preventDefault(); const text = f.text.value.trim(); if (!text) return;
      const p = f.p ? f.p.value : me, d = dun ? yday() : today(), type = f.type.value, pr = f.pr.value, hh = numH(f.h.value);
      if (type === 'daily' || type === 'weekly') {
        const id = 'r' + Date.now().toString(36), w = type === 'weekly';
        write('recurring', id, { id, p, text, pr, h: hh, freq: w ? 'weekly' : 'daily', wd: parse(d).getDay(), from: w ? d : (d < today() ? d : today()) });
        toast(w ? `↻ Her ${GUN[parse(d).getDay()]} eklenecek` : '↻ Her iş günü eklenecek');
      } else putItem({ id: uid(), p, d, pr, text, type, h: hh });
      f.text.value = ''; f.h.value = ''; if (type === 'daily' || type === 'weekly') f.type.value = dun ? 'done' : 'plan'; f.text.focus();
    };
  }

  function renderList() {
    const ul = $('#akList', panel); if (!ul) return;
    if (A.tab === 'takip') return renderFollows(ul);
    const d = A.tab === 'dun' ? yday() : today(), me = myPid();
    let people = A.D.people.slice().sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name, 'tr')));
    if (A.mine) people = people.filter((p) => p.id === me);
    const V = []; // görünen maddeler (indeksle tıklama)
    const html = people.map((p) => {
      const list = dayItems(p.id, d), lv = leaveOn(p.id, d), prof = profileOf(p.id), ed = canEdit(p.id);
      const sum = list.reduce((a, i) => a + (i.h || 0), 0);
      const head = `<li class="ak-h"><span class="dot" style="background:${esc(prof?.color || '#8a8f98')}"></span><b>${esc(p.name)}</b>${p.id === me ? ' <span class="muted">(sen)</span>' : ''}
        <span class="ak-hm">${lv ? `🏖️ ${esc(lv.type || 'İzin')}` : list.length ? `${list.length} madde${sum ? ' · ' + fmtH(sum) : ''}` : isWE(parse(d)) ? '' : '<span class="ak-miss">Girilmedi</span>'}</span></li>`;
      return head + list.map((i) => {
        const k = V.push(i) - 1, pj = proj(i.pr);
        return `<li class="ak-i ${i.type}"><button class="ak-box ${i.type}" data-i="${k}" ${ed ? '' : 'disabled'} title="${i.type === 'plan' ? 'Yapıldı olarak işaretle' : i.type === 'done' ? 'Yapılacağa geri al' : 'Engel çözüldü (yapıldı)'}">${i.type === 'done' ? '✓' : i.type === 'blk' ? '!' : ''}</button>
          <div><div class="tt">${esc(i.text)}</div><div class="meta">${pj ? `<span class="prc">${esc(pj.code)}</span>` : ''}${i.h ? `<span>⏱ ${fmtH(i.h)}</span>` : ''}${i.r ? '<span title="Tekrarlayan">↻</span>' : ''}${i.f && A.D.follows.some((f) => f.id === i.f) ? '<span>👁 takipte</span>' : ''}${i.type === 'blk' ? '<span class="bad">Engel</span>' : ''}</div></div>
          ${ed ? `<span class="ak-acts"><button class="ak-b" data-b="${k}" title="${i.type === 'blk' ? 'Engeli kaldır' : 'Engel olarak işaretle'}">⛔</button><button class="del" data-d="${k}" title="Sil">🗑</button></span>` : '<span></span>'}</li>`;
      }).join('');
    }).join('');
    ul.innerHTML = html || '<li class="empty" style="display:block">Kayıt yok.</li>';
    $$('.ak-box', ul).forEach((b) => b.onclick = () => toggleItem(V[+b.dataset.i]));
    $$('.ak-b', ul).forEach((b) => b.onclick = () => blkItem(V[+b.dataset.b]));
    $$('[data-d]', ul).forEach((b) => b.onclick = () => { const i = V[+b.dataset.d]; if (confirm(`"${i.text}" silinsin mi?${i.r ? '\n(Tekrarlayan madde: yalnız bu günden kaldırılır.)' : ''}`)) removeItem(i); });
  }

  function renderFollows(ul) {
    const me = myPid(), td = today();
    const list = A.D.follows.filter((f) => (A.fAll || f.by === me) && (A.fDone ? f.status === 'done' : f.status !== 'done'))
      .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    ul.innerHTML = list.map((f, k) => {
      const ed = isAdmin() || f.by === me, late = f.status !== 'done' && f.due && f.due < td, pj = proj(f.pr), last = (f.log || []).slice(-1)[0];
      return `<li class="ak-i ${f.status === 'done' ? 'done' : ''}"><button class="ak-box ${f.status === 'done' ? 'done' : 'plan'}" data-fi="${k}" ${ed ? '' : 'disabled'} title="${f.status === 'done' ? 'Yeniden aç' : 'Tamamlandı'}">${f.status === 'done' ? '✓' : ''}</button>
        <div><div class="tt">${esc(f.topic || '—')}</div><div class="meta">${f.who ? `<span>👤 ${esc(f.who)}</span>` : ''}${f.due ? `<span class="${late ? 'late' : ''}">📅 ${dshort(f.due)}${late ? ' (gecikti)' : ''}</span>` : ''}${pj ? `<span class="prc">${esc(pj.code)}</span>` : ''}${A.fAll ? `<span>✍️ ${esc(person(f.by)?.name || '—')}</span>` : ''}</div>
        ${last ? `<div class="muted small">${esc(last.text)}</div>` : ''}</div>
        ${ed ? `<span class="ak-acts"><button class="del" data-fd="${k}" title="Sil">🗑</button></span>` : '<span></span>'}</li>`;
    }).join('') || `<li class="empty" style="display:block">${A.fDone ? 'Tamamlanan takip yok.' : 'Açık takip yok. Başkasından beklediğin işi aşağıdan ekle.'}</li>`;
    $$('[data-fi]', ul).forEach((b) => b.onclick = () => { const f = list[+b.dataset.fi], d = f.status === 'done'; write('follows', f.id, { ...f, status: d ? 'open' : 'done', doneAt: d ? '' : td }); });
    $$('[data-fd]', ul).forEach((b) => b.onclick = () => { const f = list[+b.dataset.fd]; if (confirm(`"${f.topic || 'Bu kayıt'}" takipten silinsin mi?`)) write('follows', f.id, null); });
  }

  // ---------------- izin takvimi (ext.js modalı bu fonksiyonu kullanır)
  function renderLeaves(mbody, rerender, month, nav) {
    const y = month.getFullYear(), mo = month.getMonth(), first = new Date(y, mo, 1), startDow = (first.getDay() + 6) % 7, daysIn = new Date(y, mo + 1, 0).getDate(), td = today(), me = myPid();
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += '<div class="cal-c empty"></div>';
    for (let d = 1; d <= daysIn; d++) {
      const ds = iso(new Date(y, mo, d)), dow = (startDow + d - 1) % 7, who = A.D.leaves.filter((l) => l.from <= ds && l.to >= ds);
      cells += `<div class="cal-c ${ds === td ? 'today' : ''} ${dow >= 5 ? 'we' : ''}"><span class="dn">${d}</span>${who.map((l) => { const pn = person(l.p)?.name || '—'; return `<span class="lv" style="background:${esc(profileOf(l.p)?.color || '#8a8f98')}" title="${esc(pn)} · ${esc(l.type || '')}${l.note ? ' · ' + esc(l.note) : ''}">${esc(pn.split(' ')[0])}</span>`; }).join('')}</div>`;
    }
    const upcoming = A.D.leaves.filter((l) => l.to >= td && (isAdmin() || l.p === me)).sort((a, b) => a.from.localeCompare(b.from));
    const people = A.D.people.slice().sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    mbody.innerHTML = `<h3>🏖️ İzin takvimi <span class="muted small">· Asakai ile ortak</span></h3>
      <div class="cal-nav"><button id="calPrev">‹</button><b>${month.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}</b><button id="calNext">›</button></div>
      <div class="cal">${['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => `<div class="cal-h">${d}</div>`).join('')}${cells}</div>
      ${me || isAdmin() ? `<form id="lvForm" class="lv-form">
        ${isAdmin() ? `<select name="p">${people.map((p) => `<option value="${esc(p.id)}" ${p.id === me ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
        <div class="row3"><input type="date" name="from" value="${td}" required /><input type="date" name="to" value="${td}" required />
          <select name="type">${ASAKAI_LEAVE_TYPES.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div>
        <input name="note" maxlength="80" placeholder="Not (isteğe bağlı, ör. yarım gün, vekil)" />
        <button class="primary">İzin ekle</button></form>` : `<p class="ak-warn">Asakai'de kişi kaydın e-postanla eşleşmedi; izin ekleyemezsin.</p>`}
      <h4>${isAdmin() ? 'Yaklaşan izinler' : 'İzinlerim'}</h4>
      <ul class="lv-list">${upcoming.map((l, k) => `<li><b>${esc(person(l.p)?.name || '—')}</b> ${dshort(l.from)} – ${dshort(l.to)} · ${esc(l.type || '')}${l.note ? ' · ' + esc(l.note) : ''}${isAdmin() || l.p === me ? `<button class="del" data-ldel="${k}">Sil</button>` : ''}</li>`).join('') || '<li class="muted">Kayıt yok.</li>'}</ul>
      <p class="muted small">İzin türü dışında sağlık bilgisi girmeyin.</p>`;
    $('#calPrev', mbody).onclick = () => nav(-1);
    $('#calNext', mbody).onclick = () => nav(1);
    const f = $('#lvForm', mbody);
    if (f) f.onsubmit = (e) => {
      e.preventDefault();
      if (f.to.value < f.from.value) { toast('⚠️ Bitiş tarihi başlangıçtan önce olamaz'); return; }
      const id = 'l' + Date.now().toString(36);
      write('leaves', id, { id, p: f.p ? f.p.value : me, from: f.from.value, to: f.to.value, type: f.type.value, note: f.note.value.trim() }).then(rerender);
      toast('🏖️ İzin eklendi');
    };
    $$('[data-ldel]', mbody).forEach((b) => b.onclick = () => { const l = upcoming[+b.dataset.ldel]; if (confirm('İzin kaydı silinsin mi?')) write('leaves', l.id, null).then(rerender); });
  }

  // ---------------- bağlantı
  function onRow(r) {
    const k = r.coll + SEP + r.id, prev = A.recs.get(k);
    applyRow(r); rebuild();
    // Başkasının bildirdiği engel ve tamamlanan iş: küçük bildirim / kutlama
    if (r.coll === 'items' && r.data && r.data.p !== myPid()) {
      const prof = profileOf(r.data.p), nm = person(r.data.p)?.name || 'Biri';
      if (r.data.type === 'blk' && prev?.type !== 'blk' && r.data.d === today()) toast(`⛔ ${nm} engel bildirdi: ${r.data.text}`);
      if (r.data.type === 'done' && prev && prev.type !== 'done' && prof) office.celebrate?.(prof.id);
    }
    renderAll();
  }

  async function afterConnect() {
    await load();
    A.connected = true; A.err = '';
    A.be.subscribe(onRow);
    const pid = myPid(), meP = S.profiles.get(S.me);
    if (pid && meP && meP.asakai_pid !== pid) api.updateProfile({ asakai_pid: pid }).catch(() => {});
    renderPanel(); refreshAvatars(); h.onChange?.();
  }

  function disconnect() {
    A.be.logout().catch(() => {}); A.connected = false; A.user = null; A.recs.clear(); A.D = null;
    renderLogin(); refreshAvatars(); h.onChange?.();
  }

  async function start() {
    A.be = api.demo ? new DemoAK([...S.profiles.values()].filter((p) => p.id !== S.me), S.profiles.get(S.me)?.display_name || 'Ben') : new RealAK();
    A.be.onSignedOut(() => { if (A.connected) { toast('Asakai oturumu kapandı; yeniden bağlan.'); disconnect(); } });
    try { A.user = await A.be.user(); if (A.user) await afterConnect(); else renderLogin(); }
    catch (e) { console.warn(e); A.err = 'Asakai\'ye ulaşılamadı: ' + (e.message || e); renderLogin(); }
    // Sekmeye dönünce ve 5 dakikada bir tazele (realtime kopsa bile güncel kalsın)
    const refresh = () => { if (A.connected) load().then(renderAll).catch(console.warn); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    setInterval(refresh, 5 * 60 * 1000);
  }

  return {
    start, get connected() { return A.connected; }, planCount, flagOf, refreshAvatars, leaveToday, cardHtml, renderLeaves,
    pidOf, render: () => A.connected && renderPanel(false),
  };
}
