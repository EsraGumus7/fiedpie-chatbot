# Chatbot Hiyerarşi ve Yetki Spec

> **Amaç:** FieldPie chatbot’ta tüm tenant’lar (1056+ şirket) ve tüm kullanıcılar için tutarlı, katmanlı veri erişimi.  
> **DB:** `WorkForce_Prod`  
> **Keşif notları:** [napco-hiyerarsi-kesif.md](./napco-hiyerarsi-kesif.md)  
> **Durum:** Spec güncellendi (kapsamlı intent paketleri) — **henüz kod yok**

---

## 1. Temel prensipler

### 1.1 Multi-tenant

- Her kullanıcının tek `SubscriptionId` (şirket) vardır.
- Kural **evrensel**; veri **şirket içinde** kalır.
- SQL’de her zaman: `Visit.SubscriptionId = user.subscriptionId` (veya eşdeğeri).

### 1.2 Rol ismine güvenme

| Yapma | Yap |
|--------|-----|
| `Role.Name = 'Team Leader'` eşlemesi | `UserTeam.Manager`, takım sayısı, `User.Admin` |
| Şirketten şirkete isim listesi | `Role.DefaultAdmin`, `Role.DefaultFieldForce` flag’leri |
| Intent için global isim sözlüğü | `AiRolePermission(RoleId, intent)` — admin panel |

**Gerekçe:** 1056 aktif şirket; rol isimleri yüzlerce varyant (Merchandiser, Saha Personeli, TAKIM LİDERİ, …).

### 1.3 İki ayrı katman

| Katman | Soru | Mekanizma |
|--------|------|-----------|
| **Intent** | Bu soruyu sorabilir mi? | Rol intent + kullanıcı intent + flag varsayılanları |
| **Scope** | Hangi satırları görebilir? | Hiyerarşi → `allowedUserIds` (+ opsiyonel country/brand) |

Intent **açık** olsa bile scope dar olabilir. Scope **geniş** olsa bile intent yoksa soru reddedilir.

---

## 2. Hiyerarşi seviyeleri (Scope)

### 2.1 Seviye tanımları

| Seviye | Ad | Kim | `allowedUserIds` |
|--------|-----|-----|------------------|
| **1** | SELF | Saha / normal kullanıcı | `{ userId }` |
| **2** | TEAM | Tek takım yöneticisi | `{ userId } ∪ üyeler(yönetilen tek takım)` |
| **3** | MULTI_TEAM | 2+ takım yöneticisi | `{ userId } ∪ üyeler(tüm yönetilen takımlar)` |
| **4** | COMPANY | Admin / tüm takımlar | Tenant geneli (kontrollü; aşağıya bak) |

### 2.2 Seviye hesaplama (pseudocode)

```
function resolveHierarchyLevel(user, userTeams, roles):
  if user.Admin == 1 OR user.ManagerOfAllTeams == 1:
    return 4
  if any role has DefaultAdmin == 1:
    return 4

  managedTeamIds = teams where userTeams.Manager == 1
  if managedTeamIds.count > 1:
    return 3
  if managedTeamIds.count == 1:
    return 2
  return 1
```

**Kaynak tablolar:** `dbo.[User]`, `dbo.UserTeam`, `dbo.Role` (sadece flag için).

**Kullanılmaz:** `Role.Name`, `Team.Name`, ayrı org-chart tablosu (DB’de yok).

### 2.3 `allowedUserIds` üretimi

```
function buildAllowedUserIds(userId, level, managedTeamIds):
  ids = [userId]

  if level >= 2:
    ids += distinct UserTeam.UserId
           where TeamId IN managedTeamIds AND Deleted = 0

  if level == 4:
    // Seçenek A (MVP): tüm aktif UserId in SubscriptionId
    // Seçenek B (daha güvenli): ManagerOfAllTeams veya explicit admin list
    // ONAY: MVP için Seçenek A + isAdmin audit log

  return distinct(ids)
```

**NAPCO 1238 doğrulama (2026-06-05):**

| Seviye | Kişi sayısı |
|--------|-------------|
| 1 | 411 |
| 2 | 42 |
| 3 | 12 |
| 4 | 8 |

### 2.4 Co-manager gerçeği

- Aynı takımda birden fazla `UserTeam.Manager = 1` olabilir.
- Hepsi aynı `allowedUserIds` kümesine yakın erişir — DB gerçeği, bug değil.
- Seviye 3: Ali Samir (20 takım), Amer Haffar (5 takım) — [napco-hiyerarsi-kesif.md](./napco-hiyerarsi-kesif.md).

