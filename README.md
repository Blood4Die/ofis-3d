# Ofis 3D — Canlı ofis ve iş takibi

Tarayıcıda çalışan, 3D animasyonlu ofis içinde ekibin durumunu ve günlük/planlı işleri anlık gösteren uygulama (≤12 kullanıcı).

## Mimari
| Parça | Görev |
|---|---|
| `public/js/layout.js` | **Ofis düzeni (katlar, alanlar, mobilya)** — genişletme buradan |
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

## Ofisi genişletmek (kat, oda, yemekhane…)
Düzen tamamen `public/js/layout.js` içinde veridir; çizim/yol bulma kodu değişmez.
1. **Yeni kat:** `FLOORS` listesine kat nesnesi ekle (dosyadaki `UST` örneği: 1. Kat + yemekhane). Her iki katta `stairs: {x,z}` tanımla; avatarlar merdivene yürür, kat değiştirir, devam eder. 2+ kat olunca üstte kat seçici çıkar.
2. **Yeni alan/durum:** Alana `zones: [{ kind:'yemek', spots:[...] }]` ya da masaya `zone:'yemek'` ver; `config.js` → `STATUSES`'a `place:'yemek'` olan durumu ekle; veritabanında `profiles_status_check` listesine yeni durum anahtarını ekle.
3. **Yeni masa:** `bench` prop'u ekle (`deskStart` ile numara aralığı); `app_settings.desk_count` değerini güncelle.
4. **Kullanıcı sınırı:** `app_settings.max_users`.

Prop tipleri: bench, lockers, column, roundTable, longTable, counter, bistro, sofa, plant, screen, rack, workbench, machine, press, stairsProp. Yeni tip için `office.js` → `PROPS` nesnesine çizici ekle.

## Sohbet
Genel (herkes) ve kişiden kişiye özel mesaj. Tablo `messages` (`recipient` null = genel). RLS: genel mesajı herkes, özel mesajı yalnız gönderen ve alıcı okur. Genel mesaj gönderenin avatarı üstünde balon olarak görünür; özel mesajda gönderenin üstünde 💬 çıkar, alıcıya bildirim düşer. Okunmamış sayısı tarayıcıda (localStorage) tutulur. Son 14 günün mesajları yüklenir.

## Arka plan bildirimleri (Web Push) ve acil mesaj
- `public/sw.js` servis çalışanı + `manifest.webmanifest` (uygulama ana ekrana/masaüstüne kurulabilir).
- Kullanıcı "Bildirimleri aç" deyince tarayıcı aboneliği `push_subscriptions` tablosuna yazılır.
- `messages` ve `tasks` (atama) tablolarındaki trigger → `pg_net` → Edge Function `push` → web-push (VAPID). Sırlar `app_settings`'te (istemciye kapalı).
- 🚨 Acil mesaj: alıcıda tam ekran kırmızı uyarı + tekrarlayan alarm; sistem bildirimi tıklanana kadar ekranda kalır (`requireInteraction`).
- iPhone: yalnız "Ana Ekrana Ekle" ile kurulmuş uygulamada (iOS 16.4+) çalışır.

## Avatar ve duygu durumu
Kullanıcı ilk girişte avatarını oluşturur (ten, saç, saç rengi, aksesuar: gözlük/kulaklık/şapka/baret, kıyafet rengi). Duygu durumu (😄🔥🙂😐😴😣) avatarın yüz ifadesini ve hareketini değiştirir; `profiles.avatar` (jsonb) ve `profiles.mood`.
