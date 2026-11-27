// Veri katmanı. Uygulamanın geri kalanı yalnız bu arayüzü kullanır:
// SupabaseBackend (gerçek) ve DemoBackend (yerel, sekmeler arası) aynı metotları sunar.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

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

  // h: {onProfile, onTask, onActivity, onPresence, onConnection}
  subscribe(h) {
    let everSubscribed = false;
    const ch = this.sb.channel('office', { config: { presence: { key: this.user.id } } });
    const fwd = (fn) => (payload) => fn({ type: payload.eventType, row: payload.new, old: payload.old });
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, fwd(h.onProfile))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fwd(h.onTask))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity' }, (p) => h.onActivity(p.new))
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
        id: 'bot' + i, display_name: n, color: c, desk_no: [101, 2, 11, 19, 20, 103, 13][i], status: st[i], status_note: '', mood: moods[i], avatar: looks[i],
        is_admin: false, updated_at: now, created_at: now, bot: true,
      }));
      const titles = ['Teklif dosyasını hazırla', 'Haftalık rapor', 'Müşteri toplantısı notları', 'PLC yedeklerini al',
        'Fatura kontrolü', 'Saha ziyareti planı', 'Tedarikçi aramaları', 'Sunum taslağı'];
      titles.forEach((t, i) => db.tasks.push({
        id: ++db.seq, title: t, notes: '', kind: i % 3 === 2 ? 'planli' : 'gunluk',
        state: ['bekliyor', 'suruyor', 'bekliyor'][i % 3], priority: (i % 3) + 1,
        assignee: 'bot' + (i % 7), created_by: 'bot' + (i % 7),
        due_date: i % 3 === 2 ? new Date(Date.now() + (i + 1) * 864e5).toLocaleDateString('sv-SE') : todayStr(),
        done_at: null, created_at: now, updated_at: now,
      }));
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
      let desk = 1; while (used.has(desk) && desk < 24) desk++;
      const now = new Date().toISOString();
      p = { id: 'u' + (++db.seq), display_name: name.trim().slice(0, 40), color: '#4f8cff', desk_no: desk,
        status: 'musait', status_note: '', mood: 'normal', avatar: {}, is_admin: false, updated_at: now, created_at: now };
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
    if (r < 0.15) {
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
