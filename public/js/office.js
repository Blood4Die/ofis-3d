// 3D ofis sahnesi. Düzen layout.js'ten okunur (çok katlı, genişletilebilir);
// bu dosya yalnız çizim, yol bulma, avatar ve animasyondan sorumludur.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/addons/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from '../vendor/addons/CSS2DRenderer.js';
import { STATUSES, MOODS, DEFAULT_AVATAR } from './config.js';
import { FLOORS, ENTRY_FLOOR } from './layout.js';

// ================================================================ YOL BULMA (kat başına ızgara A*)
const CELL = 0.25, R = 0.28;
class Grid {
  constructor(floor, obstacles) {
    this.W = floor.width; this.D = floor.depth; this.extra = floor.exit ? 16 : 0;
    this.GW = Math.round(this.W / CELL); this.GD = Math.round(this.D / CELL) + this.extra;
    this.b = new Uint8Array(this.GW * this.GD);
    const gap = floor.exit?.gap;
    for (let cz = 0; cz < this.GD; cz++) for (let cx = 0; cx < this.GW; cx++) {
      const { x, z } = this.world(cx, cz);
      let bl = z > this.D / 2 + 0.2 && !(gap && x > gap[0] + R && x < gap[1] - R);
      if (!bl) for (const [x1, z1, x2, z2] of floor.walls) {
        if (x >= Math.min(x1, x2) - 0.1 - R && x <= Math.max(x1, x2) + 0.1 + R && z >= Math.min(z1, z2) - 0.1 - R && z <= Math.max(z1, z2) + 0.1 + R) { bl = true; break; }
      }
      if (!bl) for (const [ox, oz, sx, sz] of obstacles) {
        if (Math.abs(x - ox) <= sx / 2 + R - 0.05 && Math.abs(z - oz) <= sz / 2 + R - 0.05) { bl = true; break; }
      }
      this.b[cz * this.GW + cx] = bl ? 1 : 0;
    }
  }
  cell(x, z) { return [Math.floor((x + this.W / 2) / CELL), Math.floor((z + this.D / 2) / CELL)]; }
  world(cx, cz) { return { x: cx * CELL - this.W / 2 + CELL / 2, z: cz * CELL - this.D / 2 + CELL / 2 }; }
  blocked(cx, cz) { return cx < 0 || cz < 0 || cx >= this.GW || cz >= this.GD || this.b[cz * this.GW + cx] === 1; }
  free(cx, cz) {
    if (!this.blocked(cx, cz)) return [cx, cz];
    for (let r = 1; r < 12; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++)
      if (Math.max(Math.abs(dx), Math.abs(dz)) === r && !this.blocked(cx + dx, cz + dz)) return [cx + dx, cz + dz];
    return [cx, cz];
  }
  lineFree(a, b) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1);
    for (let i = 1; i < n; i++) { const t = i / n; if (this.blocked(...this.cell(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t))) return false; }
    return true;
  }
  path(from, to) {
    const { GW, GD } = this;
    const [sx, sz] = this.free(...this.cell(from.x, from.z)), [tx, tz] = this.free(...this.cell(to.x, to.z));
    const N = GW * GD, g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N), open = [];
    const s = sz * GW + sx, t = tz * GW + tx, h = (cx, cz) => Math.hypot(cx - tx, cz - tz);
    g[s] = 0; open.push([h(sx, sz), s]);
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const cur = open.splice(bi, 1)[0][1];
      if (cur === t) break;
      if (closed[cur]) continue; closed[cur] = 1;
      const cx = cur % GW, cz = (cur / GW) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = cx + dx, nz = cz + dz;
        if (this.blocked(nx, nz) || (dx && dz && (this.blocked(cx + dx, cz) || this.blocked(cx, cz + dz)))) continue;
        const ni = nz * GW + nx, ng = g[cur] + (dx && dz ? 1.4142 : 1);
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; open.push([ng + h(nx, nz), ni]); }
      }
    }
    if (came[t] === -1 && s !== t) return [{ x: to.x, z: to.z }];
    const cells = []; for (let c = t; c !== -1; c = came[c]) cells.push(this.world(c % GW, (c / GW) | 0));
    cells.reverse();
    const pts = [{ x: from.x, z: from.z }];
    let i = 0;
    while (i < cells.length - 1) { let j = cells.length - 1; while (j > i + 1 && !this.lineFree(pts[pts.length - 1], cells[j])) j--; pts.push(cells[j]); i = j; }
    pts.push({ x: to.x, z: to.z });
    return pts.slice(1);
  }
}

// ================================================================ YARDIMCILAR
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });
function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; return m;
}
const box = (sx, sy, sz, mat, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(sx, sy, sz), mat, x, y, z);
function floorText(text, x, z, h = 0.5, color = 'rgba(55,65,85,0.5)') {
  const c = document.createElement('canvas'); let g = c.getContext('2d');
  g.font = '700 80px Inter, Segoe UI, sans-serif';
  c.width = Math.ceil(g.measureText(text).width + 40); c.height = 110; g = c.getContext('2d');
  g.font = '700 80px Inter, Segoe UI, sans-serif'; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 20, 58);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(h * c.width / c.height, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); return m;
}
const lerpAngle = (a, b, t) => { let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
const tileTex = (base, line, rep) => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 128); g.strokeStyle = line; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); t.colorSpace = THREE.SRGBColorSpace; return t;
};

// Ortak malzemeler
const MAT = {};
function mats() {
  if (MAT.ready) return MAT;
  Object.assign(MAT, {
    ready: true, wall: M('#c9cfd8'), frame: M('#4a505a'), top: M('#c9ccd1', { roughness: 0.5 }), leg: M('#1f2a2e'),
    glass: new THREE.MeshStandardMaterial({ color: '#a9cdf5', transparent: true, opacity: 0.3, roughness: 0.1 }),
    scr: M('#1c222c', { roughness: 0.3 }), scrOn: new THREE.MeshStandardMaterial({ color: '#3d7bd9', emissive: '#2a5cb3', emissiveIntensity: 0.6 }),
    chair: M('#2e3440'), chairLeg: M('#6b7380'), chairBase: M('#3b4250'), key: M('#e9ecf0'), panel: M('#9aa3ad'),
    yel: M('#d8cf1e', { roughness: 0.6 }), yelD: M('#b9ad10'), col: M('#b9bfc8'), white: M('#ffffff'), dark: M('#2b3038'),
    wood: M('#cdbfae', { roughness: 0.5 }), counterTop: M('#3c4658'), red: M('#c0392b'), sofa: M('#2f7d6d'),
    pot: M('#9a6b48'), leaf: M('#3f9d5a', { flatShading: true }), upr: M('#d6c51a'), shelf: M('#8f6b47'),
    blue: M('#2f3fbf'), blue2: M('#3949c9'), steel: M('#8d96a3'), orange: M('#e0742b'), grey: M('#c8ccd2'),
    ok: new THREE.MeshStandardMaterial({ color: '#2ec27e', emissive: '#1d8f5a', emissiveIntensity: 0.5 }),
    stair: M('#aab2bd'),
  });
  return MAT;
}
function chair(x, z, face) {
  const m = mats(), g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = face;
  g.add(box(0.48, 0.07, 0.46, m.chair, 0, 0.46, 0), box(0.46, 0.5, 0.06, m.chair, 0, 0.76, -0.24), box(0.05, 0.38, 0.05, m.chairLeg, 0, 0.24, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 5), m.chairBase, 0, 0.04, 0));
  return g;
}

