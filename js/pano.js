// Pano (Asakai), Projeler, Kapasite ve Kişisel panel.
// 3D ofisin üstünde tam sayfa görünüm olarak açılır; 3D sahne ve animasyonları arkada çalışmaya devam eder.
import { STATUSES, MOODS, ROLES, levelOf, PHASES, PDCA, PDCA_T, TASK_STATES } from './config.js';

export function initPano(ctx) {
  const { api, S, office } = ctx;
  const { $, $$, esc, toast, guard, nameOf, todayStr } = ctx.h;
  const P = { projects: [], actions: [], checkins: [], view: 'office', tab: 'pano', person: null, filter: 'open', fPr: '', showNew: false, showNewPr: false, weekOff: 0,
    meet: { left: 15 * 60, total: 15 * 60, running: false, timer: null } };
  const page = $('#page');
  const me = () => S.profiles.get(S.me);
  const lvl = () => levelOf(me());
  const people = () => [...S.profiles.values()].sort((a, b) => a.display_name.localeCompare(b.display_name, 'tr'));
  const ymd = (d) => d.toLocaleDateString('sv-SE');
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const isWE = (d) => d.getDay() === 0 || d.getDay() === 6;
  const prevWork = (d) => { let x = addDays(d, -1); while (isWE(x)) x = addDays(x, -1); return x; };
  const monday = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const fmtD = (s) => (s ? new Date(s + 'T00:00').toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
  const initials = (n) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toLocaleUpperCase('tr');
  const proj = (id) => P.projects.find((p) => p.id === id);

  // ------------------------------------------------------------ Veri
  async function load() {
    const [pr, ac, ck] = await Promise.all([
      api.list('projects', { order: ['code'] }), api.list('actions', { order: ['id'] }),
      api.list('checkins', { gte: { day: ymd(addDays(new Date(), -14)) } }),
    ].map((p) => p.catch((e) => { console.warn(e); return []; })));
    P.projects = pr; P.actions = ac; P.checkins = ck;
    const u = new URL(location.href); if (u.searchParams.has('pano')) show('pano');
    render();
  }
  const upsert = (arr, row, eq) => { const i = arr.findIndex((r) => eq(r)); if (i >= 0) arr[i] = row; else arr.push(row); };
  function onTable(table, { type, row, old }) {
    if (table === 'projects') { if (type === 'DELETE') P.projects = P.projects.filter((r) => r.id !== old.id); else upsert(P.projects, row, (r) => r.id === row.id); P.projects.sort((a, b) => a.code.localeCompare(b.code)); }
    else if (table === 'actions') { if (type === 'DELETE') P.actions = P.actions.filter((r) => r.id !== old.id); else upsert(P.actions, row, (r) => r.id === row.id); }
    else if (table === 'checkins') { if (type === 'DELETE') P.checkins = P.checkins.filter((r) => !(r.user_id === old.user_id && r.day === old.day)); else upsert(P.checkins, row, (r) => r.user_id === row.user_id && r.day === row.day); }
    else return;
    render(); ctx.h.renderTasks();
  }

  // ------------------------------------------------------------ Hesaplar
  const today = () => todayStr();
  const yIso = () => ymd(prevWork(new Date()));
  const tasksOf = (uid) => [...S.tasks.values()].filter((t) => t.assignee === uid);
  const doneOn = (uid, day) => tasksOf(uid).filter((t) => t.state === 'bitti' && t.done_at && ymd(new Date(t.done_at)) === day);
  const todayPlan = (uid) => tasksOf(uid).filter((t) => t.state !== 'bitti' && t.state !== 'engel' && (!t.due_date ? t.kind === 'gunluk' : t.due_date <= today()));
  const blocks = (uid) => tasksOf(uid).filter((t) => t.state === 'engel');
  const checkedIn = (uid) => P.checkins.some((c) => c.user_id === uid && c.day === today());
  const actStatus = (a) => (a.pdca >= 4 ? 'kapali' : a.due && a.due < today() ? 'gecikti' : 'acik');
  function weekLoad(uid, off = 0) {
    const mon = addDays(monday(new Date()), off * 7), days = [0, 1, 2, 3, 4].map((i) => ymd(addDays(mon, i)));
    const per = days.map((d) => tasksOf(uid).filter((t) => (t.due_date === d) || (t.state === 'bitti' && t.done_at && ymd(new Date(t.done_at)) === d && !t.due_date)).reduce((s, t) => s + Number(t.hours || 0), 0));
    const cap = Number(S.profiles.get(uid)?.capacity ?? 8);
    const sum = per.reduce((a, b) => a + b, 0);
    return { days, per, cap, sum, capW: cap * 5, pct: cap ? Math.round((sum / (cap * 5)) * 100) : 0 };
  }
  function projRisk(p) {
    const tasks = [...S.tasks.values()].filter((t) => t.project_id === p.id);
    const acts = P.actions.filter((a) => a.project_id === p.id);
    const late = p.status !== 'tamamlandi' && p.due && p.due < today();
    const lateActs = acts.filter((a) => actStatus(a) === 'gecikti').length;
    const blk = tasks.filter((t) => t.state === 'engel').length;
    return { late, lateActs, blk, open: tasks.filter((t) => t.state !== 'bitti').length, openActs: acts.filter((a) => a.pdca < 4).length, risky: late || lateActs > 0 || blk > 0 };
  }
  const canEditAction = (a) => lvl() >= 1 || a.owner === S.me || a.created_by === S.me;
  const canEditProject = (p) => lvl() >= 2 || p.lead === S.me;

  // ------------------------------------------------------------ Görünüm geçişi
  function show(view, person) {
    P.view = view; if (view === 'me') P.person = person || S.me;
    document.body.dataset.view = view;
    $$('#viewSw button').forEach((b) => b.classList.toggle('active', b.dataset.v === view));
    page.hidden = view === 'office';
    if (view !== 'office') { page.classList.remove('enter'); void page.offsetWidth; page.classList.add('enter'); page.scrollTop = 0; clearTimeout(P.enterT); P.enterT = setTimeout(() => page.classList.remove('enter'), 700); }
    $$('.panel').forEach((x) => x.classList.remove('open'));
    render();
  }
  $$('#viewSw button').forEach((b) => b.onclick = () => show(b.dataset.v));

  // Kullanıcı bir alana yazarken canlı güncellemeler sayfayı yeniden çizip yazdığını silmesin:
  // odak sayfadaki bir giriş alanındaysa çizimi ertele, odak çıkınca (tıklamalar işlendikten sonra) çiz.
  const typing = () => { const a = document.activeElement; return a && page.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  page.addEventListener('focusout', () => setTimeout(() => { if (P.pending && !typing()) { P.pending = false; render(); } }, 300));
  function render(force) {
    if (P.view === 'office' || !S.me) return;
    if (!force && typing()) { P.pending = true; return; }
    P.pending = false;
    const y = page.scrollTop;
    page.innerHTML = P.view === 'me' ? renderMe() : renderPano();
    page.scrollTop = y;
    bind();
    $$('[data-count]', page).forEach((el) => countUp(el, Number(el.dataset.count)));
  }
  function countUp(el, to) {
    const from = Number(el.dataset.prev || 0); el.dataset.prev = to;
    if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to; return; }
    const t0 = performance.now(), dur = 500;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  // ------------------------------------------------------------ PANO
  function renderPano() {
    const ps = people(), act = P.projects.filter((p) => p.status !== 'tamamlandi');
    const risky = act.filter((p) => projRisk(p).risky).length;
    const inCount = ps.filter((p) => checkedIn(p.id)).length;
    const openBlk = [...S.tasks.values()].filter((t) => t.state === 'engel').length;
    const lateA = P.actions.filter((a) => actStatus(a) === 'gecikti').length;
    const dstr = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }).toLocaleUpperCase('tr');
    const tabs = `<div class="pg-tabs">${[['pano', 'Pano'], ['projeler', 'Projeler'], ['kapasite', 'Kapasite']].map(([k, l]) => `<button data-tab="${k}" class="${P.tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>`;
    const m = P.meet, mm = String(Math.floor(m.left / 60)).padStart(2, '0'), ss = String(m.left % 60).padStart(2, '0');
    const speaker = m.running ? currentSpeaker() : null;
    const head = `<header class="pg-head">
      <div><div class="pg-kicker">PROJE MÜHENDİSLİĞİ · ${dstr}</div><h1>${P.tab === 'projeler' ? 'Projeler' : P.tab === 'kapasite' ? 'Kapasite' : 'Proje panosu'}</h1></div>
      <div class="kpis">
        <div class="kpi ${risky ? 'bad' : ''}"><b><span data-count="${risky}">0</span>/${act.length}</b><span>Riskli / geciken proje</span></div>
        <div class="kpi ${inCount < ps.length ? 'bad' : 'ok'}"><b><span data-count="${inCount}">0</span>/${ps.length}</b><span>Bugün giriş yapan</span></div>
        <div class="kpi ${openBlk ? 'bad' : ''}"><b><span data-count="${openBlk}">0</span></b><span>Açık engel</span></div>
        <div class="kpi ${lateA ? 'bad' : ''}"><b><span data-count="${lateA}">0</span></b><span>Geciken aksiyon</span></div>
      </div></header>
      <div class="pg-bar">${tabs}<span class="spacer"></span>
        ${lvl() >= 2 ? '<button id="pgExport" title="Tüm verileri JSON olarak indir">⬇ Yedek</button>' : ''}
        <div class="meet ${m.running ? 'run' : ''}"><span class="muted small">TOPLANTI</span><b>${mm}:${ss}</b>
          <button id="mtPlay" title="${m.running ? 'Duraklat' : 'Başlat'}">${m.running ? '⏸' : '▶'}</button><button id="mtReset" title="Sıfırla">↺</button></div>
        ${speaker ? `<span class="speaker">🎤 ${esc(speaker.display_name)}</span>` : ''}
      </div>`;
    if (P.tab === 'projeler') return head + renderProjects();
    if (P.tab === 'kapasite') return head + renderCapacity();
    return head + renderTeam(speaker) + renderActions();
  }

  function renderTeam(speaker) {
    const cards = people().map((p) => {
      const st = STATUSES[p.status] ?? STATUSES.musait, w = weekLoad(p.id), on = S.online.has(p.id), ci = checkedIn(p.id);
      const leave = ctx.h.leaveToday?.(p.id);
      return `<article class="pcard ${speaker?.id === p.id ? 'speaking' : ''}" data-person="${esc(p.id)}" tabindex="0">
        <div class="pc-top"><span class="pc-av" style="background:${esc(p.color)}">${esc(initials(p.display_name))}<i class="${on ? 'on' : ''}"></i></span>
          <div class="pc-name"><b>${esc(p.display_name)}</b><span>${esc(p.dept || ROLES[p.role] || '')}</span></div>
          <span class="ci ${ci ? 'yes' : ''}">${ci ? 'Girildi' : 'Girilmedi'}</span></div>
        <div class="pc-st"><span class="chip" style="background:${st.color}">${st.icon} ${st.label}</span>${leave ? '<span class="chip" style="background:#8a8f98">🏖️ İzinli</span>' : ''}<span title="Duygu durumu">${MOODS[p.mood || 'normal']?.icon || ''}</span></div>
        <div class="pc-nums"><div><b>${doneOn(p.id, yIso()).length}</b><span>Dün yapılan</span></div><div><b>${todayPlan(p.id).length}</b><span>Bugün planlı</span></div><div class="${blocks(p.id).length ? 'bad' : ''}"><b>${blocks(p.id).length}</b><span>Engel</span></div></div>
        <div class="pc-load"><span>Bu hafta doluluk · ${w.sum} sa / ${w.capW} sa</span><b>%${w.pct}</b></div>
        <div class="bar ${w.pct > 100 ? 'over' : ''}"><i style="width:${Math.min(100, w.pct)}%"></i></div>
      </article>`;
    }).join('');
    return `<section class="pg-sec"><div class="sec-h"><h2>01 · Ekip bugün</h2><span class="muted small">Ayrıntı için kişiye tıklayın.</span></div><div class="pcards">${cards}</div></section>`;
  }

  function renderActions() {
    let list = P.actions.slice();
    if (P.fPr) list = list.filter((a) => String(a.project_id) === P.fPr);
    if (P.filter === 'open') list = list.filter((a) => a.pdca < 4);
    const order = { gecikti: 0, acik: 1, kapali: 2 };
    list.sort((a, b) => order[actStatus(a)] - order[actStatus(b)] || (a.due || '9').localeCompare(b.due || '9'));
    const prOpts = (sel) => `<option value="">—</option>${P.projects.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.code)}</option>`).join('')}`;
    const ppl = (sel) => `<option value="">—</option>${people().map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('')}`;
    const rows = list.map((a) => {
      const ed = canEditAction(a), st = actStatus(a), dis = ed ? '' : 'disabled';
      return `<tr data-a="${a.id}" class="st-${st}">
        <td><b>#${a.id}</b><span class="muted small">${a.opened ? new Date(a.opened + 'T00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) : ''}</span></td>
        <td><select data-f="project_id" class="pr-sel" ${dis}>${prOpts(a.project_id)}</select></td>
        <td><textarea data-f="problem" rows="2" maxlength="300" ${dis}>${esc(a.problem)}</textarea></td>
        <td><textarea data-f="countermeasure" rows="2" maxlength="300" placeholder="Karşı önlem…" ${dis}>${esc(a.countermeasure || '')}</textarea></td>
        <td><select data-f="owner" ${dis}>${ppl(a.owner)}</select></td>
        <td><input type="date" data-f="due" value="${a.due || ''}" class="${st === 'gecikti' ? 'late' : ''}" ${dis}/></td>
        <td><div class="pdca">${PDCA.map((l, i) => `<button data-pdca="${i}" class="${a.pdca > i ? 'done' : a.pdca === i ? 'cur' : ''}" title="${PDCA_T[i]}" ${dis}>${l}</button>`).join('')}</div></td>
        <td><span class="ast ${st}">${st === 'gecikti' ? 'Gecikti' : st === 'kapali' ? 'Kapalı' : 'Açık'}</span></td>
        <td>${lvl() >= 1 || a.created_by === S.me ? `<button class="del" data-adel="${a.id}" title="Sil">🗑</button>` : ''}</td></tr>`;
    }).join('');
    const nw = P.showNew ? `<tr class="new-row"><td>Yeni</td><td><select id="naPr" class="pr-sel">${prOpts(Number(P.fPr) || null)}</select></td>
        <td><textarea id="naProblem" rows="2" maxlength="300" placeholder="Sorun nedir?"></textarea></td><td><textarea id="naCm" rows="2" maxlength="300" placeholder="Karşı önlem"></textarea></td>
        <td><select id="naOwner">${ppl(S.me)}</select></td><td><input type="date" id="naDue" value="${ymd(addDays(new Date(), 7))}"/></td>
        <td colspan="3"><button class="primary" id="naSave">Kaydet</button> <button id="naCancel">Vazgeç</button></td></tr>` : '';
    return `<section class="pg-sec"><div class="sec-h"><h2>02 · Sorunlar ve aksiyonlar</h2><span class="muted small">Hücrelere doğrudan yazın; PDCA kutularına tıklayarak ilerletin.</span><span class="spacer"></span>
        <select id="fPr"><option value="">Tüm projeler</option>${P.projects.map((p) => `<option value="${p.id}" ${String(p.id) === P.fPr ? 'selected' : ''}>${esc(p.code)} · ${esc(p.name)}</option>`).join('')}</select>
        <div class="seg"><button data-flt="open" class="${P.filter === 'open' ? 'active' : ''}">Açık</button><button data-flt="all" class="${P.filter === 'all' ? 'active' : ''}">Tümü</button></div>
        <button class="primary" id="newAct">＋ Sorun ekle</button></div>
      <div class="pdca-legend">${PDCA.map((l, i) => `<span><b>${l}</b> ${PDCA_T[i]}</span>`).join('')}</div>
      <div class="tbl-wrap"><table class="acts"><thead><tr><th>No</th><th>Proje</th><th>Sorun</th><th>Karşı önlem</th><th>Sorumlu</th><th>Termin</th><th>PDCA</th><th>Durum</th><th></th></tr></thead>
      <tbody>${nw}${rows || `<tr><td colspan="9" class="empty">${P.filter === 'open' ? 'Açık sorun yok 🎉' : 'Kayıt yok'}</td></tr>`}</tbody></table></div></section>`;
  }

  function renderProjects() {
    const cards = P.projects.map((p) => {
      const r = projRisk(p), ed = canEditProject(p), dis = ed ? '' : 'disabled';
      return `<article class="prj ${r.risky && p.status !== 'tamamlandi' ? 'risky' : ''} ${p.status}" data-p="${p.id}" style="--pc:${esc(p.color)}">
        <div class="prj-h"><span class="code">${esc(p.code)}</span>${r.risky && p.status !== 'tamamlandi' ? '<span class="risk">RİSK</span>' : ''}
          <select data-pf="status" ${dis}>${[['aktif', 'Aktif'], ['beklemede', 'Beklemede'], ['tamamlandi', 'Tamamlandı']].map(([k, l]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <input class="prj-name" data-pf="name" value="${esc(p.name)}" maxlength="80" ${dis}/>
        <div class="prj-meta"><label>Müşteri<input data-pf="customer" value="${esc(p.customer || '')}" maxlength="60" ${dis}/></label>
          <label>Lider<select data-pf="lead" ${lvl() >= 2 ? '' : 'disabled'}><option value="">—</option>${people().map((x) => `<option value="${esc(x.id)}" ${x.id === p.lead ? 'selected' : ''}>${esc(x.display_name)}</option>`).join('')}</select></label>
          <label>Termin<input type="date" data-pf="due" value="${p.due || ''}" class="${r.late ? 'late' : ''}" ${dis}/></label></div>
        <div class="phases">${PHASES.map((ph, i) => `<button data-phase="${i}" class="${i < p.phase ? 'done' : i === p.phase ? 'cur' : ''}" ${dis} title="${ph}"><i></i><span>${ph}</span></button>`).join('')}</div>
        <div class="prj-nums"><span>📋 ${r.open} açık görev</span><span class="${r.blk ? 'bad' : ''}">⛔ ${r.blk} engel</span><span>🛠️ ${r.openActs} açık aksiyon</span><span class="${r.lateActs ? 'bad' : ''}">⏰ ${r.lateActs} geciken</span></div>
        ${lvl() >= 2 ? `<div class="prj-foot"><input type="color" data-pf="color" value="${esc(p.color)}" title="Renk"/><button class="del" data-pdel="${p.id}">Projeyi sil</button></div>` : ''}
      </article>`;
    }).join('');
    const form = P.showNewPr ? `<form id="prForm" class="prj new"><input name="code" placeholder="Kod (ör. PRJ-2501)" maxlength="20" required/><input name="name" placeholder="Proje adı" maxlength="80" required/>
      <input name="customer" placeholder="Müşteri" maxlength="60"/><select name="lead">${people().map((x) => `<option value="${esc(x.id)}" ${x.id === S.me ? 'selected' : ''}>${esc(x.display_name)}</option>`).join('')}</select>
      <input type="date" name="due"/><div class="row2"><button class="primary">Oluştur</button><button type="button" id="prCancel">Vazgeç</button></div></form>` : '';
    return `<section class="pg-sec"><div class="sec-h"><h2>Projeler</h2><span class="muted small">Aşamaya tıklayarak ilerletin. ${lvl() >= 2 ? '' : 'Proje açma/silme müdür yetkisindedir; lideri olduğun projeyi düzenleyebilirsin.'}</span><span class="spacer"></span>
      ${lvl() >= 2 ? '<button class="primary" id="newPr">＋ Proje</button>' : ''}</div>
      <div class="prjs">${form}${cards || '<p class="muted">Henüz proje yok.</p>'}</div></section>`;
  }

  function renderCapacity() {
    const mon = addDays(monday(new Date()), P.weekOff * 7), days = [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
    const rows = people().map((p) => {
      const w = weekLoad(p.id, P.weekOff);
      return `<tr><td><span class="dot" style="background:${esc(p.color)}"></span> ${esc(p.display_name)}<span class="muted small"> · ${w.cap} sa/gün</span></td>
        ${w.per.map((h) => { const r = w.cap ? h / w.cap : 0; return `<td><div class="cap-c ${r > 1 ? 'over' : r >= 0.75 ? 'full' : r > 0 ? 'some' : ''}" style="--r:${Math.min(1, r)}">${h ? h + ' sa' : '—'}</div></td>`; }).join('')}
        <td><b class="${w.pct > 100 ? 'bad' : ''}">%${w.pct}</b><div class="bar ${w.pct > 100 ? 'over' : ''}"><i style="width:${Math.min(100, w.pct)}%"></i></div></td></tr>`;
    }).join('');
    const noH = [...S.tasks.values()].filter((t) => t.state !== 'bitti' && !t.hours).length;
    return `<section class="pg-sec"><div class="sec-h"><h2>Haftalık kapasite</h2><span class="spacer"></span>
      <div class="seg"><button id="wPrev">‹</button><button id="wNow">${days[0].toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} – ${days[4].toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}</button><button id="wNext">›</button></div></div>
      <div class="tbl-wrap"><table class="cap"><thead><tr><th>Kişi</th>${days.map((d) => `<th class="${ymd(d) === today() ? 'today' : ''}">${d.toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric' })}</th>`).join('')}<th>Hafta</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small">Doluluk, görevlerin "saat" alanı ve termin günü üzerinden hesaplanır.${noH ? ` Saati girilmemiş ${noH} açık görev hesaba katılmadı.` : ''}${lvl() >= 2 ? ' Günlük kapasiteyi Yönetici panelinden değiştirebilirsin.' : ''}</p></section>`;
  }

  // ------------------------------------------------------------ KİŞİSEL PANEL
  function renderMe() {
    const p = S.profiles.get(P.person) || me(), self = p.id === S.me, canAct = self || lvl() >= 1;
    const st = STATUSES[p.status] ?? STATUSES.musait, w = weekLoad(p.id), ci = P.checkins.find((c) => c.user_id === p.id && c.day === today());
    const hour = new Date().getHours(), greet = hour < 12 ? 'Günaydın' : hour < 18 ? 'İyi günler' : 'İyi akşamlar';
    const li = (t, kind) => `<li class="${t.state}"><button class="st ${t.state}" data-tst="${t.id}" ${canAct ? '' : 'disabled'} title="${TASK_STATES[t.state].label}">${t.state === 'bitti' ? '✓' : t.state === 'suruyor' ? '▶' : t.state === 'engel' ? '⛔' : ''}</button>
      <div class="ml"><span class="t" data-open="${t.id}">${t.priority === 1 ? '❗ ' : ''}${esc(t.title)}</span>
      <span class="muted small">${t.project_id && proj(t.project_id) ? `<b style="color:${esc(proj(t.project_id).color)}">${esc(proj(t.project_id).code)}</b> · ` : ''}${t.hours ? t.hours + ' sa · ' : ''}${t.due_date ? fmtD(t.due_date) : ''}${kind === 'blk' && t.block_reason ? ' · ' + esc(t.block_reason) : ''}</span></div>
      ${canAct && t.state !== 'bitti' && t.state !== 'engel' ? `<button class="mini" data-blk="${t.id}" title="Engel bildir">⛔</button>` : ''}${canAct && t.state === 'engel' ? `<button class="mini" data-unblk="${t.id}" title="Engel kalktı">✅</button>` : ''}</li>`;
    const yd = doneOn(p.id, yIso()), td = todayPlan(p.id), bl = blocks(p.id);
    const upcoming = tasksOf(p.id).filter((t) => t.state !== 'bitti' && t.due_date && t.due_date > today()).sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8);
    const myActs = P.actions.filter((a) => a.owner === p.id && a.pdca < 4);
    const myPr = P.projects.filter((x) => x.lead === p.id && x.status !== 'tamamlandi');
    return `<header class="me-head">
      ${!self ? '<button class="back" id="meBack">‹ Panoya dön</button>' : ''}
      <div class="me-id"><span class="pc-av big" style="background:${esc(p.color)}">${esc(initials(p.display_name))}</span>
        <div><div class="pg-kicker">${self ? greet.toLocaleUpperCase('tr') : 'KİŞİ PANELİ'} · ${new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).toLocaleUpperCase('tr')}</div>
        <h1>${esc(p.display_name)}</h1><div class="muted">${esc(p.dept || '')}${p.dept ? ' · ' : ''}${p.is_admin ? 'Sistem yöneticisi · ' : ''}${ROLES[p.role] || 'Çalışan'} · <span class="chip" style="background:${st.color}">${st.icon} ${st.label}</span> ${MOODS[p.mood || 'normal']?.icon || ''}</div></div></div>
      <div class="kpis small-k"><div class="kpi"><b>${yd.length}</b><span>Dün yapılan</span></div><div class="kpi"><b>${td.length}</b><span>Bugün planlı</span></div>
        <div class="kpi ${bl.length ? 'bad' : ''}"><b>${bl.length}</b><span>Engel</span></div><div class="kpi ${w.pct > 100 ? 'bad' : ''}"><b>%${w.pct}</b><span>Bu hafta (${w.sum}/${w.capW} sa)</span></div></div>
    </header>
    <div class="me-grid">
      <section class="me-card checkin ${ci ? 'done' : ''}">
        <h3>${ci ? '✅ Bugünkü giriş tamam' : '📝 Günlük giriş'}</h3>
        <p class="muted small">${self ? 'Dün ne yaptın, bugün ne yapacaksın, bir engelin var mı? Listeler görevlerinden otomatik gelir; eksik varsa aşağıdan ekle.' : (ci ? 'Bugün giriş yaptı.' : 'Bugün henüz giriş yapmadı.')}</p>
        <h4>Dün (${new Date(yIso() + 'T00:00').toLocaleDateString('tr-TR', { weekday: 'long' })})</h4><ul class="mlist">${yd.map((t) => li(t)).join('') || '<li class="muted small">Dün tamamlanan görev yok.</li>'}</ul>
        <h4>Bugün</h4><ul class="mlist">${td.map((t) => li(t)).join('') || '<li class="muted small">Bugün için plan yok.</li>'}</ul>
        <h4>Engeller</h4><ul class="mlist">${bl.map((t) => li(t, 'blk')).join('') || '<li class="muted small">Engel yok 👍</li>'}</ul>
        ${self ? `<form id="qa" class="qa"><input name="title" maxlength="120" placeholder="＋ Hızlı ekle: bugün ne yapacaksın?" required />
          <select name="project_id"><option value="">Proje</option>${P.projects.filter((x) => x.status !== 'tamamlandi').map((x) => `<option value="${x.id}">${esc(x.code)}</option>`).join('')}</select>
          <input name="hours" type="number" min="0" max="24" step="0.5" placeholder="Saat" />
          <select name="when"><option value="bugun">Bugün</option><option value="yarin">Yarın</option><option value="dun">Dün yaptım</option></select><button class="primary">Ekle</button></form>
          <textarea id="ciNote" rows="2" maxlength="500" placeholder="Not (isteğe bağlı): toplantıda söylemek istediğin…">${esc(ci?.note || '')}</textarea>
          <button class="primary big" id="ciSave">${ci ? 'Girişi güncelle' : 'Günlük girişi tamamla'}</button>` : (ci?.note ? `<div class="note-box">💬 ${esc(ci.note)}</div>` : '')}
      </section>
      <div class="me-col">
        <section class="me-card"><h3>🛠️ ${self ? 'Aksiyonlarım' : 'Aksiyonları'} <span class="muted">${myActs.length}</span></h3>
          <ul class="mlist">${myActs.map((a) => `<li class="${actStatus(a)}"><div class="ml"><span class="t">${esc(a.problem)}</span><span class="muted small">${a.project_id && proj(a.project_id) ? esc(proj(a.project_id).code) + ' · ' : ''}${a.due ? 'Termin ' + fmtD(a.due) : ''}${actStatus(a) === 'gecikti' ? ' · <b class="bad">Gecikti</b>' : ''}</span></div>
            <div class="pdca sm">${PDCA.map((l, i) => `<button data-mpdca="${a.id}:${i}" class="${a.pdca > i ? 'done' : a.pdca === i ? 'cur' : ''}" ${canEditAction(a) ? '' : 'disabled'} title="${PDCA_T[i]}">${l}</button>`).join('')}</div></li>`).join('') || '<li class="muted small">Açık aksiyon yok.</li>'}</ul></section>
        <section class="me-card"><h3>📅 Yaklaşan</h3><ul class="mlist">${upcoming.map((t) => li(t)).join('') || '<li class="muted small">Yaklaşan terminli görev yok.</li>'}</ul></section>
        <section class="me-card"><h3>📊 Bu hafta</h3>
          <div class="week">${w.days.map((d, i) => { const r = w.cap ? w.per[i] / w.cap : 0; return `<div class="wd ${d === today() ? 'today' : ''}"><div class="wbar"><i style="height:${Math.min(100, r * 100)}%" class="${r > 1 ? 'over' : ''}"></i></div><span>${new Date(d + 'T00:00').toLocaleDateString('tr-TR', { weekday: 'short' })}</span><b>${w.per[i] || 0}</b></div>`; }).join('')}</div>
          <p class="muted small">Günlük kapasite ${w.cap} saat · haftalık ${w.sum}/${w.capW} saat</p></section>
        ${myPr.length ? `<section class="me-card"><h3>📁 Lideri olduğu projeler</h3><ul class="mlist">${myPr.map((x) => `<li><div class="ml"><span class="t"><b style="color:${esc(x.color)}">${esc(x.code)}</b> ${esc(x.name)}</span><span class="muted small">${PHASES[x.phase]} · termin ${fmtD(x.due)}</span></div></li>`).join('')}</ul></section>` : ''}
      </div>
    </div>`;
  }

  // ------------------------------------------------------------ Olaylar
  function bind() {
    const q = (s) => $(s, page);
    $$('[data-tab]', page).forEach((b) => b.onclick = () => { P.tab = b.dataset.tab; page.classList.add('enter'); clearTimeout(P.enterT); P.enterT = setTimeout(() => page.classList.remove('enter'), 700); render(true); });
    $$('[data-person]', page).forEach((c) => { c.onclick = () => show('me', c.dataset.person); c.onkeydown = (e) => e.key === 'Enter' && show('me', c.dataset.person); });
    q('#meBack')?.addEventListener('click', () => show('pano'));
    q('#mtPlay')?.addEventListener('click', toggleMeeting);
    q('#mtReset')?.addEventListener('click', resetMeeting);
    q('#pgExport')?.addEventListener('click', exportAll);
    // Aksiyonlar
    q('#fPr')?.addEventListener('change', (e) => { P.fPr = e.target.value; e.target.blur(); render(true); });
    $$('[data-flt]', page).forEach((b) => b.onclick = () => { P.filter = b.dataset.flt; render(); });
    q('#newAct')?.addEventListener('click', () => { P.showNew = true; render(true); q('#naProblem')?.focus(); });
    q('#naCancel')?.addEventListener('click', () => { P.showNew = false; render(true); });
    q('#naSave')?.addEventListener('click', () => {
      const problem = q('#naProblem').value.trim(); if (!problem) { toast('⚠️ Sorunu yaz'); return; }
      guard(async () => { await api.insert('actions', { problem, countermeasure: q('#naCm').value.trim() || null, owner: q('#naOwner').value || null, due: q('#naDue').value || null, project_id: Number(q('#naPr').value) || null }); P.showNew = false; toast('🛠️ Sorun eklendi'); render(true); });
    });
    $$('tr[data-a]', page).forEach((tr) => {
      const id = Number(tr.dataset.a), a = P.actions.find((x) => x.id === id);
      $$('[data-f]', tr).forEach((el) => el.onchange = () => {
        let v = el.value.trim(); if (el.dataset.f === 'problem' && !v) { el.value = a.problem; return; }
        if (el.dataset.f === 'project_id') v = Number(v) || null; else v = v || null;
        guard(() => api.update('actions', id, { [el.dataset.f]: v }));
      });
      $$('[data-pdca]', tr).forEach((b) => b.onclick = () => { const i = Number(b.dataset.pdca); guard(() => api.update('actions', id, { pdca: a.pdca > i ? i : i + 1 })); });
      tr.querySelector('[data-adel]')?.addEventListener('click', () => confirm(`#${id} silinsin mi?`) && guard(() => api.remove('actions', id)));
    });
    // Projeler
    q('#newPr')?.addEventListener('click', () => { P.showNewPr = true; render(); });
    q('#prCancel')?.addEventListener('click', () => { P.showNewPr = false; render(); });
    const pf = q('#prForm'); if (pf) pf.onsubmit = (e) => {
      e.preventDefault();
      const colors = ['#3b6fe0', '#2ec27e', '#f6a623', '#a06cff', '#00b8d9', '#ff6b6b', '#ef6c00'];
      guard(async () => { await api.insert('projects', { code: pf.code.value.trim().toUpperCase(), name: pf.name.value.trim(), customer: pf.customer.value.trim() || null, lead: pf.lead.value || null, due: pf.due.value || null, color: colors[P.projects.length % colors.length] }); P.showNewPr = false; toast('📁 Proje oluşturuldu'); render(true); });
    };
    $$('article.prj[data-p]', page).forEach((card) => {
      const id = Number(card.dataset.p);
      $$('[data-pf]', card).forEach((el) => el.onchange = () => { const v = el.value.trim(); if (el.dataset.pf === 'name' && !v) return; guard(() => api.update('projects', id, { [el.dataset.pf]: v || null })); });
      $$('[data-phase]', card).forEach((b) => b.onclick = () => guard(() => api.update('projects', id, { phase: Number(b.dataset.phase) })));
      card.querySelector('[data-pdel]')?.addEventListener('click', () => confirm('Proje silinsin mi? Görev ve aksiyonlar silinmez, proje bağlantıları kalkar.') && guard(() => api.remove('projects', id)));
    });
    // Kapasite
    q('#wPrev')?.addEventListener('click', () => { P.weekOff--; render(); });
    q('#wNext')?.addEventListener('click', () => { P.weekOff++; render(); });
    q('#wNow')?.addEventListener('click', () => { P.weekOff = 0; render(); });
    // Kişisel panel
    $$('[data-open]', page).forEach((el) => el.onclick = () => ctx.h.openTask(Number(el.dataset.open)));
    $$('[data-tst]', page).forEach((b) => b.onclick = () => { const t = S.tasks.get(Number(b.dataset.tst)); guard(() => api.updateTask(t.id, { state: TASK_STATES[t.state].next, block_reason: null })); });
    $$('[data-blk]', page).forEach((b) => b.onclick = () => { const r = prompt('Engel nedir? (ör. Malzeme bekleniyor)'); if (r === null) return; guard(() => api.updateTask(Number(b.dataset.blk), { state: 'engel', block_reason: r.trim().slice(0, 200) || null })); });
    $$('[data-unblk]', page).forEach((b) => b.onclick = () => guard(() => api.updateTask(Number(b.dataset.unblk), { state: 'suruyor', block_reason: null })));
    $$('[data-mpdca]', page).forEach((b) => b.onclick = () => { const [id, i] = b.dataset.mpdca.split(':').map(Number), a = P.actions.find((x) => x.id === id); guard(() => api.update('actions', id, { pdca: a.pdca > i ? i : i + 1 })); });
    const qa = q('#qa'); if (qa) qa.onsubmit = (e) => {
      e.preventDefault();
      const when = qa.when.value, day = when === 'yarin' ? ymd(addDays(new Date(), 1)) : when === 'dun' ? yIso() : today();
      const task = { title: qa.title.value.trim(), kind: 'gunluk', assignee: S.me, due_date: day, priority: 2, project_id: Number(qa.project_id.value) || null, hours: qa.hours.value ? Number(qa.hours.value) : null };
      if (when === 'dun') task.state = 'bitti';
      guard(async () => { await api.addTask(task); qa.title.value = ''; qa.hours.value = ''; qa.title.focus(); });
    };
    q('#ciSave')?.addEventListener('click', () => guard(async () => { await api.upsert('checkins', { user_id: S.me, day: today(), note: q('#ciNote').value.trim() || null }, 'user_id,day'); toast('✅ Günlük giriş kaydedildi'); }));
  }

  // ------------------------------------------------------------ Toplantı sayacı (Asakai)
  function currentSpeaker() {
    const ps = people(); if (!ps.length) return null;
    const slot = P.meet.total / ps.length, idx = Math.min(ps.length - 1, Math.floor((P.meet.total - P.meet.left) / slot));
    return ps[idx];
  }
  function toggleMeeting() {
    const m = P.meet; m.running = !m.running;
    clearInterval(m.timer);
    if (m.running) {
      let last = null;
      m.timer = setInterval(() => {
        m.left = Math.max(0, m.left - 1);
        const sp = currentSpeaker();
        if (sp && sp.id !== last) { last = sp.id; office.focus(sp.id); office.say(sp.id, '🎤 Söz sende', { ms: 4000 }); }
        if (m.left === 60) toast('⏰ Toplantının bitmesine 1 dakika');
        if (!m.left) { m.running = false; clearInterval(m.timer); toast('⏰ Toplantı süresi doldu'); }
        if (P.view === 'pano' && P.tab === 'pano') { const t = $('.meet b', page); if (t) t.textContent = `${String(Math.floor(m.left / 60)).padStart(2, '0')}:${String(m.left % 60).padStart(2, '0')}`; if (sp && !$(`.pcard.speaking[data-person="${sp.id}"]`, page)) render(); }
      }, 1000);
    }
    render();
  }
  function resetMeeting() { const m = P.meet; clearInterval(m.timer); m.running = false; m.left = m.total; render(); }

  // ------------------------------------------------------------ Yedek (JSON dışa aktarma)
  async function exportAll() {
    await guard(async () => {
      const tables = ['projects', 'actions', 'checkins', 'task_templates', 'leaves', 'room_bookings'];
      const out = { exported_at: new Date().toISOString(), profiles: people().map(({ id, display_name, dept, role, capacity, desk_no }) => ({ id, display_name, dept, role, capacity, desk_no })), tasks: [...S.tasks.values()] };
      for (const t of tables) out[t] = await api.list(t);
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `ofis3d-yedek-${today()}.json` });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('⬇ Yedek indirildi');
    });
  }

  return { load, onTable, show, render, project: proj, get projects() { return P.projects; }, checkedIn, get view() { return P.view; } };
}
