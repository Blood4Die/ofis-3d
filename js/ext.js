// Genişletilmiş özellikler: görev detayı (yorum, kontrol listesi, ek, takipçi), kategoriler,
// tekrarlayan görevler, toplantı odası rezervasyonu, izin takvimi, yönetici paneli.
import { TASK_STATES, ROLES } from './config.js';

const KIND_LV = { yillik: 'Yıllık izin', mazeret: 'Mazeret', resmi: 'Resmi tatil / görev', diger: 'Diğer' };
const RULES = { gunluk: 'Her gün', haftaici: 'Hafta içi her gün', haftalik: 'Her hafta', aylik: 'Her ay' };
const DAYS = ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const PRIO = { 1: 'Yüksek', 2: 'Normal', 3: 'Düşük' };

export function initExt(ctx) {
  const { api, S, office } = ctx;
  const { $, $$, esc, toast, guard, nameOf, hhmm, fmtDate, todayStr, canEdit, canDelete } = ctx.h;
  const X = { comments: new Map(), followers: [], attachments: [], templates: [], bookings: [], leaves: [], openTask: null, view: null, leaveMonth: new Date(), adminData: null, tempPw: null };
  const me = () => S.profiles.get(S.me);
  const isAdmin = () => !!me()?.is_admin;
  const people = () => [...S.profiles.values()].sort((a, b) => a.display_name.localeCompare(b.display_name, 'tr'));
  const fmtSize = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
  const dt = (iso) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const ymd = (d) => d.toLocaleDateString('sv-SE');

  // ------------------------------------------------------------ Modal
  const modal = $('#modal'), mbody = $('#modal .m-body');
  function openModal(view, wide = false) { X.view = view; modal.hidden = false; modal.querySelector('.m-box').classList.toggle('wide', wide); }
  function closeModal() { modal.hidden = true; X.view = null; X.openTask = null; X.tempPw = null; }
  modal.querySelector('.m-x').onclick = closeModal;
  modal.addEventListener('pointerdown', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  // ------------------------------------------------------------ Yükleme ve canlı olaylar
  async function load() {
    const since = ymd(new Date(Date.now() - 2 * 864e5));
    const [c, f, a, t, b, l] = await Promise.all([
      api.list('task_comments', { order: ['created_at'] }), api.list('task_followers'), api.list('task_attachments', { order: ['created_at'] }),
      api.list('task_templates', { order: ['created_at'] }), api.list('room_bookings', { gte: { ends_at: new Date(Date.now() - 864e5).toISOString() }, order: ['starts_at'] }),
      api.list('leaves', { gte: { end_date: since }, order: ['start_date'] }),
    ].map((p) => p.catch((e) => { console.warn(e); return []; })));
    X.comments = new Map(); c.forEach(addComment);
    X.followers = f; X.attachments = a; X.templates = t; X.bookings = b; X.leaves = l;
    // Bugünün tekrarlayan görevleri sunucu zamanlayıcısından önce açıldıysa oluştur (tekrar oluşturmaz)
    api.rpc('run_recurring_today').catch(() => {});
    updateRoomSign(); refreshAll();
  }
  function addComment(c) { if (!X.comments.has(c.task_id)) X.comments.set(c.task_id, []); const l = X.comments.get(c.task_id); if (!l.some((x) => x.id === c.id)) l.push(c); }
  const upsert = (arr, row, key = 'id') => { const i = arr.findIndex((r) => r[key] === row[key]); if (i >= 0) arr[i] = row; else arr.push(row); };
  const drop = (arr, pred) => arr.filter((r) => !pred(r));

  function onTable(table, { type, row, old }) {
    switch (table) {
      case 'task_comments':
        if (type === 'DELETE') X.comments.forEach((l, k) => X.comments.set(k, l.filter((c) => c.id !== old.id)));
        else addComment(row);
        break;
      case 'task_followers':
        if (type === 'DELETE') X.followers = drop(X.followers, (f) => f.task_id === old.task_id && f.user_id === old.user_id);
        else if (!X.followers.some((f) => f.task_id === row.task_id && f.user_id === row.user_id)) X.followers.push(row);
        break;
      case 'task_attachments': if (type === 'DELETE') X.attachments = drop(X.attachments, (r) => r.id === old.id); else upsert(X.attachments, row); break;
      case 'task_templates': if (type === 'DELETE') X.templates = drop(X.templates, (r) => r.id === old.id); else upsert(X.templates, row); break;
      case 'room_bookings': if (type === 'DELETE') X.bookings = drop(X.bookings, (r) => r.id === old.id); else upsert(X.bookings, row); X.bookings.sort((a, b) => a.starts_at.localeCompare(b.starts_at)); updateRoomSign(); break;
      case 'leaves': if (type === 'DELETE') X.leaves = drop(X.leaves, (r) => r.id === old.id); else upsert(X.leaves, row); ctx.h.renderTeam(); break;
    }
    refreshAll();
  }
  function refreshAll() {
    ctx.h.renderTasks();
    if (X.view === 'task') renderTask(); else if (X.view === 'rooms') renderRooms(); else if (X.view === 'leaves') renderLeaves(); else if (X.view === 'templates') renderTemplates();
  }

  // ------------------------------------------------------------ Görev listesi için yardımcılar
  function taskMeta(t) {
    const cl = Array.isArray(t.checklist) ? t.checklist : [], done = cl.filter((x) => x.d).length;
    const nc = X.comments.get(t.id)?.length || 0, na = X.attachments.filter((a) => a.task_id === t.id).length;
    const pr = t.project_id ? ctx.h.projectOf?.(t.project_id) : null;
    return `${pr ? `<span class="prc" style="--pc:${esc(pr.color)}">${esc(pr.code)}</span>` : ''}${t.state === 'engel' ? `<span class="bad">⛔ ${esc(t.block_reason || 'Engel')}</span>` : ''}${t.hours ? `<span>⏱ ${t.hours} sa</span>` : ''}${t.category ? `<span class="cat">#${esc(t.category)}</span>` : ''}${cl.length ? `<span>☑ ${done}/${cl.length}</span>` : ''}${nc ? `<span>💬 ${nc}</span>` : ''}${na ? `<span>📎 ${na}</span>` : ''}${t.template_id ? '<span title="Tekrarlayan görev">🔁</span>' : ''}`;
  }
  const categories = () => [...new Set([...S.tasks.values()].map((t) => t.category).concat(X.templates.map((t) => t.category)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const isFollower = (taskId, uid = S.me) => X.followers.some((f) => f.task_id === taskId && f.user_id === uid);
  const leaveToday = (uid) => { const ak = ctx.h.ak?.(); if (ak?.connected) return ak.leaveToday(uid); const d = todayStr(); return X.leaves.find((l) => l.user_id === uid && l.start_date <= d && l.end_date >= d); };

  // ------------------------------------------------------------ Görev detayı
  function openTask(id) { if (!S.tasks.has(id)) { toast('Görev bulunamadı'); return; } X.openTask = id; openModal('task', true); renderTask(); }
  function renderTask() {
    const t = S.tasks.get(X.openTask);
    if (!t) { closeModal(); return; }
    const ed = canEdit(t), cl = Array.isArray(t.checklist) ? t.checklist : [];
    const comments = X.comments.get(t.id) || [], files = X.attachments.filter((a) => a.task_id === t.id);
    const fol = X.followers.filter((f) => f.task_id === t.id), canManageFol = isAdmin() || t.created_by === S.me || t.assignee === S.me;
    const tpl = t.template_id ? X.templates.find((x) => x.id === t.template_id) : null;
    const focused = document.activeElement?.closest?.('#modal') ? document.activeElement.name : null;
    mbody.innerHTML = `
      <div class="td-head">
        <button class="st ${t.state}" id="tdState" ${ed ? '' : 'disabled'} title="${TASK_STATES[t.state].label}">${t.state === 'bitti' ? '✓' : t.state === 'suruyor' ? '▶' : t.state === 'engel' ? '⛔' : ''}</button>
        ${ed ? `<input class="td-title" name="title" maxlength="120" value="${esc(t.title)}" />` : `<h3>${esc(t.title)}</h3>`}
      </div>
      <div class="td-grid">
        <label>Atanan<select name="assignee" ${ed ? '' : 'disabled'}><option value="">Atanmamış</option>${people().map((p) => `<option value="${esc(p.id)}" ${p.id === t.assignee ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select></label>
        <label>Termin<input type="date" name="due_date" value="${t.due_date || ''}" ${ed ? '' : 'disabled'} /></label>
        <label>Öncelik<select name="priority" ${ed ? '' : 'disabled'}>${[1, 2, 3].map((n) => `<option value="${n}" ${n === t.priority ? 'selected' : ''}>${PRIO[n]}</option>`).join('')}</select></label>
        <label>Tür<select name="kind" ${ed ? '' : 'disabled'}><option value="gunluk" ${t.kind === 'gunluk' ? 'selected' : ''}>Günlük</option><option value="planli" ${t.kind === 'planli' ? 'selected' : ''}>Planlı</option></select></label>
        <label>Proje<select name="project_id" ${ed ? '' : 'disabled'}><option value="">—</option>${(ctx.h.projects?.() || []).map((p) => `<option value="${p.id}" ${p.id === t.project_id ? 'selected' : ''}>${esc(p.code)} · ${esc(p.name)}</option>`).join('')}</select></label>
        <label>Saat (tahmini/harcanan)<input type="number" name="hours" min="0" max="99" step="0.5" value="${t.hours ?? ''}" ${ed ? '' : 'disabled'} /></label>
        <label>Kategori<input name="category" list="catList" maxlength="40" value="${esc(t.category || '')}" placeholder="ör. Hat 3 retrofit" ${ed ? '' : 'disabled'} /></label>
        <label>Durum<select name="state" ${ed ? '' : 'disabled'}>${Object.entries(TASK_STATES).map(([k, v]) => `<option value="${k}" ${k === t.state ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      </div>
      ${t.state === 'engel' ? `<label class="td-notes blk">⛔ Engel nedeni<input name="block_reason" maxlength="200" value="${esc(t.block_reason || '')}" ${ed ? '' : 'disabled'} placeholder="Ne bekleniyor?" /></label>` : ''}
      <label class="td-notes">Açıklama<textarea name="notes" maxlength="1000" rows="3" ${ed ? '' : 'disabled'} placeholder="Ayrıntılar…">${esc(t.notes || '')}</textarea></label>

      <section class="td-sec"><h4>Kontrol listesi ${cl.length ? `<span class="muted">${cl.filter((x) => x.d).length}/${cl.length}</span>` : ''}</h4>
        ${cl.length ? `<div class="prog"><i style="width:${Math.round((cl.filter((x) => x.d).length / cl.length) * 100)}%"></i></div>` : ''}
        <ul class="td-check">${cl.map((x, i) => `<li><label><input type="checkbox" data-ci="${i}" ${x.d ? 'checked' : ''} ${ed ? '' : 'disabled'} /><span class="${x.d ? 'done' : ''}">${esc(x.t)}</span></label>${ed ? `<button class="del" data-cdel="${i}">×</button>` : ''}</li>`).join('')}</ul>
        ${ed ? `<form class="td-add" id="clForm"><input name="t" maxlength="120" placeholder="Madde ekle…" required /><button>Ekle</button></form>` : ''}
      </section>

      <section class="td-sec"><h4>Dosyalar <span class="muted">${files.length || ''}</span></h4>
        <ul class="td-files">${files.map((a) => `<li><a href="#" data-file="${a.id}">📎 ${esc(a.name)}</a><span class="muted">${fmtSize(a.size)} · ${esc(nameOf(a.uploaded_by))} · ${dt(a.created_at)}</span>${a.uploaded_by === S.me || isAdmin() ? `<button class="del" data-fdel="${a.id}">×</button>` : ''}</li>`).join('') || '<li class="muted">Ek yok.</li>'}</ul>
        <label class="upload">＋ Dosya / fotoğraf ekle (en fazla 10 MB)<input type="file" id="tdFile" multiple hidden /></label>
      </section>

      <section class="td-sec"><h4>Takipçiler</h4>
        <div class="chips">${fol.map((f) => `<span class="chip2">${esc(nameOf(f.user_id))}${canManageFol || f.user_id === S.me ? `<button data-unf="${esc(f.user_id)}">×</button>` : ''}</span>`).join('') || '<span class="muted">Takipçi yok.</span>'}</div>
        <div class="td-add">
          <button id="followBtn">${isFollower(t.id) ? '🔕 Takibi bırak' : '🔔 Takip et'}</button>
          ${canManageFol ? `<select id="addFol"><option value="">+ Kişi ekle…</option>${people().filter((p) => !isFollower(t.id, p.id)).map((p) => `<option value="${esc(p.id)}">${esc(p.display_name)}</option>`).join('')}</select>` : ''}
        </div>
        <p class="muted small">Takipçilere bu göreve gelen yorumlar bildirim olarak gider.</p>
      </section>

      <section class="td-sec"><h4>Yorumlar <span class="muted">${comments.length || ''}</span></h4>
        <ul class="td-comments">${comments.map((c) => `<li><b>${esc(nameOf(c.author))}</b> <time>${dt(c.created_at)}</time>${c.author === S.me || isAdmin() ? `<button class="del" data-mdel="${c.id}">×</button>` : ''}<div>${esc(c.body)}</div></li>`).join('') || '<li class="muted">Henüz yorum yok.</li>'}</ul>
        <form class="td-add" id="cmForm"><textarea name="body" maxlength="1000" rows="2" placeholder="Yorum yaz… (Ctrl+Enter gönderir)" required></textarea><button class="primary">Gönder</button></form>
      </section>

      <div class="td-foot muted small">Oluşturan: ${esc(nameOf(t.created_by))} · ${dt(t.created_at)}${tpl ? ` · 🔁 ${esc(RULES[tpl.rule])} tekrarlayan görevden` : ''}${t.done_at ? ` · Bitti: ${dt(t.done_at)}` : ''}
        ${canDelete(t) ? '<button class="danger" id="tdDel">Görevi sil</button>' : ''}</div>`;
    if (focused) mbody.querySelector(`[name="${focused}"]`)?.focus();

    const upd = (patch) => guard(() => api.updateTask(t.id, patch));
    $('#tdState', mbody)?.addEventListener('click', () => upd({ state: TASK_STATES[t.state].next }));
    $$('.td-grid select, .td-grid input, .td-title, .td-notes textarea, .td-notes input', mbody).forEach((el) => el.addEventListener('change', () => {
      const v = el.value.trim();
      if (el.name === 'title' && !v) { el.value = t.title; return; }
      const val = ['priority', 'project_id', 'hours'].includes(el.name) ? (v === '' ? null : Number(v)) : (v || null);
      upd({ [el.name]: el.name === 'title' ? v : val });
    }));
    const setCl = (next) => upd({ checklist: next });
    $$('[data-ci]', mbody).forEach((cb) => cb.onchange = () => setCl(cl.map((x, i) => (i === +cb.dataset.ci ? { ...x, d: cb.checked } : x))));
    $$('[data-cdel]', mbody).forEach((b) => b.onclick = () => setCl(cl.filter((_, i) => i !== +b.dataset.cdel)));
    const clf = $('#clForm', mbody); if (clf) clf.onsubmit = (e) => { e.preventDefault(); const v = clf.t.value.trim(); if (v && cl.length < 50) setCl([...cl, { t: v, d: false }]); };
    $('#tdFile', mbody).onchange = (e) => uploadFiles(t.id, [...e.target.files]);
    $$('[data-file]', mbody).forEach((a) => a.onclick = (e) => { e.preventDefault(); const f = X.attachments.find((x) => x.id === +a.dataset.file); guard(async () => { const url = await api.fileUrl(f.path, f.name); const w = window.open(url, '_blank'); if (!w) location.href = url; }); });
    $$('[data-fdel]', mbody).forEach((b) => b.onclick = () => {
      const f = X.attachments.find((x) => x.id === +b.dataset.fdel);
      if (confirm(`"${f.name}" silinsin mi?`)) guard(async () => { await api.remove('task_attachments', f.id); await api.removeFile(f.path); });
    });
    $('#followBtn', mbody).onclick = () => guard(() => (isFollower(t.id) ? api.remove('task_followers', { task_id: t.id, user_id: S.me }) : api.insert('task_followers', { task_id: t.id, user_id: S.me })));
    const af = $('#addFol', mbody); if (af) af.onchange = () => af.value && guard(() => api.insert('task_followers', { task_id: t.id, user_id: af.value }));
    $$('[data-unf]', mbody).forEach((b) => b.onclick = () => guard(() => api.remove('task_followers', { task_id: t.id, user_id: b.dataset.unf })));
    const cm = $('#cmForm', mbody);
    cm.onsubmit = (e) => { e.preventDefault(); const v = cm.body.value.trim(); if (!v) return; cm.body.value = ''; guard(() => api.insert('task_comments', { task_id: t.id, body: v })); };
    cm.body.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) cm.requestSubmit(); };
    $$('[data-mdel]', mbody).forEach((b) => b.onclick = () => confirm('Yorum silinsin mi?') && guard(() => api.remove('task_comments', +b.dataset.mdel)));
    const del = $('#tdDel', mbody); if (del) del.onclick = () => { if (confirm(`"${t.title}" silinsin mi? Yorumlar ve ekler de silinir. Bu geri alınamaz.`)) guard(async () => { const fs = X.attachments.filter((a) => a.task_id === t.id); await api.deleteTask(t.id); for (const f of fs) await api.removeFile(f.path); closeModal(); }); };
    renderCatList();
  }
  async function uploadFiles(taskId, files) {
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) { toast(`⚠️ ${f.name}: 10 MB'tan büyük`); continue; }
      const safe = f.name.normalize('NFKD').replace(/[^\w.\-]+/g, '_').slice(-80);
      const path = `${taskId}/${Date.now()}-${safe}`;
      await guard(async () => {
        toast('⏫ Yükleniyor: ' + f.name);
        await api.upload(path, f);
        await api.insert('task_attachments', { task_id: taskId, path, name: f.name.slice(0, 190), size: f.size, mime: (f.type || '').slice(0, 110) });
      });
    }
  }
  function renderCatList() { $('#catList').innerHTML = categories().map((c) => `<option value="${esc(c)}">`).join(''); }

  // ------------------------------------------------------------ Tekrarlayan görevler
  function openTemplates() { openModal('templates', true); renderTemplates(); }
  function renderTemplates() {
    const rows = X.templates;
    const desc = (t) => RULES[t.rule] + (t.rule === 'haftalik' ? ' · ' + DAYS[t.weekday] : '') + (t.rule === 'aylik' ? ` · ayın ${t.monthday}'i` : '');
    mbody.innerHTML = `<h3>🔁 Tekrarlayan görevler</h3>
      <p class="muted small">Her sabah 06:00'da kurala uyan şablonlardan görev oluşur ve atanan kişiye bildirim gider.</p>
      <ul class="tpl-list">${rows.map((t) => {
        const mine = t.created_by === S.me || isAdmin();
        return `<li class="${t.active ? '' : 'off'}"><div><b>${esc(t.title)}</b><span class="muted small">${esc(desc(t))} · ${esc(t.assignee ? nameOf(t.assignee) : 'Atanmamış')}${t.category ? ' · #' + esc(t.category) : ''}${t.last_run ? ' · son: ' + fmtDate(t.last_run) : ''}</span></div>
          ${mine ? `<label class="sw-tg"><input type="checkbox" data-tact="${t.id}" ${t.active ? 'checked' : ''}/> Aktif</label><button class="del" data-tdel="${t.id}">🗑</button>` : ''}</li>`;
      }).join('') || '<li class="muted">Henüz şablon yok.</li>'}</ul>
      <form id="tplForm" class="tpl-form">
        <input name="title" maxlength="120" placeholder="Görev başlığı (ör. Haftalık rapor)" required />
        <div class="row3">
          <select name="rule">${Object.entries(RULES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <select name="weekday" hidden>${DAYS.slice(1).map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}</select>
          <select name="monthday" hidden>${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}">Ayın ${i + 1}'i</option>`).join('')}</select>
        </div>
        <div class="row3">
          <select name="assignee">${people().map((p) => `<option value="${esc(p.id)}" ${p.id === S.me ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select>
          <select name="priority"><option value="1">Yüksek</option><option value="2" selected>Normal</option><option value="3">Düşük</option></select>
          <input name="category" list="catList" maxlength="40" placeholder="Kategori" />
        </div>
        <textarea name="notes" maxlength="1000" rows="2" placeholder="Açıklama (isteğe bağlı)"></textarea>
        <button class="primary">Şablon ekle</button>
      </form>`;
    renderCatList();
    const f = $('#tplForm', mbody);
    const sync = () => { f.weekday.hidden = f.rule.value !== 'haftalik'; f.monthday.hidden = f.rule.value !== 'aylik'; };
    f.rule.onchange = sync; sync();
    f.onsubmit = (e) => {
      e.preventDefault();
      const row = { title: f.title.value.trim(), rule: f.rule.value, assignee: f.assignee.value || null, priority: Number(f.priority.value),
        category: f.category.value.trim() || null, notes: f.notes.value.trim() || null,
        weekday: f.rule.value === 'haftalik' ? Number(f.weekday.value) : null, monthday: f.rule.value === 'aylik' ? Number(f.monthday.value) : null };
      guard(async () => { await api.insert('task_templates', row); const n = await api.rpc('run_recurring_today'); toast(n ? '🔁 Şablon eklendi, bugünün görevi oluşturuldu' : '🔁 Şablon eklendi'); });
    };
    $$('[data-tact]', mbody).forEach((c) => c.onchange = () => guard(() => api.update('task_templates', +c.dataset.tact, { active: c.checked })));
    $$('[data-tdel]', mbody).forEach((b) => b.onclick = () => confirm('Şablon silinsin mi? Daha önce oluşmuş görevler kalır.') && guard(() => api.remove('task_templates', +b.dataset.tdel)));
  }

  // ------------------------------------------------------------ Toplantı odası rezervasyonu
  function currentBooking(now = new Date()) { const iso = now.toISOString(); return X.bookings.find((b) => b.starts_at <= iso && b.ends_at > iso); }
  function nextBooking(now = new Date()) { const iso = now.toISOString(); return X.bookings.find((b) => b.starts_at > iso); }
  const tm = (iso) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  function updateRoomSign() {
    const cur = currentBooking(), nx = nextBooking();
    const sameDay = (iso) => new Date(iso).toDateString() === new Date().toDateString();
    const inside = [...S.profiles.values()].filter((p) => p.status === 'toplantida').length;
    const later = nx && sameDay(nx.starts_at) ? ` · ${tm(nx.starts_at)}'da rezervasyon var` : '';
    if (cur) office.setRoomSign(`🔴 <b>Dolu</b> · ${tm(cur.ends_at)}'a kadar<br><span>${esc(cur.title)} — ${esc(nameOf(cur.booked_by))}</span>`, 'busy');
    else if (inside) office.setRoomSign(`🟡 <b>Kullanımda</b> · ${inside} kişi (rezervasyonsuz)${later}<br><span>Rezervasyon için tıkla</span>`, 'used');
    else office.setRoomSign(`🟢 <b>Boş</b>${later}<br><span>Rezerve etmek için tıkla</span>`, '');
  }
  setInterval(updateRoomSign, 30000);
  office.onRoomClick = () => openRooms();
  function openRooms() { openModal('rooms'); renderRooms(); }
  function renderRooms() {
    const days = new Map();
    X.bookings.filter((b) => b.ends_at > new Date().toISOString()).forEach((b) => {
      const d = new Date(b.starts_at).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
      if (!days.has(d)) days.set(d, []); days.get(d).push(b);
    });
    const cur = currentBooking();
    const now = new Date(), start = new Date(Math.ceil(now.getTime() / 9e5) * 9e5);
    const pad = (n) => String(n).padStart(2, '0');
    mbody.innerHTML = `<h3>📅 Toplantı odası</h3>
      <div class="room-now ${cur ? 'busy' : ''}">${cur ? `🔴 Şu an dolu: <b>${esc(cur.title)}</b> (${esc(nameOf(cur.booked_by))}) · ${tm(cur.ends_at)}'a kadar` : '🟢 Şu an boş'}</div>
      <form id="rbForm" class="rb-form">
        <input name="title" maxlength="80" placeholder="Toplantı konusu" required />
        <div class="row3"><input type="date" name="day" value="${ymd(start)}" min="${ymd(now)}" required />
          <input type="time" name="from" step="900" value="${pad(start.getHours())}:${pad(start.getMinutes())}" required />
          <input type="time" name="to" step="900" value="${pad((start.getHours() + 1) % 24)}:${pad(start.getMinutes())}" required /></div>
        <button class="primary">Rezerve et</button>
      </form>
      <div class="rb-list">${[...days].map(([d, list]) => `<h4>${d}</h4><ul>${list.map((b) => `<li class="${b === cur ? 'now' : ''}"><b>${tm(b.starts_at)}–${tm(b.ends_at)}</b> ${esc(b.title)} <span class="muted">· ${esc(nameOf(b.booked_by))}</span>${b.booked_by === S.me || isAdmin() ? `<button class="del" data-bdel="${b.id}">İptal</button>` : ''}</li>`).join('')}</ul>`).join('') || '<p class="muted">Yaklaşan rezervasyon yok.</p>'}</div>`;
    const f = $('#rbForm', mbody);
    f.onsubmit = (e) => {
      e.preventDefault();
      const s = new Date(`${f.day.value}T${f.from.value}`), en = new Date(`${f.day.value}T${f.to.value}`);
      if (!(en > s)) { toast('⚠️ Bitiş saati başlangıçtan sonra olmalı'); return; }
      if (en < new Date()) { toast('⚠️ Geçmiş bir saat seçtin'); return; }
      guard(async () => { await api.insert('room_bookings', { title: f.title.value.trim(), starts_at: s.toISOString(), ends_at: en.toISOString() }); toast('📅 Oda rezerve edildi'); f.title.value = ''; });
    };
    $$('[data-bdel]', mbody).forEach((b) => b.onclick = () => confirm('Rezervasyon iptal edilsin mi?') && guard(() => api.remove('room_bookings', +b.dataset.bdel)));
  }

  // ------------------------------------------------------------ İzin takvimi
  function openLeaves() { openModal('leaves', true); renderLeaves(); }
  function renderLeaves() {
    const ak = ctx.h.ak?.();
    if (ak?.connected) return ak.renderLeaves(mbody, renderLeaves, X.leaveMonth, (d) => { X.leaveMonth = new Date(X.leaveMonth.getFullYear(), X.leaveMonth.getMonth() + d, 1); renderLeaves(); });
    const m = X.leaveMonth, y = m.getFullYear(), mo = m.getMonth();
    const first = new Date(y, mo, 1), startDow = (first.getDay() + 6) % 7, daysIn = new Date(y, mo + 1, 0).getDate();
    const today = todayStr();
    let cells = '';
    for (let i = 0; i < startDow; i++) cells += '<div class="cal-c empty"></div>';
    for (let d = 1; d <= daysIn; d++) {
      const ds = ymd(new Date(y, mo, d)), dow = (startDow + d - 1) % 7;
      const who = X.leaves.filter((l) => l.start_date <= ds && l.end_date >= ds);
      cells += `<div class="cal-c ${ds === today ? 'today' : ''} ${dow >= 5 ? 'we' : ''}"><span class="dn">${d}</span>${who.map((l) => `<span class="lv" style="background:${esc(S.profiles.get(l.user_id)?.color || '#8a8f98')}" title="${esc(nameOf(l.user_id))} · ${KIND_LV[l.kind]}${l.note ? ' · ' + esc(l.note) : ''}">${esc(nameOf(l.user_id).split(' ')[0])}</span>`).join('')}</div>`;
    }
    const mineOrAll = X.leaves.filter((l) => l.end_date >= today && (l.user_id === S.me || isAdmin()));
    mbody.innerHTML = `<h3>🏖️ İzin takvimi</h3>
      <div class="cal-nav"><button id="calPrev">‹</button><b>${m.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}</b><button id="calNext">›</button></div>
      <div class="cal">${['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((d) => `<div class="cal-h">${d}</div>`).join('')}${cells}</div>
      <form id="lvForm" class="lv-form">
        ${isAdmin() ? `<select name="user_id">${people().map((p) => `<option value="${esc(p.id)}" ${p.id === S.me ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('')}</select>` : ''}
        <div class="row3"><input type="date" name="start_date" value="${today}" required /><input type="date" name="end_date" value="${today}" required />
          <select name="kind">${Object.entries(KIND_LV).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <input name="note" maxlength="80" placeholder="Not (isteğe bağlı)" />
        <button class="primary">İzin ekle</button>
      </form>
      <h4>${isAdmin() ? 'Yaklaşan izinler' : 'İzinlerim'}</h4>
      <ul class="lv-list">${mineOrAll.map((l) => `<li><b>${esc(nameOf(l.user_id))}</b> ${fmtDate(l.start_date)} – ${fmtDate(l.end_date)} · ${KIND_LV[l.kind]}${l.note ? ' · ' + esc(l.note) : ''}<button class="del" data-ldel="${l.id}">Sil</button></li>`).join('') || '<li class="muted">Kayıt yok.</li>'}</ul>
      <p class="muted small">İzin türü dışında sağlık bilgisi girmeyin.</p>`;
    $('#calPrev', mbody).onclick = () => { X.leaveMonth = new Date(y, mo - 1, 1); renderLeaves(); };
    $('#calNext', mbody).onclick = () => { X.leaveMonth = new Date(y, mo + 1, 1); renderLeaves(); };
    const f = $('#lvForm', mbody);
    f.onsubmit = (e) => {
      e.preventDefault();
      if (f.end_date.value < f.start_date.value) { toast('⚠️ Bitiş tarihi başlangıçtan önce olamaz'); return; }
      const row = { start_date: f.start_date.value, end_date: f.end_date.value, kind: f.kind.value, note: f.note.value.trim() || null };
      if (f.user_id) row.user_id = f.user_id.value;
      guard(async () => { await api.insert('leaves', row); toast('🏖️ İzin eklendi'); });
    };
    $$('[data-ldel]', mbody).forEach((b) => b.onclick = () => confirm('İzin kaydı silinsin mi?') && guard(() => api.remove('leaves', +b.dataset.ldel)));
  }

  // ------------------------------------------------------------ Yönetici paneli
  async function openAdmin() {
    if (!isAdmin()) { toast('Bu bölüm yalnız yöneticiler için'); return; }
    openModal('admin', true); mbody.innerHTML = '<p class="muted">Yükleniyor…</p>';
    await guard(async () => { X.adminData = await api.adminCall('list'); renderAdmin(); });
  }
  function renderAdmin() {
    const { users, settings } = X.adminData;
    const desks = office.deskNumbers, taken = new Map(users.filter((u) => u.desk_no).map((u) => [u.desk_no, u.display_name]));
    const lastIn = (iso) => (iso ? new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
    mbody.innerHTML = `<h3>🛡️ Yönetici paneli</h3>
      ${X.tempPw ? `<div class="temp-pw">🔑 <b>${esc(X.tempPw.name)}</b> için geçici şifre: <code>${esc(X.tempPw.pw)}</code> <button id="cpPw">Kopyala</button><br><span class="small">Kişiye güvenli bir yoldan ilet; profilinden değiştirmesini söyle. Bu şifre bir daha gösterilmez.</span></div>` : ''}
      <section class="adm-set">
        <div><span class="muted small">Davet kodu</span><code id="invCode">${esc(settings.invite_code || '—')}</code><button id="cpInv">Kopyala</button><button id="rotInv">Yenile</button></div>
        <div><span class="muted small">Kullanıcı sınırı</span><input type="number" id="maxU" min="1" max="200" value="${esc(settings.max_users || '20')}" /><button id="saveMax">Kaydet</button></div>
        <div><span class="muted small">E-posta bildirimleri</span><label class="sw-tg"><input type="checkbox" id="mailOn" ${settings.email_enabled === '1' ? 'checked' : ''}/> Açık</label><span class="muted small">Brevo anahtarı tanımlanana kadar e-posta gitmez.</span></div>
      </section>
      ${ctx.h.sched?.()?.editorHtml() ?? ''}
      <div class="adm-wrap"><table class="adm">
        <thead><tr><th>Kişi</th><th>Görev / unvan</th><th>Rol</th><th>Kapasite</th><th>E-posta</th><th>Son giriş</th><th>Masa</th><th>Bildirim</th><th title="Sistem yöneticisi: kullanıcı ve ayar yönetimi">Sistem yön.</th><th>Aktif</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr class="${u.active === false ? 'off' : ''}" data-u="${esc(u.id)}">
          <td><input class="adm-name" value="${esc(u.display_name)}" maxlength="40" /></td>
          <td><input class="adm-dept" value="${esc(u.dept || '')}" maxlength="40" placeholder="ör. Proje Mühendisi" /></td>
          <td><select class="adm-role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${(u.role || 'calisan') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
          <td><input class="adm-cap" type="number" min="0" max="24" step="0.5" value="${u.capacity ?? 8}" title="Günlük saat" /></td>
          <td class="small">${esc(u.email || '')}</td><td class="small">${lastIn(u.last_sign_in_at)}</td>
          <td><select class="adm-desk"><option value="">—</option>${desks.map((n) => `<option value="${n}" ${n === u.desk_no ? 'selected' : ''} ${taken.has(n) && n !== u.desk_no ? 'disabled' : ''}>${esc(office.deskName(n))}${taken.has(n) && n !== u.desk_no ? ' (' + esc(taken.get(n)) + ')' : ''}</option>`).join('')}</select></td>
          <td class="small">${u.push ? '🔔 ' + u.push : '—'}</td>
          <td><input type="checkbox" class="adm-admin" ${u.is_admin ? 'checked' : ''} ${u.id === S.me ? 'disabled' : ''}/></td>
          <td><input type="checkbox" class="adm-active" ${u.active !== false ? 'checked' : ''} ${u.id === S.me ? 'disabled' : ''}/></td>
          <td><button class="adm-pw">Şifre sıfırla</button></td></tr>`).join('')}</tbody></table></div>
      <p class="muted small"><b>Roller:</b> Çalışan kendi işlerini yönetir · Yönetici herkesin görev ve aksiyonunu düzenler, herkese görev atar · Müdür ayrıca projeleri açar/siler ve kapasiteleri belirler · Sistem yöneticisi kullanıcıları ve ayarları yönetir.</p>
      <p class="muted small">Pasife alınan kişi giriş yapamaz ve ofiste görünmez; görevleri ve mesajları silinmez. Tekrar aktif edilebilir.</p>`;
    const call = (action, payload, msg) => guard(async () => { const r = await api.adminCall(action, payload); if (msg) toast(msg); X.adminData = await api.adminCall('list'); renderAdmin(); return r; });
    const copy = (txt) => navigator.clipboard?.writeText(txt).then(() => toast('📋 Kopyalandı'), () => toast(txt));
    $('#cpInv', mbody).onclick = () => copy(settings.invite_code);
    $('#rotInv', mbody).onclick = () => confirm('Davet kodu yenilensin mi? Eski kod artık çalışmaz.') && call('rotate_invite', {}, '🔁 Yeni davet kodu oluşturuldu');
    ctx.h.sched?.()?.bindEditor(mbody, renderAdmin);
    $('#saveMax', mbody).onclick = () => call('set_setting', { key: 'max_users', value: $('#maxU', mbody).value }, 'Kaydedildi');
    $('#mailOn', mbody).onchange = (e) => call('set_setting', { key: 'email_enabled', value: e.target.checked ? '1' : '0' }, e.target.checked ? 'E-posta açık' : 'E-posta kapalı');
    const cp = $('#cpPw', mbody); if (cp) cp.onclick = () => copy(X.tempPw.pw);
    $$('tr[data-u]', mbody).forEach((tr) => {
      const id = tr.dataset.u, u = users.find((x) => x.id === id);
      tr.querySelector('.adm-name').onchange = (e) => call('set_name', { user_id: id, display_name: e.target.value }, 'Ad güncellendi');
      tr.querySelector('.adm-dept').onchange = (e) => call('set_profile', { user_id: id, dept: e.target.value }, 'Unvan güncellendi');
      tr.querySelector('.adm-role').onchange = (e) => call('set_profile', { user_id: id, role: e.target.value }, 'Rol: ' + ROLES[e.target.value]);
      tr.querySelector('.adm-cap').onchange = (e) => call('set_profile', { user_id: id, capacity: e.target.value }, 'Kapasite güncellendi');
      tr.querySelector('.adm-desk').onchange = (e) => call('set_desk', { user_id: id, desk_no: e.target.value || null }, 'Masa güncellendi');
      tr.querySelector('.adm-admin').onchange = (e) => call('set_admin', { user_id: id, is_admin: e.target.checked }, 'Yetki güncellendi');
      tr.querySelector('.adm-active').onchange = (e) => {
        if (!e.target.checked && !confirm(`${u.display_name} pasife alınsın mı? Giriş yapamaz.`)) { e.target.checked = true; return; }
        call('set_active', { user_id: id, active: e.target.checked }, e.target.checked ? 'Hesap aktif' : 'Hesap pasife alındı');
      };
      tr.querySelector('.adm-pw').onclick = () => {
        if (!confirm(`${u.display_name} için yeni geçici şifre oluşturulsun mu? Mevcut şifresi çalışmaz.`)) return;
        guard(async () => { const r = await api.adminCall('reset_password', { user_id: id }); X.tempPw = { name: u.display_name, pw: r.temp_password }; renderAdmin(); });
      };
    });
  }

  // ------------------------------------------------------------ Menü
  const menu = $('#xMenu');
  function renderMenu() {
    menu.innerHTML = `<button data-x="rooms">📅 Toplantı odası</button><button data-x="leaves">🏖️ İzin takvimi</button>${ctx.h.ak?.()?.connected ? '' : '<button data-x="templates">🔁 Tekrarlayan görevler</button>'}${isAdmin() ? '<button data-x="admin">🛡️ Yönetici paneli</button>' : ''}`;
    $$('[data-x]', menu).forEach((b) => b.onclick = () => { menu.hidden = true; ({ rooms: openRooms, leaves: openLeaves, templates: openTemplates, admin: openAdmin })[b.dataset.x](); });
  }
  const toggleMenu = (e) => { e.stopPropagation(); renderMenu(); menu.hidden = !menu.hidden; };
  $('#menuBtn').onclick = toggleMenu; $('#menuBtnM').onclick = toggleMenu;
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('#menuBtn,#menuBtnM')) menu.hidden = true; });

  return { updateRoomSign, load, onTable, openTask, taskMeta, categories, leaveToday, refreshTask: () => X.view === 'task' && renderTask(), renderCatList, openRooms, openLeaves, openTemplates, openAdmin };
}