### 2.5 Seviye 4 (Admin) — onay gerektiren nokta

| Seçenek | Davranış | Risk |
|---------|----------|------|
| **A** | Subscription içi tüm kullanıcılar | Geniş; audit gerekli |
| **B** | Sadece `ManagerOfAllTeams=1` → tüm takım üyeleri birleşimi | Orta |
| **C** | Admin intent `*` ama scope hâlâ team-based | Dar |

**Onaylanan karar:** Seviye 4 = **Seçenek A (lite)** — `User.Admin OR ManagerOfAllTeams OR DefaultAdmin rol` → **aynı subscription içindeki** tüm kullanıcılar; cross-tenant yok. Intent tarafında admin paketi `*` (tam katalog).

### 2.6 Hibrit kullanici (admin + takim lideri)

Ornek: Jon Snow (`Admin=1` + Stark takim lideri).

| Profil | Scope | Varsayilan chat ozeti |
|--------|-------|------------------------|
| **operational** | Yonetilen takim(lar) | Evet — birincil |
| **company** | Subscription geneli | Ozet sorularda **ikisi birden** |

- Ozet/sayim intent'lerinde (`visitCountRealized`, siparis, client count, …) **dual response**
- Soruda `takim` / `ekip` → sadece operational
- Soruda `sirket` / `genel` → sadece company
- Dagilim/trend sorularinda tek scope veya netlestirme

**Onaylandi:** 2026-06 — dual KPI cevap modeli.

---

## 3. Intent yetkileri (Role.Name bağımsız)

### 3.1 Öncelik sırası (merge)

1. Kullanıcı intent — `dbo.AiUserPermission` + `data/admin-user-permissions.json` (geçiş)
2. Rol intent — `dbo.AiRolePermission` (**RoleId**, isim değil)
3. Flag varsayılan paketi (rol atanmış ama AiRolePermission boşsa)

### 3.2 Intent katalogu (4 domain — visit-only değil)

Kaynak: `src/planner/metricRegistry.js` → `visit`, `client`, `sales`, `users` intent dosyaları.

| Domain | Intent dosyası | Adet | Örnek sorular |
|--------|----------------|------|---------------|
| **visit** | `visit.intents.json` | 7 | Gerçekleşen ziyaret, süre, trend, dinamik alan |
| **client** | `client.intents.json` | 24 | Müşteri sayısı, distribütör, tüketici, veri değişikliği |
| **sales** | `sales.intents.json` | 27 | Sipariş, fatura, ödeme, kampanya, komisyon |
| **users** | `users.intents.json` | 12 | Kullanıcı sayısı, rol/takım dağılımı, login, ziyaret özeti |
| **Toplam** | — | **70** | — |

**Prensip:** Varsayılan paketler **domain bazlı** tanımlanır (`domain:visit` = o domain’deki tüm intent’ler). Implementasyonda paket → intent listesi `metricRegistry.listIntentDefinitions()` ile üretilir; elle isim listesi tutulmaz.

### 3.3 Flag varsayılan intent paketleri (kapsamlı)

Hiyerarşi seviyesi **scope** belirler; aşağıdaki tablo **hangi soru tiplerinin** açık olduğunu belirler. İkisi birlikte çalışır.

| Koşul | Seviye | Varsayılan intent paketi |
|-------|--------|--------------------------|
| `DefaultAdmin` veya `User.Admin` veya `ManagerOfAllTeams` | 4 | `*` — katalogdaki **70 intent** |
| `UserTeam.Manager = 1`, yönetilen takım = 1 | 2 | **PKG_MANAGER** (aşağı) |
| `UserTeam.Manager = 1`, yönetilen takım ≥ 2 | 3 | **PKG_MANAGER** (aynı intent; scope daha geniş) |
| `DefaultFieldForce` veya seviye 1 (manager değil) | 1 | **PKG_FIELD** (aşağı) |
| Rol atanmış, flag yok, AiRolePermission boş | — | `[]` — admin panelden **RoleId** ile atanır |

#### PKG_FIELD — saha / seviye 1 (~47 intent)