// Prop çizicileri: (grup, prop, ctx) → engelleri ve spotları ctx'e ekler
const PROPS = {
  bench(G, p, ctx) {
    const m = mats(), len = p.modules * 1.6, x = p.x;
    G.add(box(1.6, 0.05, len, m.top, x, 0.74, p.z), box(0.03, 0.32, len - 0.1, m.panel, x, 0.93, p.z));
    for (let i = 0; i <= p.modules; i++) [-0.72, 0.72].forEach((dx) => G.add(box(0.05, 0.74, 0.05, m.leg, x + dx, 0.37, p.z - len / 2 + 0.1 + i * (len - 0.2) / p.modules)));
    ctx.obstacles.push([x, p.z, 1.6, len]);
    let n = p.deskStart;
    for (const side of [-1, 1]) for (let i = 0; i < p.modules; i++) {
      const z = p.z - len / 2 + 0.8 + i * 1.6, mx = x + side * 0.32;
      G.add(box(0.04, 0.34, 0.56, m.scr, mx, 1.04, z), box(0.04, 0.18, 0.04, m.leg, mx, 0.84, z), box(0.16, 0.012, 0.42, m.key, x + side * 0.55, 0.775, z));
      const sc = mesh(new THREE.PlaneGeometry(0.52, 0.3), m.scrOn, mx + side * 0.022, 1.04, z, false); sc.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; G.add(sc);
      const seat = { x: x + side * 1.2, z, face: side < 0 ? Math.PI / 2 : -Math.PI / 2, sit: true };
      G.add(chair(seat.x + side * 0.05, z, seat.face));
      const num = floorText(String(n), x + side * 0.6, z - 0.55, 0.16, 'rgba(60,70,90,0.55)'); num.position.y = 0.768; G.add(num);
      ctx.desks.push({ no: n, seat, name: p.group ? `${p.group} · ${n - p.deskStart + 1}` : `Masa ${n}` }); n++;
    }
  },
  singleDesks(G, p, ctx) {
    const m = mats();
    for (let i = 0; i < p.count; i++) {
      const x = p.x - (p.count - 1) * 0.75 + i * 1.5, z = p.z, no = p.deskStart + i;
      G.add(box(1.4, 0.05, 0.75, m.top, x, 0.74, z));
      [-0.65, 0.65].forEach((dx) => [-0.3, 0.3].forEach((dz) => G.add(box(0.05, 0.74, 0.05, m.leg, x + dx, 0.37, z + dz))));
      G.add(box(0.56, 0.34, 0.04, m.scr, x, 1.04, z - 0.15), box(0.04, 0.18, 0.04, m.leg, x, 0.84, z - 0.17), box(0.42, 0.012, 0.16, m.key, x, 0.775, z + 0.1));
      const sc = mesh(new THREE.PlaneGeometry(0.52, 0.3), m.scrOn, x, 1.04, z - 0.128, false); G.add(sc);
      const seat = { x, z: z + 0.85, face: Math.PI, sit: true };
      G.add(chair(x, seat.z + 0.05, seat.face));
      ctx.desks.push({ no, seat, name: p.group ? `${p.group} · tekli ${i + 1}` : `Masa ${no}` });
    }
    ctx.obstacles.push([p.x, p.z, p.count * 1.5, 0.75]);
  },
  execDesk(G, p, ctx) {
    const m = mats(), r = (p.face ?? 0) - Math.PI, g = new THREE.Group();
    g.position.set(p.x, 0, p.z); g.rotation.y = r;
    const wood = M('#6b4f3a', { roughness: 0.5 });
    g.add(box(1.9, 0.06, 0.9, wood, 0, 0.75, 0), box(0.06, 0.72, 0.85, wood, -0.9, 0.36, 0), box(0.06, 0.72, 0.85, wood, 0.9, 0.36, 0), box(1.8, 0.45, 0.04, wood, 0, 0.5, -0.4));
    g.add(box(0.6, 0.36, 0.04, m.scr, 0.25, 1.05, -0.25), box(0.04, 0.2, 0.04, m.leg, 0.25, 0.86, -0.27), box(0.42, 0.012, 0.16, m.key, 0.25, 0.79, 0.1));
    const sc = mesh(new THREE.PlaneGeometry(0.56, 0.32), m.scrOn, 0.25, 1.05, -0.228, false); g.add(sc);
    g.add(box(0.3, 0.04, 0.22, M('#f2f2f2'), -0.5, 0.79, 0.05));   // dosya
    const ec = chair(0, 0.95, Math.PI); ec.scale.setScalar(1.15); g.add(ec);
    for (let i = 0; i < (p.guests ?? 0); i++) g.add(chair((i - ((p.guests ?? 1) - 1) / 2) * 0.8, -1.0, 0));
    G.add(g);
    const seat = { x: p.x + 0.9 * Math.sin(r), z: p.z + 0.9 * Math.cos(r), face: p.face ?? 0, sit: true };
    ctx.desks.push({ no: p.deskNo, seat, name: p.name || `Masa ${p.deskNo}` });
    const side = Math.abs(Math.sin(r)) > 0.5;
    ctx.obstacles.push([p.x, p.z, side ? 0.9 : 1.9, side ? 1.9 : 0.9]);
  },
  lockers(G, p, ctx) {
    const m = mats(), alongZ = p.d > p.w, L = alongZ ? p.d : p.w;
    G.add(box(p.w, 1.0, p.d, m.yel, p.x, 0.5, p.z));
    for (let i = 1; i < Math.round(L / 0.8); i++) {
      const o = -L / 2 + (L / Math.round(L / 0.8)) * i;
      G.add(alongZ ? box(p.w + 0.02, 0.9, 0.02, m.yelD, p.x, 0.5, p.z + o) : box(0.02, 0.9, p.d + 0.02, m.yelD, p.x + o, 0.5, p.z));
    }
    G.add(box(alongZ ? p.w + 0.02 : L, 0.02, alongZ ? L : p.d + 0.02, m.yelD, p.x, 0.5, p.z));
    ctx.obstacles.push([p.x, p.z, p.w, p.d]);
  },
  column(G, p, ctx) { G.add(box(0.6, 2.6, 0.6, mats().col, p.x, 1.3, p.z)); ctx.obstacles.push([p.x, p.z, 0.6, 0.6]); },
  roundTable(G, p, ctx) {
    const m = mats(), r = p.r ?? 1.3, n = p.seats ?? 8;
    G.add(mesh(new THREE.CylinderGeometry(r, r, 0.06, 8), m.wood, p.x, 0.75, p.z), mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.72, 16), m.dark, p.x, 0.36, p.z));
    ctx.obstacles.push([p.x, p.z, 2 * r, 2 * r]);
    for (let k = 0; k < n; k++) {
      const a = k * 2 * Math.PI / n, s = { x: p.x + (r + 0.65) * Math.sin(a), z: p.z + (r + 0.65) * Math.cos(a), face: a + Math.PI, sit: true };
      G.add(chair(s.x, s.z, s.face)); ctx.spot(p.zone, s);
    }
  },
  longTable(G, p, ctx) {
    const m = mats(), len = p.len ?? 6;
    G.add(box(len, 0.05, 1.0, m.wood, p.x, 0.75, p.z)); [-1, 1].forEach((d) => G.add(box(0.06, 0.72, 0.8, m.leg, p.x + d * (len / 2 - 0.2), 0.36, p.z)));
    ctx.obstacles.push([p.x, p.z, len, 1.0]);
    for (let i = 0; i < Math.floor(len / 0.8); i++) for (const side of [-1, 1]) {
      const s = { x: p.x - len / 2 + 0.4 + i * 0.8, z: p.z + side * 0.85, face: side < 0 ? 0 : Math.PI, sit: true };
      G.add(chair(s.x, s.z, s.face)); ctx.spot(p.zone, s);
    }
  },
  counter(G, p, ctx) {
    const m = mats(); G.add(box(p.w, 0.95, p.d, m.white, p.x, 0.475, p.z), box(p.w + 0.04, 0.04, p.d + 0.04, m.counterTop, p.x, 0.97, p.z));
    if (p.coffee) G.add(box(0.34, 0.42, 0.34, m.red, p.x, 1.2, p.z - p.d / 2 + 0.4));
    ctx.obstacles.push([p.x, p.z, p.w, p.d]);
  },
  bistro(G, p, ctx) {
    const m = mats(), h = p.low ? 0.55 : 1.0, r = p.low ? 0.32 : 0.45;
    G.add(mesh(new THREE.CylinderGeometry(r, r, 0.04, 24), m.white, p.x, h, p.z), mesh(new THREE.CylinderGeometry(0.04, 0.12, h, 10), m.grey, p.x, h / 2, p.z));
    ctx.obstacles.push([p.x, p.z, 2 * r, 2 * r]);
  },
  sofa(G, p, ctx) { const m = mats(); G.add(box(p.w, 0.42, 0.7, m.sofa, p.x, 0.21, p.z), box(p.w, 0.5, 0.18, m.sofa, p.x, 0.6, p.z + 0.3)); ctx.obstacles.push([p.x, p.z, p.w, 0.7]); },
  plant(G, p) { const m = mats(); G.add(mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.4, 12), m.pot, p.x, 0.2, p.z), mesh(new THREE.IcosahedronGeometry(0.42, 0), m.leaf, p.x, 0.75, p.z)); },
  screen(G, p) { G.add(box(p.w, 1.2, 0.06, mats().scr, p.x, 1.25, p.z)); },
  rack(G, p, ctx) {
    const m = mats(), L = p.len ?? 3;
    [p.x - 0.7, p.x + 0.7].forEach((x) => [p.z - L / 2 + 0.05, p.z + L / 2 - 0.05].forEach((z) => G.add(box(0.1, 2.4, 0.1, m.upr, x, 1.2, z))));
    [0.35, 1.0, 1.65, 2.3].forEach((y) => G.add(box(1.5, 0.06, L, m.shelf, p.x, y, p.z)));
    ctx.obstacles.push([p.x, p.z, 1.6, L]);
  },
  workbench(G, p, ctx) {
    const m = mats(); G.add(box(p.w, 0.9, 0.9, m.blue, p.x, 0.45, p.z), box(p.w, 1.0, 0.05, m.blue2, p.x, 1.4, p.z - 0.42), box(p.w + 0.1, 0.05, 0.95, m.grey, p.x, 0.92, p.z));
    ctx.obstacles.push([p.x, p.z, p.w, 0.9]);
  },
  machine(G, p, ctx) {
    const m = mats(); G.add(box(p.w, 1.8, p.d, m.white, p.x, 0.9, p.z), box(p.w * 0.62, 0.8, 0.04, m.dark, p.x, 1.15, p.z - p.d / 2 - 0.02), box(0.4, 0.5, 0.06, m.ok, p.x + p.w * 0.4, 1.3, p.z - p.d / 2 - 0.02));
    ctx.obstacles.push([p.x, p.z, p.w, p.d]);
  },
  press(G, p, ctx) { const m = mats(); G.add(box(1.3, 2.0, 1.3, m.steel, p.x, 1.0, p.z), box(1.4, 0.3, 1.4, m.orange, p.x, 2.1, p.z)); ctx.obstacles.push([p.x, p.z, 1.3, 1.3]); },
  stairsProp(G, p, ctx) {
    const m = mats(), g = new THREE.Group(), n = 10, w = p.w ?? 1.2, L = p.len ?? 3.2;
    for (let i = 0; i < n; i++) g.add(box(w, 0.12, L / n, m.stair, 0, 0.12 + i * 0.28, -L / 2 + (i + 0.5) * L / n));
    g.position.set(p.x, 0, p.z); g.rotation.y = p.rot ?? 0; G.add(g);
    ctx.obstacles.push([p.x, p.z, Math.abs(Math.sin(p.rot ?? 0)) > 0.5 ? L : w, Math.abs(Math.sin(p.rot ?? 0)) > 0.5 ? w : L]);
  },
};

