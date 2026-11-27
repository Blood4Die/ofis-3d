// Supabase bağlantısı. Publishable anahtar tarayıcıda herkese açık olacak şekilde tasarlanmıştır;
// veri güvenliği veritabanındaki RLS kurallarıyla sağlanır.
export const SUPABASE_URL = 'https://hhwrrgxnvtqeugppkqdt.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_n0KwF3mBMPXz_0f_BlIE4A_4r28CKLy';

export const STATUSES = {
  musait:     { label: 'Müsait',     color: '#2ec27e', icon: '🟢', place: 'desk' },
  odakta:     { label: 'Odakta',     color: '#a06cff', icon: '🎧', place: 'desk' },
  toplantida: { label: 'Toplantıda', color: '#ff5c5c', icon: '👥', place: 'meeting' },
  molada:     { label: 'Molada',     color: '#f6a623', icon: '☕', place: 'kitchen' },
  sahada:     { label: 'Sahada',     color: '#0fa3a3', icon: '🔧', place: 'shop' },
  disarida:   { label: 'Dışarıda',   color: '#4f8cff', icon: '🚗', place: 'outside' },
  izinli:     { label: 'İzinli',     color: '#8a8f98', icon: '🏖️', place: 'away' },
};

export const MOODS = {
  mutlu:   { label: 'Mutlu',   icon: '😄' },
  motive:  { label: 'Motive',  icon: '🔥' },
  iyi:     { label: 'İyi',     icon: '🙂' },
  normal:  { label: 'Normal',  icon: '😐' },
  yorgun:  { label: 'Yorgun',  icon: '😴' },
  stresli: { label: 'Stresli', icon: '😣' },
};

// Avatar seçenekleri
export const AVATAR_OPTS = {
  skin: ['#f6d5b8', '#eabf98', '#c98e64', '#8d5a3b'],
  hair: { kisa: 'Kısa', uzun: 'Uzun', topuz: 'Topuz', kivircik: 'Kıvırcık', kel: 'Yok' },
  hairColor: ['#2b211c', '#5a3b26', '#a8743f', '#d8b46a', '#8a8f98', '#b3392f'],
  extra: { yok: 'Yok', gozluk: 'Gözlük', kulaklik: 'Kulaklık', sapka: 'Şapka', baret: 'Baret' },
};
export const DEFAULT_AVATAR = { skin: '#eabf98', hair: 'kisa', hairColor: '#2b211c', extra: 'yok' };

export const TASK_STATES = {
  bekliyor: { label: 'Bekliyor', next: 'suruyor' },
  suruyor:  { label: 'Sürüyor',  next: 'bitti' },
  bitti:    { label: 'Bitti',    next: 'bekliyor' },
};
