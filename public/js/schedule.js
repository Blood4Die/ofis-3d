// Mesai ve mola saatleri. Tek satırlık office_schedule tablosunda tutulur; yalnız sistem yöneticisi değiştirebilir.
// Üst çubukta o anki dönem (mesai / mola / mesai dışı) ve kalan süre gösterilir; mola başlangıç ve bitişinde uyarı verilir.

export const DEFAULT_SCHEDULE = {
  days: { 1: { start: '08:00', end: '18:00' }, 2: { start: '08:00', end: '18:00' }, 3: { start: '08:00', end: '18:00' }, 4: { start: '08:00', end: '18:00' }, 5: { start: '08:00', end: '18:30' } },
  breaks: [
    { icon: '☕', name: 'Sabah molası', start: '10:00', end: '10:15' },
    { icon: '🍽️', name: 'Öğle yemeği', start: '12:00', end: '13:00' },
    { icon: '☕', name: 'İkindi molası', start: '15:30', end: '15:45' },
  ],
  notify: true,
};
const DAY_NAMES = { 1: 'Pazartesi', 2: 'Salı', 3: 'Çarşamba', 4: 'Perşembe', 5: 'Cuma', 6: 'Cumartesi', 0: 'Pazar' };
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const ICONS = ['☕', '🍽️', '⏸️', '🚬', '🧘'];
const min = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return h * 60 + (m || 0); };
const valid = (t) => /^\d{2}:\d{2}$/.test(t || '');
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} sa${m % 60 ? ' ' + (m % 60) + ' dk' : ''}` : `${m} dk`);

// Verilen anda hangi dönemdeyiz?
export function periodAt(sch, now = new Date()) {
  const day = sch.days?.[now.getDay()], t = now.getHours() * 60 + now.getMinutes();
  if (!day) return { key: 'off-day', kind: 'off', icon: '🌙', label: 'Mesai dışı', sub: DAY_NAMES[now.getDay()] };
  const s = min(day.start), e = min(day.end);
  if (t < s) return { key: 'before', kind: 'off', icon: '🌙', label: 'Mesai dışı', sub: `başlangıç ${day.start}`, left: s - t };
  if (t >= e) return { key: 'after', kind: 'off', icon: '🏁', label: 'Mesai bitti', sub: `${day.start}–${day.end}` };
  const brs = (sch.breaks || []).filter((b) => valid(b.start) && valid(b.end)).sort((a, b) => min(a.start) - min(b.start));
  const cur = brs.find((b) => t >= min(b.start) && t < min(b.end));
  if (cur) return { key: 'br:' + cur.start, kind: 'break', icon: cur.icon || '☕', label: cur.name || 'Mola', sub: `bitiş ${cur.end}`, left: min(cur.end) - t, br: cur };
  const next = brs.find((b) => min(b.start) > t && min(b.start) < e);
  return { key: 'work', kind: 'work', icon: '🟢', label: 'Mesai', sub: next ? `${next.icon || '☕'} ${next.start}` : `bitiş ${day.end}`, left: next ? min(next.start) - t : e - t, next, end: day.end };
}

export function initSchedule({ api, h }) {
  const { $, $$, esc, toast } = h;
  let sch = DEFAULT_SCHEDULE, last = null, draft = null;

  async function load() {
    try { const rows = await api.list('office_schedule', {}); if (rows?.[0]?.data) sch = rows[0].data; } catch (e) { console.warn(e); }
    tick(true);
  }
  function onTable(t, c) { if (t === 'office_schedule' && c.row?.data) { sch = c.row.data; tick(true); } }

  function tick(silent = false) {
    const el = $('#schedChip'); if (!el) return;
    const p = periodAt(sch);
    const today = sch.days?.[new Date().getDay()];
    el.className = 'sched-chip ' + p.kind;
    el.innerHTML = `<span>${p.icon}</span><b>${esc(p.label)}</b><span class="sc-sub">${esc(p.sub)}${p.left && p.left <= 60 && p.kind !== 'off' ? ` · ${dur(p.left)}` : ''}</span>`;
    el.title = today ? `Bugün ${today.start}–${today.end}\n` + (sch.breaks || []).map((b) => `${b.icon || '☕'} ${b.name}: ${b.start}–${b.end}`).join('\n') : 'Bugün mesai yok';
    if (!silent && last && last !== p.key && sch.notify !== false) announce(p);
    last = p.key;
  }
  function announce(p) {
    if (p.kind === 'break') toast(`${p.icon} ${p.label} başladı · bitiş ${p.br.end}`);
    else if (p.key === 'work' && String(last).startsWith('br:')) toast('💼 Mola bitti, iyi çalışmalar');
    else if (p.key === 'work' && last === 'before') toast('☀️ Mesai başladı, günaydın!');
    else if (p.key === 'after') toast('🏁 Mesai bitti, iyi akşamlar');
    else return;
    h.chime?.();
  }

  // ---------------- yönetici paneli bölümü
  function editorHtml() {
    const d = draft || (draft = JSON.parse(JSON.stringify(sch)));
    return `<section class="adm-sched">
      <h4>⏰ Mesai ve molalar</h4>
      <div class="sch-grid">
        <div class="sch-days">${DAY_ORDER.map((n) => { const v = d.days?.[n]; return `<label class="sch-day ${v ? '' : 'off'}"><input type="checkbox" data-don="${n}" ${v ? 'checked' : ''}/><span>${DAY_NAMES[n]}</span>
          <input type="time" data-ds="${n}" value="${esc(v?.start || '08:00')}" ${v ? '' : 'disabled'}/><span>–</span><input type="time" data-de="${n}" value="${esc(v?.end || '18:00')}" ${v ? '' : 'disabled'}/></label>`; }).join('')}</div>
        <div class="sch-brs">${(d.breaks || []).map((b, i) => `<div class="sch-br"><select data-bi="${i}">${ICONS.map((x) => `<option ${x === b.icon ? 'selected' : ''}>${x}</option>`).join('')}</select>
          <input data-bn="${i}" value="${esc(b.name)}" maxlength="30" placeholder="Mola adı" /><input type="time" data-bs="${i}" value="${esc(b.start)}" /><span>–</span><input type="time" data-be="${i}" value="${esc(b.end)}" /><button data-bx="${i}" title="Kaldır">✕</button></div>`).join('')}
          <button id="schAdd" class="link">+ Mola ekle</button>
          <label class="sw-tg"><input type="checkbox" id="schNotify" ${d.notify !== false ? 'checked' : ''}/> Mola başında/sonunda sesli uyarı</label></div>
      </div>
      <div class="sch-act"><button id="schSave" class="primary">Saatleri kaydet</button><button id="schReset">Vazgeç</button><span class="muted small">Değişiklik herkese anında yansır.</span></div>
    </section>`;
  }
  function bindEditor(root, rerender) {
    const d = draft;
    $$('[data-don]', root).forEach((c) => c.onchange = () => { const n = c.dataset.don; if (c.checked) d.days[n] = { start: $(`[data-ds="${n}"]`, root).value || '08:00', end: $(`[data-de="${n}"]`, root).value || '18:00' }; else delete d.days[n]; rerender(); });
    $$('[data-ds]', root).forEach((x) => x.onchange = () => { if (d.days[x.dataset.ds]) d.days[x.dataset.ds].start = x.value; });
    $$('[data-de]', root).forEach((x) => x.onchange = () => { if (d.days[x.dataset.de]) d.days[x.dataset.de].end = x.value; });
    $$('[data-bi]', root).forEach((x) => x.onchange = () => { d.breaks[+x.dataset.bi].icon = x.value; });
    $$('[data-bn]', root).forEach((x) => x.oninput = () => { d.breaks[+x.dataset.bn].name = x.value; });
    $$('[data-bs]', root).forEach((x) => x.onchange = () => { d.breaks[+x.dataset.bs].start = x.value; });
    $$('[data-be]', root).forEach((x) => x.onchange = () => { d.breaks[+x.dataset.be].end = x.value; });
    $$('[data-bx]', root).forEach((x) => x.onclick = () => { d.breaks.splice(+x.dataset.bx, 1); rerender(); });
    $('#schAdd', root).onclick = () => { d.breaks.push({ icon: '☕', name: 'Mola', start: '16:30', end: '16:45' }); rerender(); };
    $('#schNotify', root).onchange = (e) => { d.notify = e.target.checked; };
    $('#schReset', root).onclick = () => { draft = null; rerender(); };
    $('#schSave', root).onclick = async () => {
      for (const [n, v] of Object.entries(d.days)) if (!valid(v.start) || !valid(v.end) || min(v.start) >= min(v.end)) { toast(`⚠️ ${DAY_NAMES[n]}: başlangıç bitişten önce olmalı`); return; }
      for (const b of d.breaks) if (!b.name?.trim() || !valid(b.start) || !valid(b.end) || min(b.start) >= min(b.end)) { toast(`⚠️ "${b.name || 'Mola'}": adı ve saatleri kontrol et`); return; }
      d.breaks.sort((a, b) => min(a.start) - min(b.start));
      try { await api.upsert('office_schedule', { id: 1, data: d }, 'id'); sch = JSON.parse(JSON.stringify(d)); draft = null; tick(true); toast('⏰ Mesai saatleri kaydedildi'); rerender(); }
      catch (e) { toast('⚠️ ' + (e.message || e)); }
    };
  }

  return { load, onTable, tick, editorHtml, bindEditor, get data() { return sch; } };
}
