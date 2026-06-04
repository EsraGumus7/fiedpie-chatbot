# Admin Panel (Kişi 1) — DB Haritası ve Gerekli Kolonlar

Bu dosya, admin panelin DB’den **hangi bilgileri** okuyacağını/yazacağını, **hangi tablolar & kolonlara** ihtiyaç olduğunu ve bunların **hangi ekrana** bağlandığını netleştirmek içindir.

> Not: Admin paneli inşa etmeye başlamadan önce bu dokümanı doldurup netleştireceğiz.  
> Kişi 1 (UI) yalnızca veri yönetim ekranları; uygulama (intent kontrol, scope SQL, masking) Kişi 2/3 tarafında.

---

## 0) Mevcut bağlantı

- **DB driver**: `mssql`
- **Bağlantı config**: `.env` → `DB_SERVER`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`
- **Kod**: `src/db/sql.js` (`queryDb`)

---

## 1) Akış (admin panelin yeri)

1) Admin panelde yetki/scope/mask ayarı yapılır  
2) Backend bu ayarları **RBAC tablolarına** yazar  
3) Kişi 2 `EffectivePermission` üretir  
4) Kişi 3, intent çalıştırmadan önce izin kontrol eder + SQL scope ekler + sonuç maskeler  
5) Audit log yazılır

---

## 2) Admin Panel ekranları → DB ihtiyaçları

### 2.1 Rol Yetkileri (Role → Allowed intents/metrics)

- **UI input**: Role seç, intent listesinde checkbox
- **DB read**:
  - Roller listesi (Role)
  - Katalog: intent/metric/domain/description (catalog endpoint veya JSON)
  - Seçili rolün izinleri
- **DB write**:
  - RolePermission upsert
- **Audit**:
  - `role.permissions.update`

**Operasyonel rol tablosu:** `dbo.Role` ✅ (yeni `RbacRole` açmıyoruz; mevcut tabloyu kullanıyoruz)

**Intent yetkisi (yeni tablo — Kişi 2):** örn. `ChatbotRolePermission(RoleId, Intent)` — `dbo.RoleModule` kullanılmıyor

**Gerekli alanlar:**
- `dbo.Role`: `Id`, `Name`, `Code`, `SubscriptionId`, `Deleted` (+ tip flag’leri)
- Yeni permission tablosu: `RoleId`, `Intent`

### 2.2 Kullanıcı Yetkileri (User → Roles)

- **UI input**: kullanıcı seç, role multi-select
- **DB read**:
  - Kullanıcı listesi (operasyonel DB)
  - Kullanıcının mevcut rolleri
- **DB write**:
  - UserRole upsert
- **Audit**:
  - `user.roles.update`

**Gerekli alanlar:**
- User (operasyonel): `Id`, `UserName/Login`, `DisplayName` (netleşecek)
- UserRole: `UserId`, `RoleId`

### 2.3 Scope Yetkileri (User → company/brand/client/…)

MVP scope önerisi: önce `company + brand + client`, sonra `country/region/city/district`.

- **DB read**:
  - Referans listeler: Company/Brand/Client (operasyonel DB)
  - Kullanıcının scope kaydı (RBAC)
- **DB write**:
  - UserScope (veya child tablolar)
- **Audit**:
  - `user.scopes.update`

**Gerekli alanlar:**
- UserScope:
  - `UserId`
  - `AllowedCompanyIds`
  - `AllowedBrandIds`
  - `AllowedClientIds`
  - (Sprint 2) `AllowedCountryIds`, `AllowedRegionIds`, `AllowedCityIds`, `AllowedDistrictIds`

> Burada “ID listesi saklama modeli” netleşecek: JSON mı, yoksa `UserScopeCompany(UserId, CompanyId)` gibi child tablo mu?

### 2.4 Column Masking (Role/User → table.column)

- **DB read**:
  - Hassas kolon kataloğu (başlangıç listesi)
  - Mevcut maske kuralları
- **DB write**:
  - ColumnMask rules upsert
- **Audit**:
  - `columnMasks.update`

**Gerekli alanlar:**
- ColumnMask:
  - `RoleId` (nullable)
  - `UserId` (nullable)
  - `TableName`
  - `ColumnName`
  - `MaskType` (`hidden|partial|hash`)

### 2.5 Audit Log (read-only)

- **DB read**: AuditLog liste + filtre
- **DB write**: Kaydet işlemlerinde `adminPermissionService` → `dbo.AiAuditLog` (tablo yoksa sessizce atlanır)

**Gerekli alanlar:**
- AuditLog:
  - `Id`
  - `CreatedAt`
  - `ActorUserId`
  - `Action`
  - `TargetType`
  - `TargetId`
  - `BeforeJson`
  - `AfterJson`
  - (opsiyonel) `RequestId`, `Ip`, `UserAgent`

---

## 3) Operasyonel DB’den toplanacak referans veriler (dropdown/search)

Bu bölümde **gerçek tablo/kolon isimlerini** netleştireceğiz.

### 3.1 Kullanıcı (User) referansı

- **Amaç**: Kullanıcı seçimi (search)
- **Kaynak tablo**: `dbo.User` ✅
- **Liste ekranı için minimum kolonlar**:
  - `dbo.User.Id` ✅
  - `dbo.User.Name` ✅ (UI “görünen ad”)
  - `dbo.User.Email` ✅ (opsiyonel)
  - `dbo.User.Deleted` ✅ (opsiyonel filtre)
  - `dbo.User.Blocked` ✅ (opsiyonel filtre)
- **Rol/etki hesaplaması için faydalı flag’ler (operasyonel)**:
  - `dbo.User.Admin` ✅
  - `dbo.User.ApiUser` ✅
  - `dbo.User.ClientUser` ✅
  - `dbo.User.Contractor` ✅
  - `dbo.User.ManagerOfAllTeams` ✅
- **Scope ile ilişkili olabilecek kolonlar (not)**:
  - `dbo.User.SubscriptionId` ✅ (tenant/abonelik benzeri)
  - `dbo.User.ClientGroupId` ✅
  - `dbo.User.DistributorGroupId` ✅

**Notlar:**
- `dbo.User` içinde ayrı bir `UserName/Login` kolonu görünmüyor; login “Name” üzerinden mi yapılıyor, yoksa uygulama seviyesinde başka tablo mu var → ileride netleştirilecek.
- Hassas kolonlar: `Password`, `ApiKey`, `Phone`, `MobilePhone`, `Address` vb. (admin panelde varsayılan olarak göstermeyelim; masking listesine aday).

### 3.2 Client referansı ✅ (DB doğrulandı)

- **Kaynak tablo**: `dbo.Client`
- **Amaç**: Client scope seçimi + admin dropdown

**Liste / dropdown için minimum kolonlar:**
- `Id` (bigint)
- `Name` (varchar)
- `Code` (varchar) — arama/etiket için faydalı
- `Deleted` (bit)
- `Passive` (bit)
- `Archived` (bit)

**Scope / tenant için kritik kolonlar:**
- `SubscriptionId` (bigint) → Company (`dbo.Subscription`) ile hizalı ✅
- `CountryId` (bigint) → Country scope (Sprint 2) ✅
- `ClientGroupId` (bigint)
- `TeamId` (bigint)
- `CustomerRepresentativeUserId` (bigint) — saha temsilcisi filtresi (Kişi 3)
- `DefaultUserId` (bigint)

**Konum (string — ID yok):**
- `City` (varchar)
- `State` (varchar)
- `Address`, `ZipCode` (varchar)

**Sprint 2 — bölge/il/ilçe:**
- `dbo.Client` içinde `RegionId` / `CityId` / `DistrictId` **yok** (DB doğrulandı).
- Seçenekler: `CountryId` ile country scope; il/ilçe için `City`/`State` string eşleme veya başka join tablosu araştırması.

**MVP client dropdown sorgu kuralı (öneri):**
- Dön: `Id`, `Name`, `Code`, `SubscriptionId`
- Filtre: `Deleted = 0` (iş kuralına göre `Passive = 0`, `Archived = 0` eklenebilir)

**Hassas kolonlar (masking adayı):** `Email`, `Phone`, `Address`, `ZipCode`, `WebAddress`, `StripeCustomerId`

### 3.3 Company referansı

- **Amaç**: Company scope seçimi
- **Beklenen**: `Company.Id`, `Company.Name`
- **DB’de bulunan aday tablolar (✅)**:
  - `dbo.Subscription` ✅
  - `dbo.TestingCompany` ✅
  - (ilişkili) `dbo.CorporateIdentity` ✅
  - (ilişkili) `dbo.SubscriptionPlan*` ✅
  - (ilişkili) `dbo.IndustrySubscriptionConfiguration` ✅
  - (ilişkili) `dbo.SubscriptionTransition` ✅

**Not:** Admin panelde “Company” olarak hangi tabloyu kullanacağımızı `dbo.User.SubscriptionId` ve `dbo.Client.SubscriptionId` ile tutarlı olacak şekilde seçeceğiz. Bu yüzden `dbo.Subscription` ve `dbo.TestingCompany` kolonlarını bir sonraki adımda kontrol edeceğiz.

**Karar (MVP):** Company referansı için ana tablo `dbo.Subscription` kullanılacak ✅

**`dbo.Subscription` kolonları (özet):**
- Liste için gerekli:
  - `Id` (bigint)
  - `CompanyName` (varchar)
  - `Deleted` (bit)
  - `Blocked` (bit)
- Scope/ilişki için kritik:
  - `UserId` (bigint)
  - `SubscriptionPlanId` (bigint)
- Hassas/ek alanlar (admin listede göstermeyelim):
  - `ApiKey`, `PaymentKey`, `ExternalMessageAuthToken`, `StripeCustomerId`, `StripeAccountId`, `Phone` vb.

**MVP company dropdown sorgu kuralı (öneri):**
- `Id`, `CompanyName` alanlarını dön
- Filtre: `Deleted = 0`
- Opsiyonel: `Blocked = 0` (iş kuralına göre)

### 3.4 Brand referansı

- **Amaç**: Brand scope seçimi
- **Beklenen**: `Brand.Id`, `Brand.Name`
- **DB’de bulunan tablolar (✅)**:
  - `dbo.Brand` ✅ (ana aday)
  - `dbo.SubBrand` ✅ (alt marka olabilir)
  - (ilişkili) `dbo.ClientBrand` ✅
  - (ilişkili) `dbo.UserBrand` ✅

**`dbo.Brand` kolonları (✅)**:
- `Id` (bigint)
- `Name` (varchar)
- `SubscriptionId` (bigint)
- `Deleted` (bit)
- (audit) `CreateTime`, `UpdateTime`, `UpdatedBy`

**Not:** MVP brand dropdown:
- `Id`, `Name`
- Filtre (opsiyonel): `Deleted = 0`
- Eğer tenant/company scope da olacaksa, `SubscriptionId` üzerinden `dbo.Subscription` ile ilişkilendirilebilir.

### 3.5 Country/Region/City/District referansı (Sprint 2 scope)

Bu sözlük tabloları `src/catalog/client-domain.json` içinde var:

- `dbo.Country`: `Id`, `Name`
- `dbo.Region`: `Id`, `Name`, `SubscriptionId`
- `dbo.City`: `Id`, `Name`, `SubscriptionId`
- `dbo.District`: `Id`, `Name`, `CityId`

> Önemli: `dbo.Client` tarafında bu ID’lerle ilişkiyi kuracak kolon(lar) net değil; DB’den doğrulanacak.

### 3.6 İlişki tabloları (scope bağlantıları) ✅

#### `dbo.ClientBrand` (Client ↔ Brand)
- `Id`, `ClientId`, `BrandId`, `Deleted` (+ audit)
- Ek: `MainCustomerStoreClientCode`, `SupervisorCode` (nvarchar)
- **Anlam:** Bir müşterinin hangi markalara bağlı olduğu

#### `dbo.UserBrand` (User ↔ Brand)
- `Id`, `UserId`, `BrandId`, `Deleted` (+ audit)
- **Anlam:** Kullanıcıya doğrudan marka yetkisi atanabilir

#### `dbo.ClientUser` (Client ↔ User)
- `Id`, `ClientId`, `UserId`, `Deleted` (+ audit)
- **Anlam:** Kullanıcı hangi müşterilere erişebilir (client scope için doğal köprü)

### 3.7 Scope modeli — MVP karar özeti ✅

| Scope boyutu | Admin dropdown kaynağı | Operasyonel filtre (Kişi 3) |
|--------------|------------------------|-----------------------------|
| **Company** | `dbo.Subscription` → `Id`, `CompanyName` | `User.SubscriptionId IN (...)` ve/veya `Client.SubscriptionId IN (...)` |
| **Brand** | `dbo.Brand` → `Id`, `Name` | `BrandId IN (...)` veya `ClientBrand` / `UserBrand` join |
| **Client** | `dbo.Client` → `Id`, `Name`, `Code` ✅ | `ClientId IN (...)` veya `ClientUser` join |

**Tenant hattı:**
- `dbo.User.SubscriptionId` ✅
- `dbo.Client.SubscriptionId` ✅ (DB doğrulandı)
- `dbo.Brand.SubscriptionId` ✅

**RBAC’te saklanacak (UserScope):**
- `AllowedSubscriptionIds` (UI’da “Company”)
- `AllowedBrandIds`
- `AllowedClientIds`

### 3.8 Rol tabloları (operasyonel) ✅ / ⬜

#### `dbo.Role` ✅ (DB doğrulandı)

| Kolon | Tip | Admin panelde kullanım |
|-------|-----|------------------------|
| `Id` | bigint | PK, `UserRole.RoleId` |
| `Name` | varchar | Dropdown etiket |
| `Code` | varchar | Kod / filtre |
| `SubscriptionId` | bigint | **Rol tenant’a bağlı** — company seçilince rol listesi filtrelenmeli |
| `Deleted` | bit | Liste filtresi |
| `DefaultAdmin` | bit | İş kuralı flag (super-admin benzeri aday) |
| `DefaultFieldForce` | bit | Saha rolü adayı |
| `Deleteable`, `Editable` | bit | UI’da rol düzenleme kuralları |
| `Tester`, `WaterUtility`, `TestingCompanyAdmin` | bit | Domain-specific roller |

**MVP rol dropdown sorgu kuralı (öneri):**
- `Id`, `Name`, `Code`, `SubscriptionId`
- `WHERE Deleted = 0`
- İsteğe bağlı: `AND SubscriptionId = @selectedCompanyId`

**Not:** `RoleModule` — MVP’de **kullanılmıyor** (ana uygulama modül yetkisi; chatbot intent değil).

#### `dbo.UserRole` ✅ (DB doğrulandı)

| Kolon | Tip | Kullanım |
|-------|-----|----------|
| `Id` | bigint | PK |
| `UserId` | bigint | Kullanıcı |
| `RoleId` | bigint | `dbo.Role.Id` |
| `Deleted` | bit | Soft delete — liste/join’de `Deleted = 0` |
| `CreateTime`, `UpdateTime`, `UpdatedBy` | audit | |

**Admin panel işlemleri:**
- Okuma: `SELECT RoleId FROM dbo.UserRole WHERE UserId = @userId AND Deleted = 0`
- Atama: insert veya soft-delete + yeniden ekleme (iş kuralına göre)

**Karar:** Kullanıcıya rol atama = mevcut `dbo.UserRole`; chatbot intent izni = **yeni** tablo (`ChatbotRolePermission`).

---

## 4) RBAC tabloları (eklenecek) — önerilen şema (taslak)

> **Operasyonel:** `dbo.Role`, `dbo.UserRole` zaten var — tekrar oluşturulmaz.  
> **Yeni:** intent/scope/mask/audit tabloları.

- ~~`RbacRole`~~ → kullanma; `dbo.Role` ✅
- ~~`RbacUserRole`~~ → kullanma; `dbo.UserRole` ✅
- `ChatbotRolePermission` veya `RbacRolePermission(RoleId, Intent, CreatedAt)` — **yeni**
- `RbacUserScope(UserId, AllowedCompanyIdsJson, AllowedBrandIdsJson, AllowedClientIdsJson, ... )`
- `RbacColumnMask(RoleId?, UserId?, TableName, ColumnName, MaskType, CreatedAt)`
- `RbacAuditLog(Id, CreatedAt, ActorUserId, Action, TargetType, TargetId, BeforeJson, AfterJson)`

---

## 5) API bağlama noktaları (Kişi 1 açısından)

Admin UI şu endpoint’lere bağlanacak (Kişi 2 implement):

- `GET /api/admin/catalog`
- `GET/PUT /api/admin/roles/:id/permissions`
- `GET /api/admin/users` (search)
- `PUT /api/admin/users/:id/roles`
- `GET/PUT /api/admin/users/:id/scopes`
- `GET /api/admin/users/:id/effective-permissions` (önizleme)
- `GET /api/admin/audit-logs`

---

## 6) Toplama planı (kolonları netleştirme)

| Adım | Konu | Durum |
|------|------|--------|
| 1 | `dbo.User` kolonları | ✅ |
| 2 | Company aday tabloları + `dbo.Subscription` | ✅ |
| 3 | `dbo.Brand` kolonları | ✅ |
| 4 | `ClientBrand`, `UserBrand`, `ClientUser` | ✅ |
| 5 | `dbo.Client` kolonları (DB’den) | ✅ |
| 6 | `dbo.Role` kolonları | ✅ |
| 7 | `dbo.UserRole` kolonları | ✅ |
| 8 | Country/Region/City/District + admin scope UI | ✅ |
| 9 | Yeni tablolar (intent permission, user scope, audit) + admin API | ✅ `docs/sql/admin-rbac-tables.sql` |
| 10 | Admin UI geliştirme | ✅ LIVE API (`USE_MOCK=false`) |