// Duygu durumuna göre yüz dokusu
function drawFace(mood) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.lineCap = 'round'; g.strokeStyle = g.fillStyle = '#2a2a33'; g.lineWidth = 6;
  const eyes = (fn) => { fn(42); fn(86); };
  const dot = (x, y = 54, r = 7) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const arc = (x, y, r, a0, a1) => { g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); };
  const line = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  const blush = () => { g.fillStyle = 'rgba(255,120,120,0.45)'; [26, 102].forEach((x) => { g.beginPath(); g.ellipse(x, 74, 11, 7, 0, 0, Math.PI * 2); g.fill(); }); g.fillStyle = '#2a2a33'; };
  switch (mood) {
    case 'mutlu': eyes((x) => arc(x, 58, 9, Math.PI * 1.1, Math.PI * 1.9)); blush(); g.beginPath(); g.arc(64, 78, 20, 0.1 * Math.PI, 0.9 * Math.PI); g.closePath(); g.fill(); break;
    case 'motive': eyes((x) => dot(x)); line(32, 38, 52, 42); line(96, 38, 76, 42); g.beginPath(); g.moveTo(44, 80); g.lineTo(84, 80); g.arc(64, 80, 20, 0, Math.PI); g.fill(); break;
    case 'iyi': eyes((x) => dot(x)); arc(64, 72, 18, 0.2 * Math.PI, 0.8 * Math.PI); break;
    case 'yorgun': eyes((x) => line(x - 9, 58, x + 9, 58)); eyes((x) => arc(x, 52, 9, 0.15 * Math.PI, 0.85 * Math.PI)); g.beginPath(); g.ellipse(64, 88, 7, 5, 0, 0, Math.PI * 2); g.stroke(); break;
    case 'stresli': eyes((x) => dot(x, 56, 6)); line(32, 44, 50, 38); line(96, 44, 78, 38);
      g.beginPath(); for (let i = 0; i <= 4; i++) g.lineTo(46 + i * 9, 86 + (i % 2 ? -5 : 5)); g.stroke();
      g.fillStyle = '#7cc4ff'; g.beginPath(); g.ellipse(104, 34, 6, 9, 0, 0, Math.PI * 2); g.fill(); break;
    default: eyes((x) => dot(x)); line(50, 82, 78, 82);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const faceCache = {};
const faceTex = (mood) => (faceCache[mood] ??= drawFace(mood));
// ================================================================ AVATAR (sahneden bağımsız)
function makeAvatar(p) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: p.color || '#4f8cff', roughness: 0.65, transparent: true });
  const skinMat = new THREE.MeshStandardMaterial({ color: '#eabf98', roughness: 0.7, transparent: true });
  const pants = new THREE.MeshStandardMaterial({ color: '#2f3a52', roughness: 0.85, transparent: true });
  const shoe = new THREE.MeshStandardMaterial({ color: '#1d2026', roughness: 0.6, transparent: true });
  const torso = mesh(new THREE.CapsuleGeometry(0.22, 0.38, 6, 14), shirt, 0, 0.98, 0);
  const legs = [-0.1, 0.1].map((x) => { const lg = new THREE.Group(); lg.position.set(x, 0.66, 0); lg.add(mesh(new THREE.CapsuleGeometry(0.075, 0.4, 4, 8), pants, 0, -0.28, 0)); lg.add(mesh(new THREE.BoxGeometry(0.12, 0.07, 0.2), shoe, 0, -0.6, 0.04)); g.add(lg); return lg; });
  const arms = [-0.28, 0.28].map((x) => { const ar = new THREE.Group(); ar.position.set(x, 1.2, 0); ar.add(mesh(new THREE.CapsuleGeometry(0.06, 0.34, 4, 8), shirt, 0, -0.2, 0)); ar.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), skinMat, 0, -0.43, 0)); g.add(ar); return ar; });
  const headGroup = new THREE.Group(); headGroup.position.y = 1.52;
  headGroup.add(mesh(new THREE.SphereGeometry(0.2, 20, 16), skinMat));
  const faceMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), faceMat); face.position.set(0, -0.01, 0.196); headGroup.add(face);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.46, 32), new THREE.MeshBasicMaterial({ color: '#2ec27e', transparent: true, opacity: 0.9, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.9, 8), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.95; hit.userData.id = p.id;
  g.add(torso, headGroup, ring, hit);
  return { group: g, torso, legs, arms, headGroup, look: new THREE.Group(), faceMat, skinMat, shirt, ring, hit, mats: [],
    path: [], target: null, sit: 0, sitGoal: 0, faceDir: 0, walkT: 0, opacity: 1, opacityGoal: 1, visible: true, place: null, lookKey: '', seed: Math.random() * 10 };
}

