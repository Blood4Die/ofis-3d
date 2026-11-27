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
//  bench      {x,z,modules,deskStart,group}  karşılıklı masa sırası (z ekseni boyunca), her modülde 2 kişi + PC + sandalye
//  singleDesks{x,z,count,deskStart,group}    x boyunca tekli masalar, kişi +z tarafında arkaya bakar
//  execDesk   {x,z,face,deskNo,name,guests}  müdür/yönetici masası (face: kişinin baktığı yön)
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
  id: 'zemin', name: 'Zemin Kat', width: 36, depth: 20,
  // Ofis x -18..6 | Üretim Teknolojileri ve Bakım x 6..18 (geçiş sağ önde, z 2..5.5)
  areas: [
    { x1: -18, z1: -10, x2: 6, z2: 10, color: '#e4e7ec', tile: '#d6dae1', rep: [12, 10] },   // ofis
    { x1: 6, z1: -10, x2: 18, z2: 10, color: '#cfd7e2', tile: '#c3ccd8', rep: [3, 5] },      // atölye
    { x1: -4, z1: -10, x2: 2, z2: -5.5, color: '#e6ecf6' },                                   // toplantı
    { x1: -18, z1: 5, x2: -13, z2: 10, color: '#efe5d6' },                                    // mola
  ],
  lanes: [{ x1: 6.2, z1: 3.0, x2: 17.8, z2: 4.3 }, { x1: 7.0, z1: -9.6, x2: 7.9, z2: 3.0 }, { x1: 7.0, z1: 4.3, x2: 7.9, z2: 9.6 }],
  walls: [
    [-18, -10, 18, -10, 'w'], [18, -10, 18, 10, 'w'], [-18, -10, -18, 10, 'w'],
    [-18, 10, -9.8, 10, 'w'], [-8.2, 10, -4.8, 10, 'w'], [-3.2, 10, 18, 10, 'w'],   // iki cam giriş kapısı
    [6, -10, 6, 2, 'w'], [6, 5.5, 6, 10, 'w'],                                        // ofis | atölye
    [-4, -10, -4, -5.5, 'g'], [-4, -5.5, -1.6, -5.5, 'g'], [0, -5.5, 2, -5.5, 'g'], [2, -5.5, 2, -10, 'g'], // cam toplantı odası
  ],
  windows: [[-17, -12, -10], [2.6, 5.6, -10], [9, 12, -10], [13, 17, -10]],
  doors: [{ x: -9, z: 10 }, { x: -4, z: 10 }],
  sign: { x: -6.5, z: 10.12 },
  props: [
    // Masa 1: öndeki uzun sıra (10 kişi) + müdür masası (sağ arka, pencere önü)
    { type: 'bench', x: 0, z: 0.5, modules: 5, deskStart: 1, group: 'Masa 1' },
    { type: 'execDesk', x: 4, z: -7, face: 0, deskNo: 19, name: 'Müdür (Masa 1)', guests: 2 },
    // Masa 2: dolapların arkasındaki sıra (6 kişi) + arka sol tekli masalar + yönetici masası (sol ön)
    { type: 'bench', x: -5.5, z: -2, modules: 3, deskStart: 11, group: 'Masa 2' },
    { type: 'singleDesks', x: -12.5, z: -6.2, count: 2, deskStart: 17, group: 'Masa 2' },
    { type: 'execDesk', x: -12.5, z: 2.5, face: Math.PI / 2, deskNo: 20, name: 'Yönetici (Masa 2)', guests: 0 },
    { type: 'bistro', x: -10.8, z: 4.2, low: true },
    // Sarı dolaplar (masa sıralarına paralel)
    { type: 'lockers', x: -2.65, z: 1.5, w: 0.8, d: 5 }, { type: 'lockers', x: -8.4, z: -4.2, w: 0.8, d: 3.5 },
    { type: 'column', x: -4.6, z: -5.0 }, { type: 'column', x: 2.7, z: -4.4 },
    // Toplantı
    { type: 'roundTable', x: -1, z: -7.8, r: 1.1, seats: 7, zone: 'meeting' },
    { type: 'screen', x: -1, z: -9.85, w: 2.0 },
    // Mola (sol ön köşe)
    { type: 'counter', x: -17.6, z: 7.5, w: 0.6, d: 4, coffee: true },
    { type: 'bistro', x: -15.6, z: 6.4 }, { type: 'bistro', x: -15.2, z: 8.8 },
    ...[[-17.4, -9.4], [5.4, -9.4], [-17.4, 4.4], [5.4, 9.4], [-2.4, 9.4], [-4.5, -9.4]].map(([x, z]) => ({ type: 'plant', x, z })),
    // Üretim Teknolojileri ve Bakım
    { type: 'rack', x: 16.4, z: -7.6, len: 3 }, { type: 'rack', x: 16.4, z: -4.5, len: 3 }, { type: 'rack', x: 16.4, z: -1.4, len: 3 },
    { type: 'workbench', x: 10.3, z: -9.3, w: 3.2 },
    { type: 'machine', x: 12.6, z: 6.9, w: 3.2, d: 2.2 },
    { type: 'press', x: 16.6, z: 6.4 },
  ],
  zones: [
    { kind: 'kitchen', name: 'Mola', spots: [
      { x: -16.4, z: 6.4, face: P / 2 }, { x: -14.8, z: 6.4, face: -P / 2 }, { x: -15.6, z: 5.6, face: 0 },
      { x: -16.0, z: 8.8, face: P / 2 }, { x: -14.4, z: 8.8, face: -P / 2 }, { x: -16.9, z: 9.4, face: -P / 2 },
      { x: -16.9, z: 5.8, face: -P / 2 }, { x: -13.8, z: 7.6, face: -P / 2 }] },
    { kind: 'shop', name: 'Üretim Teknolojileri ve Bakım', spots: [
      { x: 9.0, z: -8.0, face: P }, { x: 10.3, z: -8.0, face: P }, { x: 11.6, z: -8.0, face: P },
      { x: 14.6, z: -6.5, face: P / 2 }, { x: 14.6, z: -3.0, face: P / 2 },
      { x: 11.2, z: 5.1, face: 0 }, { x: 12.6, z: 5.1, face: 0 }, { x: 14.0, z: 5.1, face: 0 }] },
  ],
  labels: [
    { text: 'MASA 1', x: 0, z: 5.6, h: 0.5 }, { text: 'MASA 2', x: -5.5, z: 1.1, h: 0.5 },
    { text: 'MÜDÜR', x: 4, z: -5.4, h: 0.4 }, { text: 'YÖNETİCİ', x: -12.5, z: 4.2, h: 0.4 },
    { text: 'TOPLANTI', x: -1, z: -5.9, h: 0.4 }, { text: 'MOLA', x: -15.5, z: 5.3, h: 0.45 },
    { text: 'ÜRETİM TEKNOLOJİLERİ VE BAKIM', x: 12, z: 1.6, h: 0.55 }, { text: 'GİRİŞ', x: -6.5, z: 11.3, h: 0.45 },
  ],
  exit: { x: -4, z: 12.6, gap: [-4.8, -3.2] },
  stairs: null, // üst kat eklenince ör. { x: -17, z: 0 } ve props'a { type:'stairsProp', ... }
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
