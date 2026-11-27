// Supabase bağlantısı. Publishable anahtar tarayıcıda herkese açık olacak şekilde tasarlanmıştır;
// veri güvenliği veritabanındaki RLS kurallarıyla sağlanır.
export const SUPABASE_URL = 'https://hhwrrgxnvtqeugppkqdt.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_n0KwF3mBMPXz_0f_BlIE4A_4r28CKLy';

export const STATUSES = {
  musait:     { label: 'Müsait',     color: '#2ec27e', icon: '🟢', place: 'desk' },
  odakta:     { label: 'Odakta',     color: '#a06cff', icon: '🎧', place: 'desk' },
  toplantida: { label: 'Toplantıda', color: '#ff5c5c', icon: '👥', place: 'meeting' },
  molada:     { label: 'Molada',     color: '#f6a623', icon: '☕', place: 'kitchen' },
  disarida:   { label: 'Dışarıda',   color: '#4f8cff', icon: '🚗', place: 'outside' },
  izinli:     { label: 'İzinli',     color: '#8a8f98', icon: '🏖️', place: 'away' },
};

export const TASK_STATES = {
  bekliyor: { label: 'Bekliyor', next: 'suruyor' },
  suruyor:  { label: 'Sürüyor',  next: 'bitti' },
  bitti:    { label: 'Bitti',    next: 'bekliyor' },
};