function buildLook(a, av, mood) {
  a.headGroup.remove(a.look); a.look = new THREE.Group();
  a.skinMat.color.set(av.skin || DEFAULT_AVATAR.skin);
  const hm = new THREE.MeshStandardMaterial({ color: av.hairColor || DEFAULT_AVATAR.hairColor, roughness: 0.9, transparent: true });
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = mesh(geo, mat, x, y, z); a.look.add(m); return m; };
  const cap = () => { const m = add(new THREE.SphereGeometry(0.212, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hm, 0, 0.01, -0.02); m.rotation.x = -0.32; };
  switch (av.hair) {
    case 'uzun': cap(); add(new THREE.BoxGeometry(0.38, 0.4, 0.12), hm, 0, -0.12, -0.14); break;
    case 'topuz': cap(); add(new THREE.SphereGeometry(0.1, 12, 10), hm, 0, 0.17, -0.14); break;
    case 'kivircik':
      for (let i = 0; i < 11; i++) { const ang = (i / 11) * Math.PI * 2; add(new THREE.IcosahedronGeometry(0.085, 0), hm, Math.cos(ang) * 0.15, 0.1 + (i % 2) * 0.04, Math.sin(ang) * 0.15 - 0.04); }
      add(new THREE.IcosahedronGeometry(0.13, 0), hm, 0, 0.16, -0.02); break;
    case 'kel': break;
    default: cap();
  }
  const dark = new THREE.MeshStandardMaterial({ color: '#22252b', roughness: 0.4, transparent: true });
  switch (av.extra) {
    case 'gozluk':
      [-0.068, 0.068].forEach((x) => add(new THREE.TorusGeometry(0.046, 0.01, 6, 16), dark, x, 0.0, 0.19));
      add(new THREE.BoxGeometry(0.04, 0.012, 0.012), dark, 0, 0.0, 0.195); break;
    case 'kulaklik': {
      add(new THREE.TorusGeometry(0.218, 0.02, 6, 20, Math.PI), dark);
      [-0.215, 0.215].forEach((x) => { const cup = add(new THREE.CylinderGeometry(0.066, 0.066, 0.05, 14), M('#e05a5a', { transparent: true }), x, -0.01, 0); cup.rotation.z = Math.PI / 2; }); break; }
    case 'sapka': {
      const cm = M('#2f3fbf', { transparent: true });
      add(new THREE.SphereGeometry(0.215, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), cm, 0, 0.02, 0);
      add(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 16, 1, false, -Math.PI / 2, Math.PI), cm, 0, 0.03, 0.16); break; }
    case 'baret': {
      const hh = M('#f3c613', { roughness: 0.4, transparent: true });
      add(new THREE.SphereGeometry(0.228, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hh, 0, 0.03, 0);
      add(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 20), hh, 0, 0.035, 0); break; }
  }
  a.headGroup.add(a.look);
  a.faceMat.map = faceTex(mood); a.faceMat.needsUpdate = true;
  a.mats = []; a.group.traverse((o) => { if (o.isMesh && o !== a.ring && o !== a.hit && o.material.transparent && o.material !== a.faceMat) a.mats.push(o.material); });
}

