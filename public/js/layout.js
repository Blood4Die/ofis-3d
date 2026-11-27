// =====================================================================================
// OFİS DÜZENİ — genişletilebilir yapılandırma
// Yeni kat, oda, yemekhane vb. eklemek için yalnız bu dosya (ve gerekirse config.js'teki
// STATUSES) değişir. Koordinatlar metre; her katın merkezi (0,0); +z ekrana doğru.
//
// Kavramlar
//  areas  : zemin renkleri/dokuları            { x1,z1,x2,z2, color, tile? }
//  lanes  : atölye yürüme yolu (mavi+sarı)      { x1,z1,x2,z2 }
//  walls  : duvar 'w' / cam 'g'                 [x1,z1,x2,z2,'w'|'g']
//  windows: arka duvar pencere bandı            [x1,x2,z]
//  doors  : cam giriş kapıları (görsel)          { x, z }
//  props  : mobilya/ekipman (aşağıdaki tipler); engel olarak yol bulmaya otomatik eklenir
//  zones  : durumların gittiği yerler. kind, config.js STATUSES[*].place ile eşleşir.
//           Spotlar burada elle ya da props üzerinden (zone: 'kind') otomatik eklenir.
//  labels : zemin yazıları
//  exit   : "Dışarıda" olan kişinin gideceği nokta (yalnız giriş katında)
//  stairs : katlar arası geçiş noktası (her katta aynı id ile) { x, z }
//
// Prop tipleri:
//  bench      {x,z,modules,deskStart}   karşılıklı masa sırası (z ekseni boyunca), her modülde 2 kişi + PC + sandalye
//  lockers    {x,z,w,d}                 sarı dolap bloğu
//  column     {x,z}
//  roundTable {x,z,r,seats,zone}        sekizgen/yuvarlak masa + sandalyeler (spotlar zone'a eklenir)
//  longTable  {x,z,len,zone}            yemekhane tipi uzun masa (iki yanında oturma)
//  counter    {x,z,w,d}                 tezgah; coffee:true ise kahve makinesi
//  bistro     {x,z}                     ayakta masa
//  sofa       {x,z,w}                   kanepe (arkası +z)
//  plant      {x,z}
//  screen     {x,z,w}                   duvar ekranı
//  rack       {x,z,len}                 depo rafı
//  workbench  {x,z,w}
//  machine    {x,z,w,d}
//  press      {x,z}
//  stairsProp {x,z,w,len,rot}           merdiven görseli
// =====================================================================================

const P = Math.PI;