| Domain | Kapsam | Gerekçe |
|--------|--------|---------|
| `domain:visit` | **Tam** (7) | Günlük saha operasyonu |
| `domain:client` | **Tam** (24) | Müşteri / distribütör / tüketici görünürlüğü |
| `domain:sales` | **Operasyon alt kümesi** (15) | Sipariş, kampanya, takip — finans/ödeme hariç |
| `domain:users` | **Kişisel** (1) | `userVisitSummary` |

**PKG_FIELD — `domain:sales` dahil intent’ler (15):**

`totalPurchaseOrders`, `totalPurchaseOrderAmount`, `purchaseOrdersByStatus`, `purchaseOrderTrend`, `totalPurchaseOrderDetails`, `activeCampaigns`, `totalCampaigns`, `totalCampaignProducts`, `totalClientProductPrices`, `totalCosts`, `costsByCategory`, `totalCommissions`, `totalTrackedOrders`, `totalBipPromotions`, `totalDistributorCommercials`

**PKG_FIELD — sales hariç tutulan (finans / tenant-wide):**

`totalInvoices`, `totalInvoiceAmount`, `totalInvoiceBalance`, `invoicesByStatus`, `invoiceTrend`, `totalInvoiceDetails`, `totalInvoicePayments`, `invoicePaymentTrend`, `totalPayments`, `paymentsByState`, `totalIyzicoTransactions`, `iyzicoTransactionsByStatus`

#### PKG_MANAGER — takım / çok takım yönetici (~65 intent)

| Domain | Kapsam |
|--------|--------|
| `domain:visit` | Tam (7) |
| `domain:client` | Tam (24) |
| `domain:sales` | Tam (27) |
| `domain:users` | **Takım analitiği** (7) — tenant admin intent’leri hariç |

**PKG_MANAGER — `domain:users` dahil:**

`userVisitSummary`, `usersByTeam`, `userStatusSummary`, `userStepSummary`, `userDeviceSummary`, `userSavedViewSummary`, `userLoginSuccessSummary`

**PKG_MANAGER — users hariç (şirket geneli / hassas):**

`userTotalCount`, `userAdminSummary`, `usersByRole`, `usersByBrand`, `usersByClient`, `userRecentLogins`

#### PKG_ADMIN — seviye 4

`*` — tüm katalog + ileride eklenecek yeni intent’ler (registry’den).

**Not:** `AiRolePermission(RoleId)` veya kullanıcı bazlı intent ataması paketi **genişletebilir**, daraltamaz (mevcut merge kuralı korunur).

### 3.4 Hassas intent sınıfları (scope guard ile uyum)

Bazı intent’ler SQL’de henüz `allowedUserIds` ile filtrelenmiyor (`sqlScopeBuilder` şu an yalnızca `dbo.Visit`). Paket ataması **açık** olsa bile implementasyon fazında:

| Sınıf | Intent örnekleri | Scope beklentisi |
|-------|------------------|------------------|
| **tenant_user** | visit.*, sales.* (UserId/ClientId join) | `allowedUserIds` veya client ataması |
| **tenant_aggregate** | `userTotalCount`, `usersByRole`, client count | Seviye 4 veya explicit rol intent |
| **financial** | invoice/payment/iyzico | PKG_FIELD dışı; manager+ |

F4 (intent paketleri) ile **F3b** (client/sales/users SQL scope) birlikte planlanmalı; aksi halde intent açık ama SQL tenant-geneli dönebilir.

### 3.5 Admin panel

| Ekran | Bağlantı |
|-------|----------|
| Rol Yetkileri | Company → **RoleId** → intent checkbox |
| Kullanıcı Yetkileri | UserId → rol + **direkt intent** + (ileride) takım override |

Rol **görünen adı** sadece UI etiketi; backend **RoleId** kullanır.

---

## 4. Scope SQL (tüm domain’ler)

### 4.1 Birincil filtre: `allowedUserIds`

Hiyerarşi her seviyede **dolu** bir liste üretir (seviye 1 bile `{ self }`).

| Domain | Birincil SQL bağlantısı | Durum |
|--------|-------------------------|--------|
| **visit** | `Visit.UserId IN (allowedUserIds)` | `sqlScopeBuilder.js` — mevcut |
| **client** | `Client` ↔ ziyaret/sipariş kullanıcısı veya `Client.TeamId` / atanan müşteri | F3b — eklenecek |
| **sales** | Sipariş/fatura tablolarında `UserId` / `ClientId` + tenant | F3b — eklenecek |
| **users** | `User.Id IN (allowedUserIds)` (aggregate intent’ler seviye 4) | F3b — eklenecek |

