# Değişiklik Özeti

Bu oturumda yapılan başlıca geliştirmeler ve düzeltmeler.

## 1. Kullanıcıya doğrudan intent izni

- Yeni tablo: `dbo.AiUserPermission` (`UserId`, `Intent`) — `docs/sql/admin-rbac-tables.sql`
- API: `GET/PUT /api/admin/users/:userId/permissions`
- `getEffectivePermissions`: rol intentleri + kullanıcı intentleri birleştirilir
- Tablo yoksa yedek: `data/admin-user-permissions.json`
- Admin panel: **Kullanıcı Yetkileri** → intent checkbox listesi + Kaydet

**Intent isimleri:** `visitCountRealized` (camelCase). `metric_id` (`visit_count_realized`) kaydedilmez.

## 2. SQL scope filtreleri (ziyaret sorguları)

Yeni modül: `src/security/sqlScopeBuilder.js` — `secureQueryExecutor` içinde uygulanır.

| Scope | SQL |
|-------|-----|
| Company | `Visit.SubscriptionId` |
| Kullanıcı | `Visit.UserId` (admin/manageAll değilse) |
| Country | `Client.CountryId` |
| Team | `Client.TeamId` |
| Brand | `Visit.BrandId` veya `ClientBrand` |

**Kaldırılan scope filtreleri:** Client, Region, City, District (DB şeması ve hatalı eşleşme nedeniyle).

Admin scope UI: yalnızca **Company, Country, Team, Brand**.

## 3. Chat ve grafik endpoint’leri

- `/api/chat/query` ve `/api/visit/*` giriş yapılmış kullanıcıda scope’lu çalışır
- `index.html`: tüm API çağrılarına JWT header; girişte UserId hatırlatması
- SQL & Scope paneli: intent izinleri ve scope önizlemesi

## 4. Bilinen davranışlar / dikkat

- **Admin UserId = Chat UserId** olmalı (ör. Bran stark → #14081, `bran@gmail.com`)
- `visitCountRealized` yalnızca `Realized = 1` ve `StartedAt` dolu ziyaretleri sayar; Dispatched planlı kayıt sayılmaz
- Country scope yanlışsa sonuç 0: ör. müşteri Türkiye (173, `db.country.turkey`), admin’de Kolombiya (38) seçiliyse kayıt elenir
- Ülke listesi admin’de lokalizasyon anahtarı olarak görünür (`db.country.turkey` = Türkiye)

## 5. Güncellenen dosyalar (özet)

| Alan | Dosyalar |
|------|----------|
| Backend | `adminPermissionService.js`, `admin.js`, `api.js`, `sqlScopeBuilder.js`, `secureQueryExecutor.js`, `userContextValidator.js` |
| Admin UI | `admin.html`, `admin/app.js`, `admin/adminApi.js` |
| Chat | `index.html` |
| Dokümantasyon | `admin-permission-db-haritasi.md` |