// ================================================================ SAHNE
export class Office {
  constructor(container, { onAvatarClick, onFloorsChanged } = {}) {
    this.container = container; this.onAvatarClick = onAvatarClick;
    this.avatars = new Map(); this.taken = new Map(); // zoneKind -> Map(spotIndex -> personId)
    this.effects = []; this.timer = new THREE.Timer(); this.elapsed = 0;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);
    const l = this.labels = new CSS2DRenderer(); l.domElement.className = 'label-layer'; container.appendChild(l.domElement);

    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color('#eef1f5'); s.fog = new THREE.Fog('#eef1f5', 50, 90);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    const c = this.controls = new OrbitControls(this.camera, l.domElement);
    c.enableDamping = true; c.dampingFactor = 0.08; c.maxPolarAngle = 1.25; c.minDistance = 5; c.maxDistance = 60; c.screenSpacePanning = false;
    // Dokunmatik: tek parmak kaydır, iki parmak yakınlaştır/döndür
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    c.zoomToCursor = true;
    c.addEventListener('change', () => this._clampTarget());
    s.add(new THREE.HemisphereLight('#ffffff', '#c3ccd8', 1.7));
    const sun = new THREE.DirectionalLight('#ffffff', 2.0);
    sun.position.set(-12, 26, 14); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 16, bottom: -16, near: 1, far: 80 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02; s.add(sun);
    s.add(mesh(new THREE.PlaneGeometry(90, 70), M('#dde3ea'), 0, -0.01, 0, false)).children;
    s.children[s.children.length - 1].rotation.x = -Math.PI / 2;

