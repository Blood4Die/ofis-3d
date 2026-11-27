# Ofis 3D — Canlı ofis ve iş takibi

Tarayıcıda çalışan, 3D animasyonlu ofis içinde ekibin durumunu ve günlük/planlı işleri anlık gösteren uygulama (≤12 kullanıcı).

## Mimari
| Parça | Görev |
|---|---|
| `public/` | Uygulamanın tamamı: düz HTML + JS (ES modülleri), derleme adımı yok |
| `public/vendor/` | three.js r187 ve supabase-js 2.x (yerel kopya, CDN bağımlılığı yok; MIT) |
| Supabase (`ofis-3d`, eu-central-1) | Postgres, kimlik doğrulama, Realtime (postgres_changes + presence) |
| Edge function `signup` | Davet kodu ile kayıt; kullanıcıyı onaylı oluşturur, masa atar. İlk kayıt olan yönetici olur |
| GitHub Pages (`gh-pages` dalı) | Statik yayın; `main`'e push → Actions `public/` klasörünü yayınlar |

## Dosyalar
- `js/config.js` — Supabase adresi/publishable anahtar, durum tanımları
- `js/data.js` — veri katmanı (`SupabaseBackend` + sunucusuz `DemoBackend`)
- `js/office.js` — 3D sahne: geçici ofis düzeni (`LAYOUT` bölümü), A* yol bulma, avatarlar, efektler
- `js/app.js` — arayüz, paneller, canlı olay işleme

## Güvenlik
- Tarayıcıdaki anahtar *publishable*'dır; erişim veritabanındaki RLS kurallarıyla kısıtlıdır:
  - Okuma yalnız giriş yapmış kullanıcılar.
  - Profil: herkes kendi profilini günceller; `is_admin` yalnız yönetici değiştirebilir (trigger).
  - Görev: ekleyen/atanan/yönetici günceller; ekleyen/yönetici siler.
  - `activity` yalnız trigger'larla yazılır; `app_settings` (davet kodu) istemciye kapalı.
- Davet kodu `public.app_settings` tablosunda (`invite_code`), kullanıcı sınırı `max_users`.

## Bağlantı kopması
İstemci son bilinen durumu gösterir, kırmızı uyarı bandı çıkar; Realtime yeniden bağlanınca tüm veri yeniden yüklenir (kaçırılan olaylar telafi edilir).

## Demo
`?demo=1` — sunucusuz; veri tarayıcının localStorage'ında, sekmeler arası BroadcastChannel ile senkron, sahte ekip üyeleri rastgele hareket eder.

## Gerçek ofis modeline geçiş
`office.js` içindeki `DESKS`, `MEETING_SEATS`, `KITCHEN_SPOTS`, `WALLS`, `OBSTACLES` ve `buildRoom()` değiştirilir; GLB model `GLTFLoader` ile yüklenip `buildRoom()` yerine konur. Avatar, yol bulma ve veri katmanı aynı kalır.
