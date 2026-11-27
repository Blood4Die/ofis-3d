// Veri katmanı. Uygulamanın geri kalanı yalnız bu arayüzü kullanır:
// SupabaseBackend (gerçek) ve DemoBackend (yerel, sekmeler arası) aynı metotları sunar.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const EXT_TABLES = ['task_comments', 'task_followers', 'task_attachments', 'room_bookings', 'leaves', 'task_templates', 'projects', 'actions', 'checkins', 'office_schedule'];
const todayStr = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD yerel saat

// ---------------------------------------------------------------- Supabase
export class SupabaseBackend {
  constructor() {
    this.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    this.channel = null;
    this.user = null;
    this.demo = false;
  }

  async session() {
    const { data } = await this.sb.auth.getSession();
    this.user = data.session?.user ?? null;
    return this.user;
  }

  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-posta veya şifre hatalı' : error.message);
    this.user = data.user;
    return this.user;
  }

  async signUp({ name, email, password, code }) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify({ name, email, password, code }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Kayıt başarısız (${res.status})`);
    return this.signIn(email, password);
  }

  async signOut() {
    if (this.channel) await this.sb.removeChannel(this.channel);
    this.channel = null;
    await this.sb.auth.signOut();
    this.user = null;
  }

  async loadAll() {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [p, t, a] = await Promise.all([
      this.sb.from('profiles').select('*').order('desk_no'),
      this.sb.from('tasks').select('*').or(`state.neq.bitti,done_at.gte.${since}`).order('created_at'),
      this.sb.from('activity').select('*').order('created_at', { ascending: false }).limit(40),
    ]);
    for (const r of [p, t, a]) if (r.error) throw new Error(r.error.message);
    return { profiles: p.data, tasks: t.data, activity: a.data.reverse() };
  }

  async updateProfile(patch) {
    const { error } = await this.sb.from('profiles').update(patch).eq('id', this.user.id);
    if (error) throw new Error(error.message);
  }

  async addTask(task) {
    const { error } = await this.sb.from('tasks').insert(task);
    if (error) throw new Error(error.message);
  }

  async updateTask(id, patch) {
    const { error } = await this.sb.from('tasks').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async deleteTask(id) {
    const { error } = await this.sb.from('tasks').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async loadMessages() {
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const { data, error } = await this.sb.from('messages').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(400);
    if (error) throw new Error(error.message);
    return data.reverse();
  }

  async sendMessage(recipient, body, urgent = false) {
    const { error } = await this.sb.from('messages').insert({ recipient: recipient || null, body, urgent: !!urgent });
    if (error) throw new Error(error.message);
  }

  // ---- Genel tablo erişimi (yeni modüller bunu kullanır)
  _q(table, q = {}) {
    let x = this.sb.from(table).select('*');
    Object.entries(q.eq || {}).forEach(([k, v]) => { x = x.eq(k, v); });
    Object.entries(q.gte || {}).forEach(([k, v]) => { x = x.gte(k, v); });
    if (q.order) x = x.order(q.order[0], { ascending: q.order[1] !== false });
    if (q.limit) x = x.limit(q.limit);
    return x;
  }
  async list(table, q) { const { data, error } = await this._q(table, q); if (error) throw new Error(error.message); return data; }
  async insert(table, row) { const { data, error } = await this.sb.from(table).insert(row).select().single(); if (error) throw this._err(error); return data; }
  async update(table, match, patch) {
    let x = this.sb.from(table).update(patch);
    Object.entries(typeof match === 'object' ? match : { id: match }).forEach(([k, v]) => { x = x.eq(k, v); });
    const { error } = await x; if (error) throw this._err(error);
  }
  async remove(table, match) {
    let x = this.sb.from(table).delete();
    Object.entries(typeof match === 'object' ? match : { id: match }).forEach(([k, v]) => { x = x.eq(k, v); });
    const { error } = await x; if (error) throw this._err(error);
  }
  async upsert(table, row, onConflict) { const { error } = await this.sb.from(table).upsert(row, { onConflict }); if (error) throw this._err(error); }
  async rpc(fn, args = {}) { const { data, error } = await this.sb.rpc(fn, args); if (error) throw this._err(error); return data; }
  _err(e) {
    if (e.code === '23P01') return new Error('Bu saat aralığında oda zaten dolu');
    if (e.code === '23505') return new Error('Bu kayıt zaten var');
    if (e.code === '42501') return new Error('Bu işlem için yetkin yok');
    return new Error(e.message);
  }
  async upload(path, file) {
    const { error } = await this.sb.storage.from('task-files').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) throw new Error(error.message);
  }
  async fileUrl(path, name) {
    const { data, error } = await this.sb.storage.from('task-files').createSignedUrl(path, 600, { download: name || true });
    if (error) throw new Error(error.message); return data.signedUrl;
  }
  async removeFile(path) { await this.sb.storage.from('task-files').remove([path]); }
  async adminCall(action, payload = {}) {
    const { data: { session } } = await this.sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + session?.access_token },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Hata (${res.status})`);
    return body;
  }

  async savePush(sub) {
    const j = sub.toJSON();
    const row = { user_id: this.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 290) };
    const { error } = await this.sb.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' });
    if (error) throw new Error(error.message);
  }
  async removePush(endpoint) { await this.sb.from('push_subscriptions').delete().eq('endpoint', endpoint); }

  // h: {onProfile, onTask, onActivity, onPresence, onConnection}
  subscribe(h) {
    let everSubscribed = false;
    const ch = this.sb.channel('office', { config: { presence: { key: this.user.id } } });
    const fwd = (fn) => (payload) => fn({ type: payload.eventType, row: payload.new, old: payload.old });
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, fwd(h.onProfile))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fwd(h.onTask))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity' }, (p) => h.onActivity(p.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => h.onMessage?.(p.new));
    for (const t of EXT_TABLES) ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, (p) => h.onTable?.(t, { type: p.eventType, row: p.new, old: p.old }));
    ch
      .on('presence', { event: 'sync' }, () => h.onPresence(new Set(Object.keys(ch.presenceState()))))
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ at: Date.now() });
          // Bağlantı koptuktan sonra geri geldiyse kaçırılan değişiklikler için tam yeniden yükleme
          h.onConnection('online', everSubscribed);
          everSubscribed = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          h.onConnection('offline');
        }
      });
    this.channel = ch;
  }
}