    // Katları kur
    this.floors = new Map(); this.desks = new Map(); this.zones = new Map(); // kind -> [{floor, spot}]
    for (const f of FLOORS) this.buildFloor(f);
    this.active = ENTRY_FLOOR;
    this.setFloor(ENTRY_FLOOR);
    this.onFloorsChanged = onFloorsChanged;

    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    l.domElement.addEventListener('dblclick', () => this.fitView());
    l.domElement.addEventListener('pointerdown', (e) => { this._down = [e.clientX, e.clientY]; });
    l.domElement.addEventListener('pointerup', (e) => { if (this._down && Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) < 5) this._pick(e); });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    r.setAnimationLoop(() => this.tick());
  }

  get floorList() { return FLOORS.map((f) => ({ id: f.id, name: f.name })); }
  deskName(no) { return this.desks.get(no)?.name ?? (no ? `Masa ${no}` : '—'); }
  get deskNumbers() { return [...this.desks.keys()].sort((a, b) => a - b); }

  buildFloor(f) {
    const m = mats(), G = new THREE.Group(); G.name = f.id; this.scene.add(G);
    const ctx = { obstacles: [], desks: [], spot: (kind, s) => this._addSpot(kind, f.id, s) };
    const plane = (x1, z1, x2, z2, mat, y = 0) => { const p = mesh(new THREE.PlaneGeometry(x2 - x1, z2 - z1), mat, (x1 + x2) / 2, y, (z1 + z2) / 2, false); p.rotation.x = -Math.PI / 2; G.add(p); };
    (f.areas || []).forEach((a, i) => plane(a.x1, a.z1, a.x2, a.z2, a.tile ? M('#ffffff', { map: tileTex(a.color, a.tile, a.rep || [4, 4]) }) : M(a.color), i * 0.002));
    (f.lanes || []).forEach((a) => { plane(a.x1 - 0.06, a.z1 - 0.06, a.x2 + 0.06, a.z2 + 0.06, M('#e1c21b'), 0.012); plane(a.x1, a.z1, a.x2, a.z2, m.blue, 0.014); });
    for (const [x1, z1, x2, z2, kind] of f.walls || []) {
      const len = Math.hypot(x2 - x1, z2 - z1), gl = kind === 'g';
      const w = box(len + (gl ? 0.05 : 0.2), gl ? 1.7 : 1.1, gl ? 0.06 : 0.2, gl ? m.glass : m.wall, (x1 + x2) / 2, gl ? 0.85 : 0.55, (z1 + z2) / 2);
      w.rotation.y = -Math.atan2(z2 - z1, x2 - x1); if (gl) w.castShadow = false; G.add(w);
      if (gl) { const tp = box(len + 0.05, 0.05, 0.08, m.frame, w.position.x, 1.72, w.position.z); tp.rotation.y = w.rotation.y; G.add(tp); }
    }
    (f.windows || []).forEach(([a, b, z]) => { const w = box(b - a, 0.5, 0.06, m.glass, (a + b) / 2, 1.35, z); w.castShadow = false; G.add(w); });
    (f.doors || []).forEach(({ x, z }) => {
      [-0.82, 0.82].forEach((dx) => G.add(box(0.1, 2.2, 0.24, m.frame, x + dx, 1.1, z)));
      G.add(box(1.74, 0.1, 0.24, m.frame, x, 2.2, z));
      const leaf = box(0.04, 2.0, 0.8, m.glass, x - 0.8, 1.0, z + 0.45); leaf.castShadow = false; G.add(leaf);
    });
    if (f.sign) G.add(box(2.2, 0.7, 0.08, M('#c0391f'), f.sign.x, 1.55, f.sign.z), box(0.6, 0.5, 0.09, M('#d7c51c'), f.sign.x - 0.8, 1.55, f.sign.z + 0.03));
    for (const p of f.props || []) {
      const fn = PROPS[p.type];
      if (fn) fn(G, p, ctx); else console.warn('Bilinmeyen prop tipi:', p.type);
    }
    for (const z of f.zones || []) (z.spots || []).forEach((s) => this._addSpot(z.kind, f.id, s));
    (f.labels || []).forEach((t) => G.add(floorText(t.text, t.x, t.z, t.h)));
    ctx.desks.forEach((d) => this.desks.set(d.no, { floor: f.id, seat: d.seat, name: d.name }));
    this.floors.set(f.id, { def: f, group: G, grid: new Grid(f, ctx.obstacles), stairs: f.stairs, exit: f.exit });
  }

  _addSpot(kind, floor, s) {
    if (!kind) return;
    if (!this.zones.has(kind)) this.zones.set(kind, []);
    this.zones.get(kind).push({ floor, spot: s });
  }

  setFloor(id) {
    if (!this.floors.has(id)) return;
    this.active = id;
    this.floors.forEach((f, k) => { f.group.visible = k === id; });
    if (this.roomSign) this.roomSign.visible = this.roomSign.userData.floor === id;
    this.avatars.forEach((a) => this._attach(a));
    this.onFloorsChanged?.();
  }
  floorCounts() {
    const c = {}; this.avatars.forEach((a) => { if (a.visible) c[a.floor] = (c[a.floor] || 0) + 1; }); return c;
  }
  _attach(a) {
    const fl = this.floors.get(a.floor); if (!fl) return;
    if (a.group.parent !== fl.group) fl.group.add(a.group);
    a.onFloor = a.floor === this.active;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h); this.labels.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix();
    const portrait = h > w * 1.05;
    if (!this._fitted || portrait !== this._portrait) { this.fitView(); this._fitted = true; this._portrait = portrait; }
  }
  // Tüm katı ekrana sığdırır. Dikey ekranda (telefon) kat 90° çevrilerek gösterilir.
  fitView() {
    const f = this.floors.get(this.active).def;
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const portrait = h > w * 1.05, desktop = window.innerWidth > 900;
    const sidePx = desktop ? 700 : 0;
    const avail = Math.max(w - sidePx, w * 0.45);
    const fw = portrait ? f.depth : f.width, fd = portrait ? f.width : f.depth;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), tanH = tanV * (w / h);
    const margin = desktop ? 3 : 1;
    const dist = Math.min(Math.max((fw / 2 + margin) * w / (avail * tanH), (fd / 2 + margin + (desktop ? 0 : 2)) / tanV, 12) * (desktop ? 1 : 1.2), 70);
    this.controls.target.set(portrait ? -2.2 : 0, 0, portrait ? 0 : 1.2);
    const dir = portrait ? new THREE.Vector3(0.38, 0.92, 0.03) : new THREE.Vector3(-0.05, 0.82, 0.57);
    this.camera.position.copy(this.controls.target).addScaledVector(dir.normalize(), dist);
    this.controls.update();
  }

  // Kaydırırken katın dışına taşmayı engelle
  _clampTarget() {
    const f = this.floors.get(this.active)?.def; if (!f) return;
    const t = this.controls.target, cx = THREE.MathUtils.clamp(t.x, -f.width / 2, f.width / 2), cz = THREE.MathUtils.clamp(t.z, -f.depth / 2, f.depth / 2);
    if (cx !== t.x || cz !== t.z) { const dx = cx - t.x, dz = cz - t.z; t.x = cx; t.z = cz; this.camera.position.x += dx; this.camera.position.z += dz; }
  }

  // Kişinin durumuna göre hedef (kat + nokta)
  _spotFor(id, p) {
    const st = STATUSES[p.status] ?? STATUSES.musait;
    this.taken.forEach((map, kind) => { if (kind !== st.place) map.forEach((v, k) => v === id && map.delete(k)); });
    const desk = this.desks.get(p.desk_no);
    const entry = this.floors.get(ENTRY_FLOOR);
    const deskSpot = desk ? { ...desk.seat, floor: desk.floor } : { x: 0, z: 1.5, face: Math.PI, sit: false, floor: ENTRY_FLOOR };
    if (st.place === 'outside') return { ...entry.exit, face: 0, floor: ENTRY_FLOOR, place: 'outside', hide: true };
    if (st.place === 'away') return { ...deskSpot, place: 'away', hide: true, instant: true };
    const list = this.zones.get(st.place);
    if (!list?.length) return { ...deskSpot, place: 'desk' };
    if (!this.taken.has(st.place)) this.taken.set(st.place, new Map());
    const map = this.taken.get(st.place);
    let i = [...map].find(([, v]) => v === id)?.[0];
    if (i === undefined) { i = list.findIndex((_, k) => !map.has(k)); if (i === -1) i = Math.floor(Math.random() * list.length); else map.set(i, id); }
    return { ...list[i].spot, floor: list[i].floor, place: st.place, idx: i };
  }

  upsertPerson(p, { animate = true, online = true, openTasks = 0, isMe = false } = {}) {
    let a = this.avatars.get(p.id);
    const fresh = !a;
    if (!a) {
      a = makeAvatar(p); this.avatars.set(p.id, a);
      const el = a.el = document.createElement('div'); el.className = 'avatar-label';
      el.innerHTML = '<span class="al-mood"></span><span class="al-name"></span><span class="al-icon"></span><span class="al-flag"></span><span class="al-badge" hidden></span>';
      a.label = new CSS2DObject(el); a.label.position.set(0, 2.05, 0); a.label.center.set(0.5, 1); a.group.add(a.label);
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onAvatarClick?.(p.id); });
    }
    a.profile = p;
    const av = { ...DEFAULT_AVATAR, ...(p.avatar || {}) }, mood = p.mood || 'normal', key = JSON.stringify(av) + mood;
    if (key !== a.lookKey) { buildLook(a, av, mood); a.lookKey = key; }
    a.shirt.color.set(p.color || '#4f8cff'); a.mood = mood;
    const st = STATUSES[p.status] ?? STATUSES.musait;
    a.ring.material.color.set(st.color);
    a.el.querySelector('.al-mood').textContent = MOODS[mood]?.icon ?? '';
    a.el.querySelector('.al-icon').textContent = st.icon;
    a.el.querySelector('.al-name').textContent = p.display_name + (p.status_note ? ' · ' + p.status_note : '');
    a.el.classList.toggle('me', isMe);
    this.setOnline(p.id, online); this.setTaskCount(p.id, openTasks);

    const spot = this._spotFor(p.id, p), prevPlace = a.place;
    a.place = spot.place;
    a.label.position.y = 2.05 + (spot.idx !== undefined ? (spot.idx % 2) * 0.3 : 0);
    if (fresh || !animate || spot.instant) {
      a.floor = spot.floor; this._attach(a);
      a.group.position.set(spot.x, 0, spot.z);
      a.visible = !spot.hide; a.opacity = a.opacityGoal = spot.hide ? 0 : (online ? 1 : 0.35);
      a.group.rotation.y = a.faceDir = spot.face; a.sit = a.sitGoal = spot.sit ? 1 : 0; a.path = []; a.target = spot; a.after = null;
      this.onFloorsChanged?.();
      return;
    }
    if (prevPlace === spot.place && a.target && a.target.floor === spot.floor && Math.hypot(a.target.x - spot.x, a.target.z - spot.z) < 0.01) return;
    if (!a.visible) {
      if (prevPlace === 'outside') { a.floor = ENTRY_FLOOR; const e = this.floors.get(ENTRY_FLOOR).exit; a.group.position.set(e.x, 0, e.z); }
      this._attach(a); a.visible = true; a.opacity = 0;
    }
    a.opacityGoal = spot.hide ? 1 : (online ? 1 : 0.35);
    a.sitGoal = 0; a.target = spot; a.after = null;
    const here = this.floors.get(a.floor);
    if (spot.floor !== a.floor && here?.stairs && this.floors.get(spot.floor)?.stairs) {
      a.path = here.grid.path(a.group.position, here.stairs);       // önce merdivene
      a.after = spot;                                                // varınca kat değiştir
    } else {
      if (spot.floor !== a.floor) { a.floor = spot.floor; this._attach(a); a.group.position.set(spot.x, 0, spot.z); a.path = []; }
      else a.path = here.grid.path(a.group.position, spot);
    }
    if (!a.path.length) this._arrive(a);
    this.onFloorsChanged?.();
  }

  // Yol bitti: kat değişimi gerekiyorsa uygula, yoksa hedefe yerleş
  _arrive(a) {
    if (a.after) {
      const spot = a.after; a.after = null;
      const dest = this.floors.get(spot.floor);
      a.floor = spot.floor; this._attach(a);
      a.group.position.set(dest.stairs.x, 0, dest.stairs.z);
      a.path = dest.grid.path(dest.stairs, spot);
      this.onFloorsChanged?.();
      return;
    }
    if (a.target) { a.faceDir = a.target.face; a.sitGoal = a.target.sit ? 1 : 0; if (a.target.hide) a.opacityGoal = 0; }
  }

  removePerson(id) {
    const a = this.avatars.get(id); if (!a) return;
    a.label.element.remove(); a.group.parent?.remove(a.group); this.avatars.delete(id);
    this.taken.forEach((m) => m.forEach((v, k) => v === id && m.delete(k)));
    this.onFloorsChanged?.();
  }
  setOnline(id, online) {
    const a = this.avatars.get(id); if (!a) return;
    a.online = online; a.el.classList.toggle('offline', !online);
    if (a.visible && !a.target?.hide) a.opacityGoal = online ? 1 : 0.35;
  }
  setFlag(id, txt) { const a = this.avatars.get(id); if (!a) return; const f = a.el.querySelector('.al-flag'); if (f && f.textContent !== txt) f.textContent = txt || ''; }
  setTaskCount(id, n) { const a = this.avatars.get(id); if (!a) return; const b = a.el.querySelector('.al-badge'); b.hidden = !n; b.textContent = n; }
  // Toplantı odası tabelası (rezervasyon durumu)
  setRoomSign(html, busy) {
    const list = this.zones.get('meeting'); if (!list?.length) return;
    if (!this.roomSign) {
      const fl = list[0].floor, xs = list.map((s) => s.spot.x), zs = list.map((s) => s.spot.z);
      const el = document.createElement('div'); el.className = 'room-sign';
      // OrbitControls etiket katmanında pointer'ı yakaladığı için tıklama buraya ulaşmıyordu: pointerdown'u burada durdur
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onRoomClick?.(); });
      this.roomSign = new CSS2DObject(el); this.roomSign.center.set(0.5, 1);
      this.roomSign.position.set((Math.min(...xs) + Math.max(...xs)) / 2, 2.6, Math.min(...zs) - 0.6);
      this.floors.get(fl).group.add(this.roomSign); this.roomSign.userData.floor = fl;
    }
    this.roomSign.element.innerHTML = html;
    this.roomSign.element.classList.toggle('busy', busy === 'busy' || busy === true);
    this.roomSign.element.classList.toggle('used', busy === 'used');
    this.roomSign.visible = this.roomSign.userData.floor === this.active;
  }

  // Avatarın üstünde konuşma balonu (genel mesaj) ya da 💬 işareti (özel mesaj)
  say(id, text, { private: priv = false, ms = 6500 } = {}) {
    const a = this.avatars.get(id); if (!a || !a.visible) return;
    if (!a.bubble) {
      const el = document.createElement('div'); el.className = 'speech';
      a.bubble = new CSS2DObject(el); a.bubble.center.set(0.5, 1); a.group.add(a.bubble);
    }
    const el = a.bubble.element;
    el.textContent = priv ? '💬' : (text.length > 90 ? text.slice(0, 88) + '…' : text);
    el.classList.toggle('priv', priv);
    a.bubble.position.set(0, a.label.position.y + 0.55, 0);
    a.bubble.visible = a.onFloor !== false;
    el.classList.remove('out'); void el.offsetWidth; el.classList.add('in');
    clearTimeout(a.bubbleT);
    a.bubbleT = setTimeout(() => { el.classList.add('out'); setTimeout(() => { if (a.bubble) a.bubble.visible = false; }, 400); }, ms);
  }
  setHighlight(id) { this.avatars.forEach((a, k) => a.el.classList.toggle('selected', k === id)); }
  focus(id) {
    const a = this.avatars.get(id); if (!a) return;
    if (a.floor !== this.active) this.setFloor(a.floor);
    const p = a.visible ? a.group.position : (this.floors.get(ENTRY_FLOOR).exit ?? { x: 0, z: 0 });
    this._focus = { from: this.controls.target.clone(), to: new THREE.Vector3(p.x, 0, p.z), t: 0 };
  }
  celebrate(id) {
    const a = this.avatars.get(id); if (!a || !a.visible || a.floor !== this.active) return;
    const colors = ['#ff6b6b', '#f6a623', '#2ec27e', '#4f8cff', '#a06cff', '#ffcc00'], geo = new THREE.BoxGeometry(0.08, 0.08, 0.02);
    for (let i = 0; i < 46; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[i % 6], transparent: true }));
      m.position.set(a.group.position.x, 2.0, a.group.position.z);
      const ang = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.2;
      m.userData = { v: new THREE.Vector3(Math.cos(ang) * sp, 3 + Math.random() * 2.5, Math.sin(ang) * sp), life: 1.6, spin: Math.random() * 10 };
      this.scene.add(m); this.effects.push(m);
    }
    a.jump = 0.6;
  }
  _pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObjects([...this.avatars.values()].filter((a) => a.visible && a.onFloor).map((a) => a.hit), false);
    this.onAvatarClick?.(hits.length ? hits[0].object.userData.id : null);
  }

  tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05); this.elapsed += dt; const t = this.elapsed;
    if (this._focus) {
      const f = this._focus; f.t = Math.min(1, f.t + dt * 2);
      const delta = f.from.clone().lerp(f.to, 1 - Math.pow(1 - f.t, 3)).sub(this.controls.target);
      this.controls.target.add(delta); this.camera.position.add(delta); if (f.t >= 1) this._focus = null;
    }
    this.controls.update();
    for (const a of this.avatars.values()) { if (animateAvatar(a, dt, t)) this._arrive(a); }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const m = this.effects[i], u = m.userData;
      u.life -= dt; u.v.y -= 9 * dt; m.position.addScaledVector(u.v, dt); m.rotation.x += u.spin * dt; m.rotation.z += u.spin * dt;
      if (m.position.y < 0.02) { m.position.y = 0.02; u.v.set(0, 0, 0); }
      m.material.opacity = Math.min(1, u.life);
      if (u.life <= 0) { this.scene.remove(m); m.material.dispose(); this.effects.splice(i, 1); }
    }
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}