const ZEMIN = {
  id: 'zemin', name: 'Zemin Kat', width: 32, depth: 20,
  areas: [
    { x1: -16, z1: -10, x2: 4, z2: 10, color: '#e4e7ec', tile: '#d6dae1', rep: [10, 10] },   // ofis
    { x1: 4, z1: -10, x2: 16, z2: 10, color: '#cfd7e2', tile: '#c3ccd8', rep: [3, 5] },      // atölye
    { x1: -4, z1: -10, x2: 4, z2: -3, color: '#e6ecf6' },                                     // toplantı
    { x1: -3, z1: 3, x2: 4, z2: 10, color: '#efe5d6' },                                       // mola
  ],
  lanes: [{ x1: 4.2, z1: -0.4, x2: 15.8, z2: 0.9 }, { x1: 5.0, z1: -9.6, x2: 5.9, z2: -0.4 }, { x1: 5.0, z1: 0.9, x2: 5.9, z2: 9.6 }],
  walls: [
    [-16, -10, 16, -10, 'w'], [16, -10, 16, 10, 'w'], [-16, -10, -16, 10, 'w'],
    [-16, 10, -13.3, 10, 'w'], [-11.7, 10, -9.3, 10, 'w'], [-7.7, 10, 16, 10, 'w'],
    [4, -10, 4, -1, 'w'], [4, 1.6, 4, 10, 'w'],
    [-4, -10, -4, -5.0, 'g'], [-4, -3.6, -4, -3, 'g'], [-4, -3, 4, -3, 'g'],
  ],
  windows: [[-14.5, -11, -10], [-9, -5.5, -10], [6, 9.5, -10], [11, 14.5, -10]],
  doors: [{ x: -12.5, z: 10 }, { x: -8.5, z: 10 }],
  sign: { x: -10.5, z: 10.12 },
  props: [
    { type: 'bench', x: -12, z: 0, modules: 3, deskStart: 1 },
    { type: 'bench', x: -6.5, z: 0, modules: 3, deskStart: 7 },
    { type: 'lockers', x: -11.5, z: -5.5, w: 5, d: 0.5 }, { type: 'lockers', x: -12, z: 5.2, w: 4, d: 0.5 },
    { type: 'column', x: -9.25, z: -8 }, { type: 'column', x: -9.25, z: 7.6 },
    { type: 'roundTable', x: 0, z: -6.5, r: 1.3, seats: 8, zone: 'meeting' },
    { type: 'screen', x: 0, z: -9.85, w: 2.4 },
    { type: 'counter', x: 3.6, z: 6.5, w: 0.6, d: 5, coffee: true },
    { type: 'bistro', x: -0.5, z: 5.5 }, { type: 'bistro', x: 2, z: 7.8 },
    { type: 'sofa', x: -1.5, z: 9.45, w: 2.6 },
    ...[[-15.4, -9.4], [-4.6, -9.4], [3.4, -2.4], [-15.4, 9.4], [-6.6, 9.4], [3.4, 2.3]].map(([x, z]) => ({ type: 'plant', x, z })),
    { type: 'rack', x: 14.4, z: -7.6, len: 3 }, { type: 'rack', x: 14.4, z: -4.5, len: 3 }, { type: 'rack', x: 14.4, z: -1.4, len: 3 },
    { type: 'workbench', x: 8.3, z: -9.3, w: 3.2 },
    { type: 'machine', x: 10.6, z: 6.8, w: 3.2, d: 2.2 },
    { type: 'press', x: 14.5, z: 3.6 },
  ],
  zones: [
    { kind: 'kitchen', name: 'Mola', spots: [
      { x: -1.4, z: 5.5, face: P / 2 }, { x: 0.4, z: 5.5, face: -P / 2 }, { x: -0.5, z: 4.6, face: 0 },
      { x: 1.1, z: 7.8, face: P / 2 }, { x: 2.9, z: 7.8, face: -P / 2 }, { x: 2.8, z: 5.0, face: P / 2 },
      { x: -2.2, z: 8.7, face: P, sit: true }, { x: -0.9, z: 8.7, face: P, sit: true }] },
    { kind: 'shop', name: 'Üretim Teknolojileri ve Bakım', spots: [
      { x: 7.0, z: -8.0, face: P }, { x: 8.3, z: -8.0, face: P }, { x: 9.6, z: -8.0, face: P },
      { x: 12.6, z: -6.5, face: P / 2 }, { x: 12.6, z: -3.0, face: P / 2 },
      { x: 9.2, z: 4.9, face: 0 }, { x: 10.6, z: 4.9, face: 0 }, { x: 12.0, z: 4.9, face: 0 }] },
  ],
  labels: [
    { text: 'AÇIK OFİS', x: -9.3, z: 8.6, h: 0.6 }, { text: 'TOPLANTI', x: 0, z: -3.7, h: 0.5 }, { text: 'MOLA', x: 0.6, z: 3.6, h: 0.5 },
    { text: 'ÜRETİM TEKNOLOJİLERİ VE BAKIM', x: 10.1, z: 2.2, h: 0.55 }, { text: 'GİRİŞ', x: -10.5, z: 11.3, h: 0.45 },
  ],
  exit: { x: -12.5, z: 12.6, gap: [-13.3, -11.7] },
  stairs: null, // üst kat eklenince ör. { x: -14.8, z: -2 } ve props'a { type:'stairsProp', ... }
};

/* ÖRNEK — üst kat + yemekhane eklemek için:
   1) Aşağıdaki bloğu açın, FLOORS listesine ekleyin; ZEMIN.stairs ve merdiven görselini tanımlayın.
   2) config.js STATUSES'a ör. yemekte: { label:'Yemekte', color:'#e0742b', icon:'🍽️', place:'yemek' } ekleyin.
   3) Veritabanında durum listesine 'yemekte' ekleyin (profiles_status_check).

const UST = {
  id: 'ust', name: '1. Kat', width: 24, depth: 16,
  areas: [{ x1: -12, z1: -8, x2: 12, z2: 8, color: '#efe9df', tile: '#e2dbcf', rep: [8, 6] }],
  walls: [[-12, -8, 12, -8, 'w'], [12, -8, 12, 8, 'w'], [-12, -8, -12, 8, 'w'], [-12, 8, 12, 8, 'w']],
  props: [
    { type: 'longTable', x: -2, z: -3, len: 6, zone: 'yemek' }, { type: 'longTable', x: -2, z: 3, len: 6, zone: 'yemek' },
    { type: 'counter', x: 9, z: 0, w: 1, d: 8 },
  ],
  zones: [], labels: [{ text: 'YEMEKHANE', x: 0, z: 6.5, h: 0.6 }],
  stairs: { x: -10.5, z: -6 },
};
*/

export const FLOORS = [ZEMIN];
export const ENTRY_FLOOR = 'zemin';
