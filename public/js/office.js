// 3D ofis sahnesi: geçici (prosedürel) ofis düzeni, avatarlar, yürüme, efektler.
// Gerçek ofis modeli gelince yalnız LAYOUT ve buildRoom() değişecek; avatar/yol bulma aynı kalır.
import * as THREE from 'three';
import { OrbitControls } from './../vendor/addons/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './../vendor/addons/CSS2DRenderer.js';
import { STATUSES } from './config.js';

// ---------------------------------------------------------------- Düzen (metre)
// Zemin: x -15..15, z -10..10. +z ekrana doğru.
const W = 30, D = 20;
const DESKS = [];
{
  const xs = [-12, -8.5, -5, -1.5], zs = [-6, -1, 4];
  let n = 1;
  for (const z of zs) for (const x of xs) DESKS.push({ no: n++, x, z, seat: { x, z: z + 0.8, face: Math.PI } });
}
const MEETING_SEATS = [
  { x: 9, z: -7.5, face: 0 }, { x: 10.5, z: -7.5, face: 0 }, { x: 12, z: -7.5, face: 0 },
  { x: 9, z: -4.5, face: Math.PI }, { x: 10.5, z: -4.5, face: Math.PI }, { x: 12, z: -4.5, face: Math.PI },
  { x: 7.7, z: -6, face: Math.PI / 2 }, { x: 13.3, z: -6, face: -Math.PI / 2 },
];
const KITCHEN_SPOTS = [
  { x: 13.6, z: 4.6, face: Math.PI / 2 }, { x: 13.6, z: 6.2, face: Math.PI / 2 }, { x: 13.6, z: 7.8, face: Math.PI / 2 },
  { x: 9.4, z: 5.4, face: Math.PI / 2 }, { x: 11, z: 5.4, face: -Math.PI / 2 },
  { x: 9.4, z: 8.4, face: Math.PI / 2 }, { x: 11, z: 8.4, face: -Math.PI / 2 }, { x: 12.2, z: 9.2, face: Math.PI },
];
const DOOR_IN = { x: -12, z: 9.0 };      // kapının içi
const DOOR_OUT = { x: -12, z: 12.5 };    // kapının dışı (görünmez olunan yer)

// Duvarlar: [x1,z1,x2,z2]
const WALLS = [
  [-15, -10, 15, -10], [15, -10, 15, 10], [-15, -10, -15, 10],
  [-15, 10, -13.2, 10], [-10.8, 10, 15, 10],                    // giriş boşluğu x -13.2..-10.8
  [6, -10, 6, -4.6], [6, -3.0, 6, -2], [6, -2, 15, -2],          // toplantı odası (kapı z -4.6..-3.0)
  [8, 3, 15, 3], [8, 3, 8, 4.2], [8, 5.8, 8, 10],                // mutfak (kapı z 4.2..5.8)
];
const OBSTACLES = []; // [cx, cz, sx, sz] yol bulmada engel
DESKS.forEach((d) => OBSTACLES.push([d.x, d.z - 0.1, 1.6, 0.8]));
OBSTACLES.push([10.5, -6, 4.2, 1.6]);            // toplantı masası
OBSTACLES.push([14.55, 6.2, 0.7, 5.4]);          // mutfak tezgahı
OBSTACLES.push([10.2, 5.4, 1.0, 1.0], [10.2, 8.4, 1.0, 1.0]); // bistro masaları
OBSTACLES.push([3, -9.4, 2.6, 0.8]);             // dolap
OBSTACLES.push([-14.4, 0, 0.6, 3]);              // kanepe