**Team scope (AiUserScope / admin checkbox) hiyerarşinin yerine geçmemeli.**

Mevcut sorun: Admin’den `allowedTeamIds` atanunca `UserId` filtresi devre dışı kalabiliyor → **F3 düzeltmesi**.

### 4.2 İkincil filtre (opsiyonel)

| Scope | SQL | Ne zaman |
|-------|-----|----------|
| Country | `Client.CountryId IN (...)` | Admin atamışsa |
| Brand | `Visit.BrandId` / `ClientBrand` | Admin atamışsa |
| Company | `*.SubscriptionId` | Zaten tenant |

Hiyerarşi **UserId listesi** üretir; country/brand **daraltır**, genişletmez.

### 4.3 Team scope SQL (revize — visit)

Takım filtresi yalnızca legacy/opsiyonel; hiyerarşi birincil:

- `Visit.UserId IN (allowedUserIds)` ← **birincil**
- Alternatif OR: `Client.TeamId IN (...)` / `UserTeam` — checkbox kaldırılınca devre dışı

### 4.4 Scope plan motoru (`resolveScopePlan`) — ONAYLI 2026-06

Inheritance (Saha → Lider → Admin sınıf hiyerarşisi) **kullanılmaz**. Her chat sorusu üç eksende çözülür:

| Eksen | Soru | Çözüm yeri |
|-------|------|------------|
| **NE** | Hangi metrik? | Intent kataloğu (`visit`, `client`, `sales`, `users`) |
| **KİM** | Hangi takım / şirket scope? | `resolveScopePlan(userContext, question)` |
| **NASIL** | Tarih, durum, limit… | `parseQuestionFilters(question)` → intent params |

**Çıktı (`scopePlan`):**

```text
{
  mode: "self" | "single_team" | "multi_team" | "company" | "dual" | "denied",

  teamIds: number[],           // single veya multi için
  allowedUserIds: number[],    // SQL birincil filtre
  display: "single" | "breakdown" | "dual" | "message",
  denyReason?: string
}
```

**Soru ipucu parser (KİM ekseni):**

| İpucu | Algılama |
|-------|----------|
| Takım adı / kısmi isim | `managedTeams` içinde fuzzy eşleşme → `single_team` |
| `takım`, `ekip` (şirket yok) | operational — L3’te breakdown değil birleşik operational |
| `şirket`, `genel`, `tüm` | `company` — yalnızca `companyCapable` |
| İpucu yok | Varsayılan (seviye tablosu) |

Türkçe karakter normalizasyonu zorunlu (`şirket` → `sirket`).

---

#### 4.4.1 Varsayılan scope modu (soru ipucu yok)

| Seviye | Koşul | Varsayılan `mode` | Cevap `display` |
|--------|-------|-------------------|-----------------|
| L1 | — | `self` | `single` |
| L2 | 1 yönetilen takım | `single_team` (birleşik ekip) | `single` |
| L3 | 2+ yönetilen takım | `multi_team` (KPI + dağılım intent'leri) | `breakdown` + toplam |
| L4 | admin, takım yok | `self` / `company` scope* | `single` (şirket toplamı) |
| Hibrit | admin + ≥1 takım | `dual` | `dual` (operational + company) |

---

#### 4.4.2 Soru ipucu × seviye (özet karar tablosu)

**A) Sayım / KPI intent’leri** (`visitCountRealized`, `totalPurchaseOrders`, `clientCountActive`, `userTotalCount`, …)

| Seviye | Genel soru (“ziyaret sayısı”) | Tek takım adı (“Rodolfo takımı ziyaret”) | `şirket` / `genel` |
|--------|--------------------------------|------------------------------------------|---------------------|
| L1 | `self` / single | Takım adı yok sayılır veya red | `denied` |
| L2 | `single_team` / single | `single_team` / single | `company` if capable else `denied` |
| L3 | `multi_team` / breakdown+toplam | `single_team` / single | `denied` (saf L3) |
| L4 | `self` / single (şirket toplamı) | `single_team` + üye kırılımı* | `company` / single |
| L4 (ek) | `multi_team` yalnızca **takım bazında** ipucu ile** | — | — |
| Hibrit | `dual` | `single_team` / single (+ şirket istenirse ayrı soru) | operational veya `dual` |