// ---------------------------------------------------------------- Demo
// Sunucusuz deneme: veri localStorage'da, sekmeler BroadcastChannel ile anlık senkron.
const DEMO_KEY = 'ofis3d-demo-v1';
const DEMO_PEOPLE = [
  ['Ayşe Demir', '#ff6b6b'], ['Mehmet Kaya', '#2ec27e'], ['Zeynep Şahin', '#f6a623'],
  ['Can Yılmaz', '#a06cff'], ['Elif Arslan', '#00b8d9'], ['Burak Çelik', '#ff8fb1'],
  ['Selin Koç', '#8bc34a'],
];

export class DemoBackend {
  constructor() {
    this.demo = true;
    this.bc = new BroadcastChannel('ofis3d-demo');
    this.tabId = Math.random().toString(36).slice(2);
    this.user = null;
    this.h = null;
    this.online = new Map(); // id -> lastSeen
  }

  _db() {
    let db = JSON.parse(localStorage.getItem(DEMO_KEY) || 'null');
    if (!db) {
      const now = new Date().toISOString();
      const st = ['musait', 'toplantida', 'odakta', 'molada', 'sahada', 'disarida', 'toplantida'];
      const moods = ['mutlu', 'iyi', 'motive', 'yorgun', 'normal', 'iyi', 'stresli'];
      const looks = [
        { skin: '#f6d5b8', hair: 'uzun', hairColor: '#5a3b26', extra: 'yok' }, { skin: '#eabf98', hair: 'kisa', hairColor: '#2b211c', extra: 'gozluk' },
        { skin: '#c98e64', hair: 'topuz', hairColor: '#2b211c', extra: 'yok' }, { skin: '#eabf98', hair: 'kivircik', hairColor: '#a8743f', extra: 'kulaklik' },
        { skin: '#f6d5b8', hair: 'uzun', hairColor: '#d8b46a', extra: 'gozluk' }, { skin: '#8d5a3b', hair: 'kel', hairColor: '#2b211c', extra: 'baret' },
        { skin: '#eabf98', hair: 'kisa', hairColor: '#b3392f', extra: 'sapka' }];
      db = { seq: 100, profiles: [], tasks: [], activity: [] };
      DEMO_PEOPLE.forEach(([n, c], i) => db.profiles.push({
        id: 'bot' + i, display_name: n, color: c, desk_no: [101, 2, 11, 17, 18, 103, 13][i], role: ['mudur', 'calisan', 'calisan', 'calisan', 'calisan', 'yonetici', 'calisan'][i], dept: ['Proje Müdürü', 'Tasarım Mühendisi', 'Proses Mühendisi', 'Otomasyon Mühendisi', 'Kalite / APQP', 'Proje Planlama', 'Satın Alma'][i], capacity: 8, status: st[i], status_note: '', mood: moods[i], avatar: looks[i],
        is_admin: false, updated_at: now, created_at: now, bot: true,
      }));
      const titles = ['Teklif dosyasını hazırla', 'Haftalık rapor', 'Müşteri toplantısı notları', 'PLC yedeklerini al',
        'Fatura kontrolü', 'Saha ziyareti planı', 'Tedarikçi aramaları', 'Sunum taslağı'];
      titles.forEach((t, i) => db.tasks.push({
        id: ++db.seq, title: t, notes: '', kind: i % 3 === 2 ? 'planli' : 'gunluk',
        state: ['bekliyor', 'suruyor', 'bekliyor'][i % 3], priority: (i % 3) + 1,
        assignee: 'bot' + (i % 7), created_by: 'bot' + (i % 7),
        due_date: i % 3 === 2 ? new Date(Date.now() + (i + 1) * 864e5).toLocaleDateString('sv-SE') : todayStr(),
        done_at: null, created_at: now, updated_at: now, project_id: 1 + (i % 3), hours: [2, 4, 3, 6, 1.5, 3, 2, 5][i],
      }));
      const d = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('sv-SE');
      db.tables = {
        projects: [
          { id: 1, code: 'PRJ-2401', name: 'Hat 3 retrofit', customer: 'İç proje', lead: 'bot0', phase: 3, status: 'aktif', due: d(40), color: '#3b6fe0', created_by: 'bot0', created_at: now },
          { id: 2, code: 'PRJ-2405', name: 'Robotlu kaynak hücresi', customer: 'Anadolu Otomotiv', lead: 'bot5', phase: 1, status: 'aktif', due: d(75), color: '#2ec27e', created_by: 'bot0', created_at: now },
          { id: 3, code: 'PRJ-2409', name: 'MES entegrasyonu', customer: 'İç proje', lead: 'bot3', phase: 4, status: 'aktif', due: d(-3), color: '#f6a623', created_by: 'bot0', created_at: now },
        ],
        actions: [
          { id: 21, project_id: 1, problem: 'Servo sürücü haberleşme hatası (EtherCAT)', countermeasure: 'Kablo ekranlaması ve topraklama kontrolü', owner: 'bot3', due: d(-1), pdca: 1, opened: d(-6), created_by: 'bot0', created_at: now },
          { id: 22, project_id: 2, problem: 'Müşteri Rev C onayı gecikiyor', countermeasure: 'Haftalık onay toplantısı', owner: 'bot0', due: d(3), pdca: 0, opened: d(-4), created_by: 'bot0', created_at: now },
          { id: 23, project_id: 3, problem: 'Çevrim süresi hedefin %8 üstünde', countermeasure: 'Robot yol optimizasyonu, bekleme sürelerinin azaltılması', owner: 'bot2', due: d(5), pdca: 2, opened: d(-9), created_by: 'bot5', created_at: now },
        ],
        checkins: [{ user_id: 'bot0', day: todayStr(), note: '' }, { user_id: 'bot2', day: todayStr(), note: '' }],
      };
      db.tasks.push({ id: ++db.seq, title: 'Pres bakımda, deneme yapılamıyor', notes: '', kind: 'gunluk', state: 'engel', block_reason: 'Pres bakımda (Çarşamba dönüyor)', priority: 1, assignee: 'bot2', created_by: 'bot2', due_date: todayStr(), done_at: null, created_at: now, updated_at: now, project_id: 1, hours: 2 });
      db.tasks.push({ id: ++db.seq, title: 'Tolerans analizi', notes: '', kind: 'gunluk', state: 'bitti', priority: 2, assignee: 'bot1', created_by: 'bot1', due_date: d(-1), done_at: new Date(Date.now() - 864e5).toISOString(), created_at: now, updated_at: now, project_id: 2, hours: 3 });
      this._save(db);
    }
    return db;
  }
  _save(db) { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); }
  _emit(msg) { this._deliver(msg); this.bc.postMessage(msg); }
  _deliver(msg) {
    if (!this.h) return;
    if (msg.t === 'profile') this.h.onProfile(msg.c);
    else if (msg.t === 'task') this.h.onTask(msg.c);
    else if (msg.t === 'activity') this.h.onActivity(msg.row);
    else if (msg.t === 'table') this.h.onTable?.(msg.table, msg.c);
    else if (msg.t === 'message') { const m = msg.m, me = this.user?.id; if (!m.recipient || m.sender === me || m.recipient === me) this.h.onMessage?.(m); }
  }
  _log(db, actor, kind, message) {
    const row = { id: ++db.seq, actor, kind, message, created_at: new Date().toISOString() };
    db.activity.push(row); db.activity = db.activity.slice(-60);
    return row;
  }
  _name(db, id) { return db.profiles.find((p) => p.id === id)?.display_name ?? 'Sistem'; }

  async session() {
    const id = sessionStorage.getItem('ofis3d-demo-user');
    const p = id && this._db().profiles.find((x) => x.id === id);
    this.user = p ? { id: p.id, email: p.id + '@demo' } : null;
    return this.user;
  }
  async signIn() { throw new Error('Demo modunda "Kayıt ol" ile sadece adını gir'); }
  async signUp({ name }) {
    const db = this._db();
    let p = db.profiles.find((x) => x.display_name.toLowerCase() === name.trim().toLowerCase() && !x.bot);
    if (!p) {
      const used = new Set(db.profiles.map((x) => x.desk_no));
      let desk = 1; while (used.has(desk) && desk < 22) desk++;
      const now = new Date().toISOString();
      p = { id: 'u' + (++db.seq), display_name: name.trim().slice(0, 40), color: '#4f8cff', desk_no: desk,
        status: 'musait', status_note: '', mood: 'normal', avatar: {}, is_admin: !db.profiles.some((x) => !x.bot), active: true, updated_at: now, created_at: now };
      db.profiles.push(p);
      const row = this._log(db, p.id, 'join', p.display_name + ' ofise katıldı');
      this._save(db);
      this._emit({ t: 'profile', c: { type: 'INSERT', row: p } });
      this._emit({ t: 'activity', row });
    }
    sessionStorage.setItem('ofis3d-demo-user', p.id);
    this.user = { id: p.id };
    return this.user;
  }
  async signOut() { sessionStorage.removeItem('ofis3d-demo-user'); this.user = null; this.h = null; }

  async loadAll() {
    const db = this._db();
    return { profiles: db.profiles, tasks: db.tasks, activity: db.activity.slice(-40) };
  }

  async updateProfile(patch) { this._updProfile(this.user.id, patch); }
  _updProfile(id, patch) {
    const db = this._db();
    const p = db.profiles.find((x) => x.id === id);
    const old = { ...p };
    Object.assign(p, patch, { updated_at: new Date().toISOString() });
    let row = null;
    if (patch.status && patch.status !== old.status) {
      const lbl = { musait: 'müsait', odakta: 'odakta', toplantida: 'toplantıda', molada: 'molada', sahada: 'sahada (Üretim Tek. ve Bakım)', disarida: 'dışarıda', izinli: 'izinli' }[p.status];
      row = this._log(db, id, 'status', `${p.display_name} artık ${lbl}${p.status_note ? ' (' + p.status_note + ')' : ''}`);
    }
    this._save(db);
    this._emit({ t: 'profile', c: { type: 'UPDATE', row: p, old } });
    if (row) this._emit({ t: 'activity', row });
  }

  async addTask(task) {
    const db = this._db();
    const now = new Date().toISOString();
    const t = { id: ++db.seq, notes: '', kind: 'gunluk', state: 'bekliyor', priority: 2, assignee: null,
      due_date: null, done_at: null, ...task, created_by: this.user.id, created_at: now, updated_at: now };
    db.tasks.push(t);
    const asg = t.assignee && t.assignee !== this.user.id ? ' → ' + this._name(db, t.assignee) : '';
    const row = this._log(db, this.user.id, 'task_new', `${this._name(db, this.user.id)} yeni görev ekledi: "${t.title}"${asg}`);
    this._save(db);
    this._emit({ t: 'task', c: { type: 'INSERT', row: t } });
    this._emit({ t: 'activity', row });
  }

  async updateTask(id, patch, actor = this.user.id) {
    const db = this._db();
    const t = db.tasks.find((x) => x.id === id);
    if (!t) return;
    const old = { ...t };
    Object.assign(t, patch, { updated_at: new Date().toISOString() });
    const rows = [];
    const who = this._name(db, actor);
    if (t.state === 'bitti' && old.state !== 'bitti') { t.done_at = t.updated_at; rows.push(this._log(db, actor, 'task_done', `${who} görevi tamamladı: "${t.title}"`)); }
    else if (t.state !== 'bitti') { t.done_at = null; if (t.state === 'suruyor' && old.state !== 'suruyor') rows.push(this._log(db, actor, 'task_start', `${who} göreve başladı: "${t.title}"`)); }
    if (t.assignee !== old.assignee && t.assignee) rows.push(this._log(db, actor, 'task_assign', `${who} görevi atadı: "${t.title}" → ${this._name(db, t.assignee)}`));
    this._save(db);
    this._emit({ t: 'task', c: { type: 'UPDATE', row: t, old } });
    rows.forEach((row) => this._emit({ t: 'activity', row }));
  }

  async loadMessages() {
    const me = this.user.id;
    return (this._db().messages || []).filter((m) => !m.recipient || m.sender === me || m.recipient === me);
  }
  _t(db, table) { db.tables = db.tables || {}; return (db.tables[table] = db.tables[table] || []); }
  async list(table, q = {}) {
    const db = this._db(); let rows = [...this._t(db, table)];
    Object.entries(q.eq || {}).forEach(([k, v]) => { rows = rows.filter((r) => r[k] === v); });
    Object.entries(q.gte || {}).forEach(([k, v]) => { rows = rows.filter((r) => r[k] >= v); });
    if (q.order) rows.sort((a, b) => String(a[q.order[0]]).localeCompare(String(b[q.order[0]])) * (q.order[1] === false ? -1 : 1));
    return rows;
  }
  _match(r, m) { return Object.entries(typeof m === 'object' ? m : { id: m }).every(([k, v]) => r[k] === v); }
  async insert(table, row) {
    const db = this._db(), t = this._t(db, table);
    const defaults = { task_comments: { author: this.user.id }, task_attachments: { uploaded_by: this.user.id }, task_templates: { created_by: this.user.id, active: true },
      room_bookings: { booked_by: this.user.id, room: 'toplanti' }, leaves: { user_id: this.user.id, kind: 'yillik' },
      projects: { created_by: this.user.id, phase: 0, status: 'aktif', color: '#3b6fe0' },
      actions: { created_by: this.user.id, pdca: 0, opened: todayStr() }, checkins: { user_id: this.user.id, day: todayStr() } }[table] || {};
    const r = { ...(['task_followers', 'checkins'].includes(table) ? {} : { id: ++db.seq }), ...defaults, ...row, created_at: new Date().toISOString() };
    if (table === 'projects' && t.some((x) => x.code === r.code)) throw new Error('Bu proje kodu zaten var');
    if (table === 'room_bookings' && t.some((b) => b.room === r.room && b.starts_at < r.ends_at && r.starts_at < b.ends_at)) throw new Error('Bu saat aralığında oda zaten dolu');
    if (table === 'task_followers' && t.some((f) => f.task_id === r.task_id && f.user_id === r.user_id)) throw new Error('Bu kayıt zaten var');
    t.push(r); this._save(db);
    this._emit({ t: 'table', table, c: { type: 'INSERT', row: r } });
    return r;
  }
  async upsert(table, row, onConflict) {
    const keys = onConflict.split(','), db = this._db(), t = this._t(db, table);
    const ex = t.find((r) => keys.every((k) => r[k] === row[k]));
    if (ex) return this.update(table, Object.fromEntries(keys.map((k) => [k, row[k]])), row);
    return this.insert(table, row);
  }
  async update(table, match, patch) {
    const db = this._db();
    this._t(db, table).filter((r) => this._match(r, match)).forEach((r) => { const old = { ...r }; Object.assign(r, patch); this._emit({ t: 'table', table, c: { type: 'UPDATE', row: r, old } }); });
    this._save(db);
  }
  async remove(table, match) {
    const db = this._db(), t = this._t(db, table), gone = t.filter((r) => this._match(r, match));
    db.tables[table] = t.filter((r) => !this._match(r, match)); this._save(db);
    gone.forEach((r) => this._emit({ t: 'table', table, c: { type: 'DELETE', row: {}, old: r } }));
  }
  async rpc(fn) {
    if (fn !== 'run_recurring_today') return null;
    const db = this._db(), today = todayStr(), dow = ((new Date().getDay() + 6) % 7) + 1, dom = new Date().getDate();
    let n = 0;
    for (const t of this._t(db, 'task_templates')) {
      if (!t.active || (t.last_run && t.last_run >= today)) continue;
      const due = t.rule === 'gunluk' || (t.rule === 'haftaici' && dow <= 5) || (t.rule === 'haftalik' && t.weekday === dow) || (t.rule === 'aylik' && t.monthday === dom);
      if (!due) continue;
      t.last_run = today; this._save(db);
      await this.addTask({ title: t.title, notes: t.notes, priority: t.priority, assignee: t.assignee, due_date: today, category: t.category, template_id: t.id, kind: 'gunluk' });
      n++;
    }
    return n;
  }
  async upload(path, file) {
    if (file.size > 1.5e6) throw new Error('Demo modunda en fazla 1,5 MB');
    const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    try { localStorage.setItem('ofis3d-file-' + path, url); } catch { throw new Error('Demo depolama dolu'); }
  }
  async fileUrl(path) { return localStorage.getItem('ofis3d-file-' + path); }
  async removeFile(path) { localStorage.removeItem('ofis3d-file-' + path); }
  async adminCall(action, b = {}) {
    const db = this._db(), p = db.profiles.find((x) => x.id === b.user_id);
    switch (action) {
      case 'list': return { users: db.profiles.map((x) => ({ ...x, email: x.id + '@demo.local', last_sign_in_at: x.updated_at, push: 0 })), settings: { invite_code: 'DEMO-KODU', max_users: '20', email_enabled: '0' } };
      case 'reset_password': return { temp_password: 'DEMO-1234-56' };
      case 'set_active': if (p) this._updProfile(p.id, { active: !!b.active }); return { ok: true };
      case 'set_admin': if (p) this._updProfile(p.id, { is_admin: !!b.is_admin }); return { ok: true };
      case 'set_desk': if (p) this._updProfile(p.id, { desk_no: b.desk_no ? Number(b.desk_no) : null }); return { ok: true };
      case 'set_name': if (p) this._updProfile(p.id, { display_name: b.display_name }); return { ok: true };
      case 'set_profile': if (p) { const x = {}; ['role', 'dept', 'capacity', 'display_name'].forEach((k) => { if (b[k] !== undefined) x[k] = k === 'capacity' ? Number(b[k]) : b[k]; }); this._updProfile(p.id, x); } return { ok: true };
      case 'rotate_invite': return { invite_code: 'YENI-DEMO' };
      default: return { ok: true };
    }
  }
  async savePush() {}
  async removePush() {}
  async sendMessage(recipient, body, urgent = false, sender = this.user.id) {
    const db = this._db();
    db.messages = db.messages || [];
    const m = { id: ++db.seq, sender, recipient: recipient || null, body, urgent: !!urgent, created_at: new Date().toISOString() };
    db.messages.push(m); db.messages = db.messages.slice(-300);
    this._save(db);
    this._emit({ t: 'message', m });
  }

  async deleteTask(id) {
    const db = this._db();
    db.tasks = db.tasks.filter((x) => x.id !== id);
    this._save(db);
    this._emit({ t: 'task', c: { type: 'DELETE', row: {}, old: { id } } });
  }

  subscribe(h) {
    this.h = h;
    this.bc.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'hello') this.online.set(m.id, Date.now());
      else this._deliver(m);
    };
    const beat = () => {
      this.bc.postMessage({ t: 'hello', id: this.user.id });
      this.online.set(this.user.id, Date.now());
      const now = Date.now();
      const ids = new Set([...this.online].filter(([, ts]) => now - ts < 6000).map(([id]) => id));
      this._db().profiles.filter((p) => p.bot).forEach((p) => ids.add(p.id));
      h.onPresence(ids);
    };
    beat();
    this.beatTimer = setInterval(beat, 2000);
    setTimeout(() => h.onConnection('online', false), 50);
    // Botlar: yalnız bir sekme sürsün (en küçük tabId lider olur)
    this.peers = new Map();
    this.bc.addEventListener('message', (e) => { if (e.data.t === 'tab') this.peers.set(e.data.tab, Date.now()); });
    this.botTimer = setInterval(() => {
      this.bc.postMessage({ t: 'tab', tab: this.tabId });
      const now = Date.now();
      const alive = [this.tabId, ...[...this.peers].filter(([, ts]) => now - ts < 15000).map(([k]) => k)].sort();
      if (alive[0] !== this.tabId) return;
      if (Math.random() < 0.55) this._botStep();
    }, 7000);
  }

  _botStep() {
    const db = this._db();
    const bots = db.profiles.filter((p) => p.bot);
    const b = bots[Math.floor(Math.random() * bots.length)];
    const r = Math.random();
    if (r < 0.12) {
      const lines = ['Kahve isteyen var mı? ☕', 'Toplantı 10 dk sonra başlıyor', 'Raporu paylaştım 👍', 'Öğle yemeğine kim geliyor?', 'Bakım ekibi hatta, sorun çözüldü'];
      this.sendMessage(null, lines[Math.floor(Math.random() * lines.length)], false, b.id);
    } else if (r < 0.22) {
      const ms = ['mutlu', 'iyi', 'normal', 'yorgun', 'stresli', 'motive'];
      this._updProfile(b.id, { mood: ms[Math.floor(Math.random() * ms.length)] });
    } else if (r < 0.65) {
      const opts = ['musait', 'musait', 'odakta', 'toplantida', 'molada', 'sahada', 'disarida'].filter((s) => s !== b.status);
      const s = opts[Math.floor(Math.random() * opts.length)];
      const notes = { toplantida: 'Haftalık değerlendirme', disarida: 'Müşteri ziyareti', sahada: 'Bakım kontrolü' };
      this._updProfile(b.id, { status: s, status_note: notes[s] || '' });
    } else {
      const mine = db.tasks.filter((t) => t.assignee === b.id && t.state !== 'bitti');
      if (!mine.length) return;
      const t = mine[Math.floor(Math.random() * mine.length)];
      this.updateTask(t.id, { state: t.state === 'bekliyor' ? 'suruyor' : 'bitti' }, b.id);
    }
  }
}

export function resetDemo() { localStorage.removeItem(DEMO_KEY); }
export { todayStr };