function animateAvatar(a, dt, t) {
  const g = a.group; let walking = false, arrived = false;
  const speed = a.mood === 'yorgun' ? 1.7 : a.mood === 'motive' ? 3.0 : 2.4;
  if (a.path.length) {
    const wp = a.path[0], dx = wp.x - g.position.x, dz = wp.z - g.position.z, d = Math.hypot(dx, dz), step = speed * dt;
    if (d <= step) { g.position.x = wp.x; g.position.z = wp.z; a.path.shift(); }
    else { g.position.x += (dx / d) * step; g.position.z += (dz / d) * step; a.faceDir = Math.atan2(dx, dz); walking = true; }
    if (!a.path.length) arrived = true;
  }
  g.rotation.y = lerpAngle(g.rotation.y, a.faceDir, Math.min(1, dt * 10));
  a.sit += (a.sitGoal - a.sit) * Math.min(1, dt * 6);
  a.walkT += walking ? dt * speed * 3.8 : 0;
  const sw = walking ? Math.sin(a.walkT) * 0.6 : 0, typing = a.sit > 0.5 && a.place === 'desk', idle = !walking;
  a.legs[0].rotation.x = sw - a.sit * 1.45; a.legs[1].rotation.x = -sw - a.sit * 1.45;
  a.arms[0].rotation.x = -sw * 0.8 - (typing ? 0.9 + Math.sin(t * 14 + a.seed) * 0.08 : a.sit * 0.3);
  a.arms[1].rotation.x = sw * 0.8 - (typing ? 0.9 + Math.cos(t * 13 + a.seed) * 0.08 : a.sit * 0.3);
  let y = -a.sit * 0.2 + (walking ? Math.abs(Math.sin(a.walkT)) * 0.05 : 0);
  a.headGroup.rotation.x = a.mood === 'yorgun' ? 0.22 + Math.sin(t * 0.8 + a.seed) * 0.05 : 0;
  a.headGroup.rotation.z = a.mood === 'stresli' && idle ? Math.sin(t * 22 + a.seed) * 0.03 : a.mood === 'iyi' && idle ? Math.sin(t * 1.5 + a.seed) * 0.06 : 0;
  if (a.mood === 'mutlu' && idle && a.sit < 0.5) y += Math.max(0, Math.sin(t * 3 + a.seed)) * 0.06;
  a.torso.scale.setScalar(a.mood === 'motive' && idle ? 1 + Math.sin(t * 4 + a.seed) * 0.015 : 1);
  if (a.jump > 0) { a.jump -= dt; y += Math.sin((0.6 - a.jump) / 0.6 * Math.PI) * 0.45; }
  g.position.y = y;
  if (a.ring.visible) { a.ring.material.opacity = (a.online !== false ? 0.75 + Math.sin(t * 3 + a.seed) * 0.2 : 0.35) * a.opacity; a.ring.position.y = 0.03 - y; }
  a.opacity += (a.opacityGoal - a.opacity) * Math.min(1, dt * 4);
  a.mats.forEach((m) => { m.opacity = a.opacity; m.depthWrite = a.opacity > 0.95; });
  a.faceMat.opacity = a.opacity;
  const vis = a.opacity > 0.02; g.visible = vis;
  if (a.label) { a.label.visible = vis && a.onFloor !== false; a.el.style.opacity = a.opacity; }
  if (!vis && a.opacityGoal === 0) a.visible = false;
  return arrived;
}