\* L4 + takım adı: subscription içi o takımın üyeleri (`UserTeam`), liderlik şart değil — **onaylı (2026-06, F8b)**.

\*\* L4 + takım bazında: `takim bazinda`, `takimlara gore`, `her takim`, `tum takimlar`, `ekip ekip` → `multi_team` + `scopeSource: subscription` — **onaylı (2026-06, F8c)**. Genel soru (`ziyaret sayısı`) tek şirket toplamı kalır.

**B) Dağılım / trend intent’leri** (`visitsByState`, `visitTrend`, `usersByTeam`, `purchaseOrdersByStatus`, …)

| Seviye | Genel soru | Tek takım adı | `şirket` |
|--------|------------|---------------|----------|
| L1 | `self` / grafik | red veya self | denied |
| L2 | `single_team` / birleşik grafik | `single_team` / grafik | company if capable |
| L3 | **`multi_team` / breakdown + toplam** (KPI ile aynı kural) | `single_team` | denied |
| L4 | `company` | `single_team`* | `company` |
| Hibrit | operational birleşik | `single_team` | `dual` veya denied |

**Onay (2026-06):** L3’te dağılım intent’leri (ör. `visitsByCompletionStatus`) birleşik tek grafik yerine **5 takım + toplam** döner; intent türüne göre scope ayrımı kaldırıldı.

**C) Liste intent’leri** (`userVisitSummary`, `userRecentLogins`, …)

| Seviye | Genel | Tek takım | Şirket |
|--------|-------|-----------|--------|
| L1 | kendi listesi | red | denied |
| L2–L3 | birleşik operational liste | o takım listesi | denied (L3) / company (L4) |
| L4 | tenant listesi (limit) | takım listesi | company listesi |

---

#### 4.4.3 Filtre ekseni (NE ZAMAN / DURUM) — intent params

Tüm domain’lerde ortak param modeli; intent başına inherit değil **paylaşılan filter**:

| Param | Soru örnekleri | Etki |
|-------|----------------|------|
| `startDate`, `endDate` | bugün, dün, bu hafta, bu ay | template tarih bind |
| `realized` | tamamlanan, gerçekleşen → `1`; bekleyen, planlanan → `0` | Visit |
| `teamId` | takım adından çözülür | scopePlan + SQL |
| `limit` | ilk 10, son kayıtlar | liste intent’leri |

**Onay:** MVP’de “bekleyen ziyaret” = `Realized = 0`; visit state ayrı intent ile sonra.

---

#### 4.4.4 Cevap renderer (`display` × intent kind)

| `display` | Sayım intent | Dağılım intent | Liste intent |
|-----------|--------------|----------------|--------------|
| `single` | 1 KPI kartı | 1 grafik | tablo |
| `breakdown` | N takım KPI + toplam | N grafik veya tek grafik (intent) | N tablo / gruplu |
| `dual` | 2 KPI (operational + company) | — | — |
| `message` | yetki / netleştirme metni | aynı | aynı |

---

#### 4.4.5 Implementasyon fazları (scope plan)

| Faz | İş | Not |
|-----|-----|-----|
| **F7a** | `resolveScopePlan` + soru ipucu parser | `scopeContextService.js` — mevcut dual/multi birleştir |
| **F7b** | Ortak `parseQuestionFilters` (tarih, realized, teamId) | `metricResolver` / chat route |
| **F7c** | Template’ler param-aware (visit → sales → client) | `queryTemplates.js` |
| **F7d** | Cevap renderer tek giriş | `api.js`, `index.html` |

**Mevcut durum (2026-06):** F7a–F7d **tamamlandi** — `resolveScopePlan`, `parseQuestionFilters`, param-aware visit template, `renderScopeAnswer` + UI `scopePlan.display`.

---

#### 4.4.6 L4 scope (F8 — 2026-06, tamamlandi)

Saf L4 admin (`isPureCompanyScopeUser`: `companyCapable`, yönetilen takım yok, hibrit değil):

| Adım | Is | Dosya | Tetikleyici |
|------|-----|-------|-------------|
| **F8a** | Subscription takım listesi | `hierarchyService.getSubscriptionTeams` | Login / `getEffectivePermissions` |
| **F8b** | Takım adı → `single_team` + üye kırılımı | `resolveScopeTeams`, `detectTeamFromQuestion` | `CP REMOTE-Ahmed ziyaret sayisi` |
| **F8c** | Takım bazında → N takım + şirket toplamı | `detectTeamBreakdownFromQuestion`, `multi_team` | `takim bazinda ziyaret sayisi` |
| **F8d** | UI etiketleri + testler | `index.html`, `scripts/test-l4-scope.js` | KPI: `Sirket geneli — …`; 15 takım limiti |