// ---------------------------------------------------------------- Yol bulma (ızgara A*)
const CELL = 0.25, GW = Math.round(W / CELL), GD = Math.round(D / CELL) + 16; // dışarı için ek satırlar
const blocked = new Uint8Array(GW * GD);
const toCell = (x, z) => [Math.floor((x + W / 2) / CELL), Math.floor((z + D / 2) / CELL)];
const toWorld = (cx, cz) => ({ x: cx * CELL - W / 2 + CELL / 2, z: cz * CELL - D / 2 + CELL / 2 });
const isBlocked = (cx, cz) => cx < 0 || cz < 0 || cx >= GW || cz >= GD || blocked[cz * GW + cx] === 1;
(function buildGrid() {
  const R = 0.28; // avatar yarıçapı payı
  for (let cz = 0; cz < GD; cz++) for (let cx = 0; cx < GW; cx++) {
    const { x, z } = toWorld(cx, cz);
    let b = false;
    if (z > D / 2 + 0.2 && (x < -13.2 + R || x > -10.8 - R)) b = true; // dışarıda yalnız kapı önü
    for (const [x1, z1, x2, z2] of WALLS) {
      const minx = Math.min(x1, x2) - 0.1 - R, maxx = Math.max(x1, x2) + 0.1 + R;
      const minz = Math.min(z1, z2) - 0.1 - R, maxz = Math.max(z1, z2) + 0.1 + R;
      if (x >= minx && x <= maxx && z >= minz && z <= maxz) { b = true; break; }
    }
    if (!b) for (const [ox, oz, sx, sz] of OBSTACLES) {
      if (Math.abs(x - ox) <= sx / 2 + R - 0.05 && Math.abs(z - oz) <= sz / 2 + R - 0.05) { b = true; break; }
    }
    blocked[cz * GW + cx] = b ? 1 : 0;
  }
})();

function nearestFree(cx, cz) {
  if (!isBlocked(cx, cz)) return [cx, cz];
  for (let r = 1; r < 12; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    if (!isBlocked(cx + dx, cz + dz)) return [cx + dx, cz + dz];
  }
  return [cx, cz];
}

function lineFree(a, b) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / 0.1);
  for (let i = 1; i < n; i++) {
    const t = i / n, [cx, cz] = toCell(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (isBlocked(cx, cz)) return false;
  }
  return true;
}

function findPath(from, to) {
  const [sx, sz] = nearestFree(...toCell(from.x, from.z));
  const [tx, tz] = nearestFree(...toCell(to.x, to.z));
  const N = GW * GD, g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N), open = [];
  const h = (cx, cz) => Math.hypot(cx - tx, cz - tz);
  const s = sz * GW + sx, t = tz * GW + tx;
  g[s] = 0; open.push([h(sx, sz), s]);
  while (open.length) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, cur] = open.splice(bi, 1)[0];
    if (cur === t) break;
    if (closed[cur]) continue; closed[cur] = 1;
    const cx = cur % GW, cz = (cur / GW) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (isBlocked(nx, nz) || (dx && dz && (isBlocked(cx + dx, cz) || isBlocked(cx, cz + dz)))) continue;
      const ni = nz * GW + nx, ng = g[cur] + (dx && dz ? 1.4142 : 1);
      if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; open.push([ng + h(nx, nz), ni]); }
    }
  }
  if (came[t] === -1 && s !== t) return [{ x: to.x, z: to.z }];
  const cells = []; for (let c = t; c !== -1; c = came[c]) cells.push(toWorld(c % GW, (c / GW) | 0));
  cells.reverse();
  // Çizgi-görüş ile yumuşatma
  const pts = [{ x: from.x, z: from.z }];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !lineFree(pts[pts.length - 1], cells[j])) j--;
    pts.push(cells[j]); i = j;
  }
  pts.push({ x: to.x, z: to.z });
  return pts.slice(1);
}