// Avatar düzenleyici için küçük önizleme sahnesi
export class AvatarPreview {
  constructor(canvas) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.r.setPixelRatio(Math.min(window.devicePixelRatio, 2)); this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.s = new THREE.Scene(); this.s.add(new THREE.HemisphereLight('#ffffff', '#c8d0da', 2.2));
    const d = new THREE.DirectionalLight('#ffffff', 1.4); d.position.set(2, 3, 4); this.s.add(d);
    this.cam = new THREE.PerspectiveCamera(28, canvas.width / canvas.height, 0.1, 20); this.cam.position.set(0, 1.3, 3.6); this.cam.lookAt(0, 1.0, 0);
    this.t = 0; this.alive = true;
    const loop = () => {
      if (!this.alive) return; this.t += 0.016;
      if (this.a) { this.a.faceDir = Math.sin(this.t * 0.8) * 0.5; animateAvatar(this.a, 0.016, this.t); }
      this.r.render(this.s, this.cam); requestAnimationFrame(loop);
    };
    loop();
  }
  show(p) {
    if (this.a) this.s.remove(this.a.group);
    const a = this.a = makeAvatar(p);
    buildLook(a, { ...DEFAULT_AVATAR, ...(p.avatar || {}) }, p.mood || 'normal');
    a.shirt.color.set(p.color || '#4f8cff'); a.ring.visible = false; a.online = true;
    this.s.add(a.group);
  }
  dispose() { this.alive = false; this.r.dispose(); }
}


