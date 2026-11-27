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
    { x1: -10, z1: -10, x2: -3, z2: -4.5, color: '#e6ecf6' },                                 // toplantı
    { x1: -18, z1: 5.5, x2: -14, z2: 10, color: '#efe5d6' },                                  // mola
  ],
  lanes: [{ x1: 6.2, z1: 3.0, x2: 17.8, z2: 4.3 }, { x1: 7.0, z1: -9.6, x2: 7.9, z2: 3.0 }, { x1: 7.0, z1: 4.3, x2: 7.9, z2: 9.6 }],
  walls: [
    [-18, -10, 18, -10, 'w'], [18, -10, 18, 10, 'w'], [-18, -10, -18, 10, 'w'],
    [-18, 10, -12.8, 10, 'w'], [-11.2, 10, -1.8, 10, 'w'], [-0.2, 10, 18, 10, 'w'],  // iki cam giriş kapısı
    [6, -10, 6, 2, 'w'], [6, 5.5, 6, 10, 'w'],                                         // ofis | atölye (geçiş z 2..5.5)
    [-10, -10, -10, -4.5, 'g'], [-10, -4.5, -7.2, -4.5, 'g'], [-5.8, -4.5, -3, -4.5, 'g'], [-3, -4.5, -3, -10, 'g'], // toplantı
  ],
  windows: [[-17.5, -15, -10], [-1.5, 5.5, -10], [9, 12, -10], [13, 17, -10]],
  doors: [{ x: -12, z: 10 }, { x: -1, z: 10 }],
  sign: { x: -9, z: 10.12 },
  props: [
    // Üst sıra: sol müdür masası · toplantı odası · sağ müdür masası
    { type: 'execDesk', x: -14, z: -7.4, face: 0, deskNo: 101, name: 'Müdür masası (sol)', guests: 2 },
    { type: 'roundTable', x: -6.5, z: -7.4, r: 1.1, seats: 7, zone: 'meeting' },
    { type: 'screen', x: -6.5, z: -9.85, w: 2.0 },
    { type: 'execDesk', x: 1, z: -7.4, face: 0, deskNo: 102, name: 'Müdür masası (sağ)', guests: 2 },
    // Orta: üç adet 8 kişilik masa grubu (4 karşı 4), aralarında dolaplar
    { type: 'bench', x: -13, z: 0.5, modules: 4, deskStart: 1, group: 'Masa 1' },
    { type: 'lockers', x: -9.75, z: 0.5, w: 0.8, d: 6.0 },
    { type: 'bench', x: -6.5, z: 0.5, modules: 4, deskStart: 9, group: 'Masa 2' },
    { type: 'lockers', x: -3.25, z: 0.5, w: 0.8, d: 6.0 },
    { type: 'bench', x: 0, z: 0.5, modules: 4, deskStart: 17, group: 'Masa 3' },
    // Alt orta: yönetici masası (ofise bakar)
    { type: 'execDesk', x: -6.5, z: 6.6, face: Math.PI, deskNo: 103, name: 'Yönetici masası', guests: 2 },
    { type: 'column', x: -10.6, z: -3.9 }, { type: 'column', x: -2.4, z: -3.9 },
    // Mola (sol alt köşe)
    { type: 'counter', x: -17.6, z: 7.8, w: 0.6, d: 4, coffee: true },
    { type: 'bistro', x: -15.8, z: 6.8 }, { type: 'bistro', x: -15.6, z: 8.9 },
    ...[[-17.4, -9.4], [5.4, -9.4], [-17.4, 4.6], [5.4, 9.4], [-9.6, -9.4], [-3.4, -9.4]].map(([x, z]) => ({ type: 'plant', x, z })),
    // Üretim Teknolojileri ve Bakım (sağda, ofise bağlı)
    { type: 'rack', x: 16.4, z: -7.6, len: 3 }, { type: 'rack', x: 16.4, z: -4.5, len: 3 }, { type: 'rack', x: 16.4, z: -1.4, len: 3 },
    { type: 'workbench', x: 10.3, z: -9.3, w: 3.2 },
    { type: 'machine', x: 12.6, z: 6.9, w: 3.2, d: 2.2 },
    { type: 'press', x: 16.6, z: 6.4 },
  ],
  zones: [
    { kind: 'kitchen', name: 'Mola', spots: [
      { x: -16.6, z: 6.8, face: P / 2 }, { x: -15.0, z: 6.8, face: -P / 2 }, { x: -15.8, z: 6.0, face: 0 },
      { x: -16.4, z: 8.9, face: P / 2 }, { x: -14.8, z: 8.9, face: -P / 2 }, { x: -16.9, z: 9.5, face: -P / 2 },
      { x: -14.6, z: 7.8, face: -P / 2 }, { x: -16.9, z: 5.9, face: -P / 2 }] },
    { kind: 'shop', name: 'Üretim Teknolojileri ve Bakım', spots: [
      { x: 9.0, z: -8.0, face: P }, { x: 10.3, z: -8.0, face: P }, { x: 11.6, z: -8.0, face: P },
      { x: 14.6, z: -6.5, face: P / 2 }, { x: 14.6, z: -3.0, face: P / 2 },
      { x: 11.2, z: 5.1, face: 0 }, { x: 12.6, z: 5.1, face: 0 }, { x: 14.0, z: 5.1, face: 0 }] },
  ],
  labels: [
    { text: 'MASA 1', x: -13, z: -3.3, h: 0.42 }, { text: 'MASA 2', x: -6.5, z: -3.3, h: 0.42 }, { text: 'MASA 3', x: 0, z: -3.3, h: 0.42 },
    { text: 'MÜDÜR', x: -14, z: -4.9, h: 0.38 }, { text: 'MÜDÜR', x: 1, z: -4.9, h: 0.38 }, { text: 'YÖNETİCİ', x: -6.5, z: 4.5, h: 0.38 },
    { text: 'TOPLANTI', x: -6.5, z: -5.0, h: 0.4 }, { text: 'MOLA', x: -15.8, z: 5.6, h: 0.42 },
    { text: 'ÜRETİM TEKNOLOJİLERİ VE BAKIM', x: 12, z: 1.6, h: 0.55 }, { text: 'GİRİŞ', x: -6.5, z: 11.3, h: 0.45 },
  ],
  exit: { x: -1, z: 12.6, gap: [-1.8, -0.2] },
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