// ---------------------------------------------------------------- Yardımcılar
function textSprite(text, { size = 0.9, color = 'rgba(40,52,70,0.55)' } = {}) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  g.font = '600 92px Inter, Segoe UI, sans-serif'; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 84);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 6.4, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.02;
  return m;
}
const box = (sx, sy, sz, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.castShadow = true; m.receiveShadow = true; return m; };
const lerpAngle = (a, b, t) => { let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

// ---------------------------------------------------------------- Sahne
export class Office {
  constructor(container, { onAvatarClick } = {}) {
    this.container = container;
    this.onAvatarClick = onAvatarClick;
    this.avatars = new Map();
    this.meetingTaken = new Map(); this.kitchenTaken = new Map();
    this.effects = [];
    this.timer = new THREE.Timer(); this.elapsed = 0;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    container.appendChild(r.domElement);

    const l = this.labels = new CSS2DRenderer();
    l.domElement.className = 'label-layer';
    container.appendChild(l.domElement);

    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color('#e9eef5');
    s.fog = new THREE.Fog('#e9eef5', 45, 80);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(-2, 21, 22);
    const c = this.controls = new OrbitControls(this.camera, l.domElement);
    c.target.set(0, 0, 0); c.enableDamping = true; c.dampingFactor = 0.08;
    c.maxPolarAngle = 1.25; c.minDistance = 6; c.maxDistance = 48; c.screenSpacePanning = false;

    s.add(new THREE.HemisphereLight('#ffffff', '#b9c4d2', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(-10, 25, 12); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 16, bottom: -16, near: 1, far: 70 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    s.add(sun);

    this.buildRoom();
    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    l.domElement.addEventListener('dblclick', () => this.fitView());
    l.domElement.addEventListener('pointerdown', (e) => { this._down = [e.clientX, e.clientY]; });
    l.domElement.addEventListener('pointerup', (e) => {
      if (!this._down || Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) > 5) return;
      this._pick(e);
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    r.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h); this.labels.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix();
    if (!this._fitted) { this.fitView(); this._fitted = true; }
  }

  // Tüm ofisi yan panellerin arasındaki boş alana sığdırır
  fitView(sidePx = window.innerWidth > 900 ? 720 : 0) {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    const avail = Math.max(w - sidePx, w * 0.45);
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), tanH = tanV * (w / h);
    const dW = (W / 2 + 1) * w / (avail * tanH), dD = (D / 2 + 3) / tanV;
    const dist = Math.min(Math.max(dW, dD, 14), 46);
    const dir = new THREE.Vector3(-0.08, 0.8, 0.6).normalize();
    this.controls.target.set(0.5, 0, 1);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.update();
  }

  buildRoom() {
    const s = this.scene;
    const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
    // Zemin
    const fc = document.createElement('canvas'); fc.width = fc.height = 256;
    const fg = fc.getContext('2d'); fg.fillStyle = '#f7f8fa'; fg.fillRect(0, 0, 256, 256);
    fg.strokeStyle = '#e3e7ee'; fg.lineWidth = 2; fg.strokeRect(0, 0, 256, 256);
    const ft = new THREE.CanvasTexture(fc); ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(W / 2, D / 2); ft.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M('#ffffff', { map: ft }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), M('#dfe5ec'));
    outside.rotation.x = -Math.PI / 2; outside.position.y = -0.01; outside.receiveShadow = true; s.add(outside);
    // Toplantı ve mutfak zemin renkleri
    const zone = (x1, z1, x2, z2, color) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1, z2 - z1), M(color)); m.rotation.x = -Math.PI / 2; m.position.set((x1 + x2) / 2, 0.005, (z1 + z2) / 2); m.receiveShadow = true; s.add(m); };
    zone(6, -10, 15, -2, '#e8eefb'); zone(8, 3, 15, 10, '#fbf1e4');
    // Duvarlar (kesit görünüm için alçak)
    const wallMat = M('#cfd6e0'), glass = new THREE.MeshStandardMaterial({ color: '#9ec5ff', transparent: true, opacity: 0.28, roughness: 0.1 });
    WALLS.forEach(([x1, z1, x2, z2], i) => {
      const len = Math.hypot(x2 - x1, z2 - z1), isGlass = i >= 5 && i <= 7;
      const m = box(len + 0.2, isGlass ? 1.6 : 1.1, 0.2, isGlass ? glass : wallMat);
      m.position.set((x1 + x2) / 2, isGlass ? 0.8 : 0.55, (z1 + z2) / 2);
      m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      if (isGlass) m.castShadow = false;
      s.add(m);
    });
    // Masalar
    const deskMat = M('#f2e6d6'), legMat = M('#8a93a3'), screen = M('#1f2633', { roughness: 0.3 }), chairMat = M('#46536a');
    DESKS.forEach((d) => {
      const g = new THREE.Group(); g.position.set(d.x, 0, d.z);
      const top = box(1.6, 0.05, 0.8, deskMat); top.position.y = 0.74; g.add(top);
      [[-0.75, -0.35], [0.75, -0.35], [-0.75, 0.35], [0.75, 0.35]].forEach(([x, z]) => { const lg = box(0.05, 0.72, 0.05, legMat); lg.position.set(x, 0.36, z); g.add(lg); });
      const mon = box(0.6, 0.36, 0.03, screen); mon.position.set(0, 1.0, -0.25); g.add(mon);
      const st = box(0.05, 0.2, 0.05, legMat); st.position.set(0, 0.84, -0.27); g.add(st);
      const chair = box(0.5, 0.08, 0.5, chairMat); chair.position.set(0, 0.45, 0.8); g.add(chair);
      const back = box(0.5, 0.5, 0.06, chairMat); back.position.set(0, 0.72, 1.05); g.add(back);
      const num = textSprite(String(d.no), { size: 0.35, color: 'rgba(60,70,90,0.45)' }); num.position.set(0.6, 0.771, 0.2); g.add(num);
      s.add(g);
    });
    // Toplantı masası + sandalyeler
    const mt = box(4.2, 0.06, 1.6, M('#ffffff', { roughness: 0.4 })); mt.position.set(10.5, 0.74, -6); s.add(mt);
    const mleg = box(3.6, 0.7, 0.3, legMat); mleg.position.set(10.5, 0.36, -6); s.add(mleg);
    MEETING_SEATS.forEach((p) => { const ch = box(0.5, 0.08, 0.5, chairMat); ch.position.set(p.x, 0.45, p.z); s.add(ch); });
    const screenM = box(2.6, 1.4, 0.06, screen); screenM.position.set(10.5, 1.4, -9.85); s.add(screenM);
    // Mutfak
    const counter = box(0.7, 0.95, 5.4, M('#ffffff')); counter.position.set(14.55, 0.475, 6.2); s.add(counter);
    const ctop = box(0.74, 0.04, 5.44, M('#3c4658', { roughness: 0.4 })); ctop.position.set(14.55, 0.97, 6.2); s.add(ctop);
    const coffee = box(0.35, 0.45, 0.35, M('#c0392b', { roughness: 0.4 })); coffee.position.set(14.6, 1.2, 4.2); s.add(coffee);
    [[10.2, 5.4], [10.2, 8.4]].forEach(([x, z]) => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 24), M('#ffffff')); t.position.set(x, 1.0, z); t.castShadow = true; s.add(t);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), legMat); p.position.set(x, 0.5, z); s.add(p);
    });
    // Dekor
    const cab = box(2.6, 1.8, 0.8, M('#dde3ea')); cab.position.set(3, 0.9, -9.4); s.add(cab);
    const sofa = box(0.6, 0.45, 3, M('#5b7db1')); sofa.position.set(-14.4, 0.25, 0); s.add(sofa);
    const plant = (x, z) => {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.4, 12), M('#b07b52')); pot.position.set(x, 0.2, z); pot.castShadow = true; s.add(pot);
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), M('#3f9d5a', { flatShading: true })); leaf.position.set(x, 0.75, z); leaf.castShadow = true; s.add(leaf);
    };
    [[-14.3, -9.3], [5.3, -9.3], [5.3, 9.3], [-14.3, 3], [7.4, 2.5], [-9.4, 9.3]].forEach(([x, z]) => plant(x, z));
    // Etiketler
    const lab = (t, x, z, size) => { const m = textSprite(t, { size }); m.position.x = x; m.position.z = z; s.add(m); };
    lab('TOPLANTI ODASI', 10.5, -3, 0.55); lab('MUTFAK · MOLA', 11.2, 9.4, 0.5); lab('AÇIK OFİS', -6.8, 7.6, 0.6); lab('GİRİŞ', -12, 11.2, 0.45);
    // Dışarıdakiler için kapı önü işareti
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2), M('#9aa6b5')); mat.rotation.x = -Math.PI / 2; mat.position.set(-12, 0.006, 10.8); s.add(mat);
  }

  // ------------------------------------------------------------ Avatarlar
  _makeAvatar(p) {
    const g = new THREE.Group();
    const color = new THREE.Color(p.color || '#4f8cff');
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true });
    const skin = new THREE.MeshStandardMaterial({ color: '#f1c7a3', roughness: 0.7, transparent: true });
    const pants = new THREE.MeshStandardMaterial({ color: '#33405a', roughness: 0.8, transparent: true });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.42, 6, 12), body); torso.position.y = 0.95; torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), skin); head.position.y = 1.5; head.castShadow = true;
    const legL = new THREE.Group(), legR = new THREE.Group();
    [legL, legR].forEach((lg, i) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.42, 4, 8), pants); m.position.y = -0.28; m.castShadow = true; lg.add(m);
      lg.position.set(i ? 0.1 : -0.1, 0.62, 0); g.add(lg);
    });
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), skin); nose.position.set(0, 1.5, 0.17);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 32), new THREE.MeshBasicMaterial({ color: '#2ec27e', transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.9; hit.userData.id = p.id;
    g.add(torso, head, nose, ring, hit);

    const el = document.createElement('div'); el.className = 'avatar-label';
    el.innerHTML = `<span class="al-icon"></span><span class="al-name"></span><span class="al-badge" hidden></span>`;
    const label = new CSS2DObject(el); label.position.set(0, 2.0, 0); label.center.set(0.5, 1);
    g.add(label);
    el.addEventListener('pointerup', (e) => { e.stopPropagation(); this.onAvatarClick?.(p.id); });

    this.scene.add(g);
    return { group: g, torso, legL, legR, ring, hit, el, label, mats: [body, skin, pants], path: [], target: null,
      sit: 0, sitGoal: 0, face: 0, walkT: 0, opacity: 1, opacityGoal: 1, visible: true, place: null };
  }

  _spotFor(id, p) {
    const st = STATUSES[p.status] ?? STATUSES.musait;
    this.meetingTaken.forEach((v, k) => { if (v === id && st.place !== 'meeting') this.meetingTaken.delete(k); });
    this.kitchenTaken.forEach((v, k) => { if (v === id && st.place !== 'kitchen') this.kitchenTaken.delete(k); });
    const desk = DESKS.find((d) => d.no === p.desk_no) ?? null;
    const deskSpot = desk ? { ...desk.seat, sit: true } : { x: 2 + (id.length % 3), z: 6, face: Math.PI, sit: false };
    const pick = (spots, taken) => {
      for (const [k, v] of taken) if (v === id) return { ...spots[k], idx: k };
      const i = spots.findIndex((_, k) => !taken.has(k));
      if (i === -1) return null;
      taken.set(i, id); return { ...spots[i], idx: i };
    };
    switch (st.place) {
      case 'meeting': { const sp = pick(MEETING_SEATS, this.meetingTaken); return sp ? { ...sp, sit: true, place: 'meeting' } : { x: 9, z: -3.6, face: Math.PI, place: 'meeting' }; }
      case 'kitchen': { const sp = pick(KITCHEN_SPOTS, this.kitchenTaken); return sp ? { ...sp, sit: false, place: 'kitchen' } : { x: 10, z: 7, face: 0, place: 'kitchen' }; }
      case 'outside': return { ...DOOR_OUT, face: 0, sit: false, place: 'outside', hide: true };
      case 'away': return { ...deskSpot, place: 'away', hide: true, instant: true };
      default: return { ...deskSpot, place: 'desk' };
    }
  }

  // p: profil satırı. animate=false ise doğrudan yerine koyar.
  upsertPerson(p, { animate = true, online = true, openTasks = 0, isMe = false } = {}) {
    let a = this.avatars.get(p.id);
    const fresh = !a;
    if (!a) { a = this._makeAvatar(p); this.avatars.set(p.id, a); }
    a.profile = p;
    a.mats[0].color.set(p.color || '#4f8cff');
    const st = STATUSES[p.status] ?? STATUSES.musait;
    a.ring.material.color.set(st.color);
    a.el.querySelector('.al-icon').textContent = st.icon;
    a.el.querySelector('.al-name').textContent = p.display_name + (p.status_note ? ' · ' + p.status_note : '');
    a.el.classList.toggle('me', isMe);
    this.setOnline(p.id, online);
    this.setTaskCount(p.id, openTasks);

    const spot = this._spotFor(p.id, p);
    const prevPlace = a.place;
    a.place = spot.place;
    a.label.position.y = 2.0 + (spot.idx !== undefined ? (spot.idx % 3) * 0.32 : 0);
    if (fresh || !animate || spot.instant) {
      if (spot.hide) { a.group.position.set(spot.x, 0, spot.z); a.visible = false; a.opacityGoal = a.opacity = 0; }
      else {
        a.group.position.set(spot.x, 0, spot.z); a.visible = true; a.opacityGoal = online ? 1 : 0.35; a.opacity = a.opacityGoal;
      }
      a.group.rotation.y = a.face = spot.face; a.sit = a.sitGoal = spot.sit ? 1 : 0; a.path = []; a.target = spot;
      return;
    }
    if (prevPlace === spot.place && a.target && Math.hypot(a.target.x - spot.x, a.target.z - spot.z) < 0.01) return;
    // Daha önce görünmezse kapıdan ya da masadan belirsin
    if (!a.visible) {
      const from = prevPlace === 'outside' ? DOOR_OUT : a.group.position;
      a.group.position.set(from.x, 0, from.z);
      a.visible = true; a.opacity = 0;
    }
    a.opacityGoal = spot.hide ? 1 : (online ? 1 : 0.35);
    a.sitGoal = 0;
    a.target = spot;
    a.path = findPath({ x: a.group.position.x, z: a.group.position.z }, spot);
  }

  removePerson(id) {
    const a = this.avatars.get(id); if (!a) return;
    a.label.element.remove(); this.scene.remove(a.group); this.avatars.delete(id);
    this.meetingTaken.forEach((v, k) => v === id && this.meetingTaken.delete(k));
    this.kitchenTaken.forEach((v, k) => v === id && this.kitchenTaken.delete(k));
  }

  setOnline(id, online) {
    const a = this.avatars.get(id); if (!a) return;
    a.online = online;
    a.el.classList.toggle('offline', !online);
    if (a.visible && !a.target?.hide) a.opacityGoal = online ? 1 : 0.35;
  }

  setTaskCount(id, n) {
    const a = this.avatars.get(id); if (!a) return;
    const b = a.el.querySelector('.al-badge');
    b.hidden = !n; b.textContent = n;
  }

  setHighlight(id) {
    this.avatars.forEach((a, k) => a.el.classList.toggle('selected', k === id));
  }

  focus(id) {
    const a = this.avatars.get(id); if (!a) return;
    const p = a.visible ? a.group.position : DOOR_IN;
    this._focus = { from: this.controls.target.clone(), to: new THREE.Vector3(p.x, 0, p.z), t: 0 };
  }

  celebrate(id) {
    const a = this.avatars.get(id); if (!a || !a.visible) return;
    const colors = ['#ff6b6b', '#f6a623', '#2ec27e', '#4f8cff', '#a06cff', '#ffcc00'];
    const geo = new THREE.BoxGeometry(0.08, 0.08, 0.02);
    for (let i = 0; i < 46; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true }));
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
    const hits = this.ray.intersectObjects([...this.avatars.values()].filter((a) => a.visible).map((a) => a.hit), false);
    this.onAvatarClick?.(hits.length ? hits[0].object.userData.id : null);
  }

  tick() {
    this.timer.update(); const dt = Math.min(this.timer.getDelta(), 0.05); this.elapsed += dt; const t = this.elapsed;
    if (this._focus) {
      const f = this._focus; f.t = Math.min(1, f.t + dt * 2);
      const k = 1 - Math.pow(1 - f.t, 3), next = f.from.clone().lerp(f.to, k);
      const delta = next.clone().sub(this.controls.target);
      this.controls.target.add(delta); this.camera.position.add(delta);
      if (f.t >= 1) this._focus = null;
    }
    this.controls.update();

    for (const a of this.avatars.values()) {
      const g = a.group;
      let walking = false;
      if (a.path.length) {
        const wp = a.path[0], dx = wp.x - g.position.x, dz = wp.z - g.position.z, d = Math.hypot(dx, dz);
        const step = 2.4 * dt;
        if (d <= step) { g.position.x = wp.x; g.position.z = wp.z; a.path.shift(); }
        else { g.position.x += (dx / d) * step; g.position.z += (dz / d) * step; a.face = Math.atan2(dx, dz); walking = true; }
        if (!a.path.length && a.target) {
          a.face = a.target.face; a.sitGoal = a.target.sit ? 1 : 0;
          if (a.target.hide) a.opacityGoal = 0;
        }
      }
      g.rotation.y = lerpAngle(g.rotation.y, a.face, Math.min(1, dt * 10));
      a.sit += (a.sitGoal - a.sit) * Math.min(1, dt * 6);
      a.walkT += walking ? dt * 9 : 0;
      const swing = walking ? Math.sin(a.walkT) * 0.6 : 0;
      a.legL.rotation.x = swing - a.sit * 1.45; a.legR.rotation.x = -swing - a.sit * 1.45;
      let y = -a.sit * 0.17 + (walking ? Math.abs(Math.sin(a.walkT)) * 0.05 : 0);
      if (a.jump > 0) { a.jump -= dt; y += Math.sin((0.6 - a.jump) / 0.6 * Math.PI) * 0.45; }
      g.position.y = y;
      a.torso.position.y = 0.95; a.torso.rotation.x = walking ? 0.06 : 0;
      const pulse = a.online ? 0.75 + Math.sin(t * 3 + g.position.x) * 0.2 : 0.35;
      a.ring.material.opacity = pulse * a.opacity;
      a.ring.position.y = 0.03 - y;
      // Saydamlık
      a.opacity += (a.opacityGoal - a.opacity) * Math.min(1, dt * 4);
      a.mats.forEach((m) => { m.opacity = a.opacity; m.depthWrite = a.opacity > 0.95; });
      const vis = a.opacity > 0.02;
      g.visible = vis; a.label.visible = vis;
      if (!vis && a.opacityGoal === 0) a.visible = false;
      a.el.style.opacity = Math.max(a.opacity, a.online ? 0 : 0);
    }

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const m = this.effects[i], u = m.userData;
      u.life -= dt; u.v.y -= 9 * dt;
      m.position.addScaledVector(u.v, dt); m.rotation.x += u.spin * dt; m.rotation.z += u.spin * dt;
      if (m.position.y < 0.02) { m.position.y = 0.02; u.v.set(0, 0, 0); }
      m.material.opacity = Math.min(1, u.life);
      if (u.life <= 0) { this.scene.remove(m); m.material.dispose(); this.effects.splice(i, 1); }
    }

    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}

export const DESK_COUNT = DESKS.length;