**Test:** `node scripts/test-l4-scope.js` (Mireille #12942). **Help popup:** `?` → L4 örnek sorular (`role-sample-questions.json`).

**Yol haritasi:** `docs/scope-toolbar-roadmap.md` (F9a–F9h)

---

## 5. Runtime akış

```
Login → JWT (userId, subscriptionId)
  ↓
getEffectivePermissions(userId)
  ↓
buildUserContext (operasyonel)
  ↓
resolveHierarchyLevel → level, managedTeamIds
  ↓
buildAllowedUserIds → allowedUserIds
  ↓
resolveScopePlan(userContext, question, intentKind) → scopePlan
  ↓
parseQuestionFilters(question, managedTeams) → params (tarih, teamId, realized, …)
  ↓
merge role intents + user intents + flag defaults
  ↓
(optional) merge AiUserScope country/brand — L2+ takım liderinde SQL’e uygulanmaz
  ↓
Chat query → scopePlan.mode’a göre execute (single | multi | dual | denied)
  ↓
SQL: SubscriptionId + UserId IN (scopePlan.allowedUserIds) + params
```

---

## 6. Admin panel davranışı (hedef)

| Şimdi | Hedef |
|-------|--------|
| Kullanıcı seçilince scope DB’den yazılıyor | Hiyerarşi **otomatik**; panel sadece **intent + opsiyonel country/brand** |
| Team checkbox zorunlu gibi | Team checkbox **kaldır** → hiyerarşi **salt okunur önizleme** |
| Scope boş → 0 sonuç riski | `allowedUserIds` her zaman dolu (seviye 1 bile `{self}`) |
| Intent: yalnızca `visitCountRealized` | **PKG_FIELD / PKG_MANAGER / `*`** — Bölüm 3.3 |

**Onaylanan karar:** Admin UI sadeleştirmesi (scope otomatik, intent + opsiyonel country/brand).

---

## 7. Test matrisi (implementasyon sonrası)

### 7.1 Tenant’lar

| SubscriptionId | Company | Neden |
|----------------|---------|--------|
| 1238 | NAPCO - Main Account | Keşif yapıldı |
| 1515 | Intern Demo (Bran) | Farklı tenant |
| *(opsiyonel)* | Top userCount şirket | Ölçek |

### 7.2 Persona’lar

| Persona | Beklenen seviye | Beklenen scope |
|---------|-----------------|----------------|
| Merchandiser (saha) | 1 | Sadece kendi ziyareti |
| Team Leader, 1 takım | 2 | Kendi + ekip |
| Amer / Ali tipi | 3 | Kendi + çok takım üyeleri |
| Admin | 4 | Subscription geneli (onaylı model) |

### 7.3 Senaryolar — scope (visit + client + sales + users)

- [ ] **L1 saha:** kendi ziyaret sayısı + kendi müşteri/portföyü + PKG_FIELD sales — başka kullanıcının verisi yok
- [ ] **L1 saha:** `userTotalCount` / fatura intent’leri → denied (PKG_FIELD dışı)
- [ ] **L2 takım lideri:** ekip ziyaret toplamı + ekip `usersByTeam` + tam sales paketi
- [ ] **L3 çok takım:** Amer/Ali tipi — birleşik `allowedUserIds` ile client/sales aggregate
- [x] **L4 admin:** `*` intent + subscription geneli scope; başka tenant'ta 0 satır
- [x] **L4 takım adı:** subscription takımı + üye kırılımı (F8b)
- [x] **L4 takım bazında:** explicit ipucu → multi_team breakdown + şirket toplamı (F8c)
- [ ] Intent yok → denied; scope geniş olsa bile
- [ ] **F3b sonrası:** client count sorgusu L1’de yalnızca scope içi müşteri; L4’te tenant geneli

### 7.4 Örnek persona intent beklentisi

| Persona | Paket | Örnek açık soru | Örnek kapalı soru |
|---------|-------|-----------------|-------------------|
| Bran (L1, 1515) | PKG_FIELD | visitCountRealized, clientCountActive, totalPurchaseOrders | totalInvoices, userTotalCount |
| Team leader (L2) | PKG_MANAGER | visitsByType, invoicesByStatus, usersByTeam | userAdminSummary |
| Amer (L3) | PKG_MANAGER | Aynı intent seti, daha geniş scope | — |
| Admin (L4) | `*` | Tüm domain | cross-tenant |

---

## 8. Implementasyon fazları (onay sonrası)

| Faz | İş | Dosyalar (tahmini) |
|-----|-----|---------------------|
| **F1** | `resolveHierarchyLevel`, `buildAllowedUserIds` | `userContextService.js`, `adminPermissionService.js` |
| **F2** | `getEffectivePermissions` merge — hiyerarşi birincil | `adminPermissionService.js` |
| **F3** | Visit SQL scope — UserId birincil, team checkbox devre dışı | `sqlScopeBuilder.js` |
| **F3b** | Client / sales / users template scope (`allowedUserIds`, SubscriptionId) | `queryTemplates.js`, `sqlScopeBuilder.js` veya domain builder |
| **F4** | PKG_FIELD / PKG_MANAGER / `*` — domain paketleri, registry’den genişletme | `adminPermissionService.js`, `data/intent-packages.json` (opsiyonel) |
| **F5** | Admin UI — salt okunur hiyerarşi önizleme, scope checkbox kaldır | `public/admin/app.js` |
| **F6** | Test matrisi (Bölüm 7) — 4 domain | `docs/`, manuel / otomasyon |
| **F7** | Scope plan motoru + filtre params + renderer | Bölüm 4.4 — `scopeContextService.js`, `api.js` |

**Kod yazılmadan önce:** F7 için ayrı **“yaz”** onayı. F1–F5 büyük ölçüde uygulandı.

---

## 9. Karar özeti

| Konu | Karar | Durum |
|------|-------|--------|
| Seviye 4 scope | Seçenek A — subscription içi tüm kullanıcılar | Onaylı |
| Admin panel scope | Otomatik hiyerarşi; team/company checkbox → salt okunur önizleme | Onaylı |
| Intent varsayılanları | **4 domain** — PKG_FIELD / PKG_MANAGER / `*` (visit-only değil) | Onaylı |
| Scope plan modeli | `resolveScopePlan` — NE/KİM/NASIL; inheritance yok | Onaylı 2026-06 |
| 1515 tenant katman SQL | İkinci tenant doğrulama | Opsiyonel / bekliyor |
| Kod (F7) | Scope plan + filtre params | **Bekliyor** — explicit onay |

---

## 10. Referans SQL — katman özeti (tek şirket)

```sql
USE WorkForce_Prod;
GO
DECLARE @SubId BIGINT = 1238; -- veya 1515

WITH UserStats AS (
  SELECT u.Id, u.Admin, u.ManagerOfAllTeams,
    MAX(CASE WHEN ut.Manager = 1 THEN 1 ELSE 0 END) AS isTeamManager,
    COUNT(DISTINCT CASE WHEN ut.Manager = 1 THEN ut.TeamId END) AS managedTeamCount
  FROM dbo.[User] u
  LEFT JOIN dbo.UserTeam ut ON ut.UserId = u.Id AND ut.Deleted = 0
  WHERE u.Deleted = 0 AND u.SubscriptionId = @SubId
  GROUP BY u.Id, u.Admin, u.ManagerOfAllTeams
),
UserKatman AS (
  SELECT Id, CASE
    WHEN Admin = 1 OR ManagerOfAllTeams = 1 THEN 4
    WHEN managedTeamCount > 1 THEN 3
    WHEN isTeamManager = 1 THEN 2
    ELSE 1 END AS katman
  FROM UserStats
)
SELECT katman, COUNT(*) AS kisiSayisi FROM UserKatman GROUP BY katman ORDER BY katman;
```

---

## 11. İlgili dokümanlar

| Dosya | İçerik |
|-------|--------|
| [napco-hiyerarsi-kesif.md](./napco-hiyerarsi-kesif.md) | SQL keşif adımları, NAPCO sayıları |
| [admin-permission-db-haritasi.md](./admin-permission-db-haritasi.md) | Mevcut admin ↔ DB haritası |
| [degisiklik-ozeti.md](./degisiklik-ozeti.md) | Mevcut MVP scope |

---

**Sonraki adım:** F1 implementasyonu için **“yaz”** de; opsiyonel olarak 1515 katman SQL sonucunu `napco-hiyerarsi-kesif.md`’ye ekle.
