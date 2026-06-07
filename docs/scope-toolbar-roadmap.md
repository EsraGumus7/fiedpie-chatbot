# Scope Toolbar — Yol Haritası (F9)

> **Karar (2026-06):** Scope soru metninden değil, UI toolbar’dan seçilir. Soru ipucu parser fallback kalır.

## Hedef

Chat üstünde **Takımlar ▼** + **Şirket** butonları; seviyeye göre kilit/açık. Seçime göre tek, tutarlı cevap.

---

## Mod matrisi (özet)

| Kod | UI seçimi | Cevap |
|-----|-----------|--------|
| **L** | Şirket (takım seçimi yok) | Tek şirket özeti |
| **M** | Şirket + 1..N takım seçili | Şirket özeti + N kart + seçili toplam |
| **G** | Takımlar → Tüm takımlar | N kart + şirket/toplam satırı |
| **D** | Takımlar → tek takım | Takım toplamı + üyeler |
| **H** | Takımlar → 2+ takım (şirket kapalı) | N kart + seçili toplam |
| **E/F** | L3 tüm / hibrit tüm yönetilen | N yönetilen kart + Toplam |

Detay: `hiyerarsi-spec.md` §4.5 (eklenecek).

---

## API sözleşmesi

### İstek (`POST /api/chat/query`)

```json
{
  "question": "ziyaret sayisi",
  "filters": {},
  "scopeSelection": {
    "mode": "company" | "teams",
    "teamScope": "all" | "single" | "multi",
    "teamIds": []
  }
}
```

### Toolbar config (`GET /auth/me` → `context.scopeToolbar`)

```json
{
  "operationalLevel": 2,
  "teamsButton": { "enabled": true, "locked": false },
  "companyButton": { "enabled": true, "locked": true },
  "defaultSelection": { "mode": "teams", "teamScope": "single", "teamIds": [1464] },
  "teams": [{ "teamId": 1464, "teamName": "Stark" }],
  "allowMultiTeamSelect": false,
  "maxTeamSelection": 10,
  "badgeLabel": "Kendim"
}
```

---

## Fazlar

### F9a — Spec + selection servisi ✅

| İş | Dosya |
|----|--------|
| `buildScopeToolbarConfig(userContext)` | `scopeSelectionService.js` |
| `normalizeScopeSelection(input, config)` | aynı |
| `resolveScopePlanFromSelection(...)` | aynı |
| `context.scopeToolbar` login sonrası | `userContextService.js` |

**Çıktı:** `/auth/me` toolbar config döner; chat `scopeSelection` ile birincil scope.

---

### F9b — UI toolbar iskeleti ✅

| İş | Dosya |
|----|--------|
| Toolbar HTML/CSS (Takımlar, Şirket, badge) | `index.html` |
| Dropdown: Tüm takımlar + liste + çoklu seçim | aynı |
| Kilit tooltip (L1, L2/L3 şirket) | aynı |
| `scopeSelection` state → chat POST body | aynı |

**Test:** Manuel — Jon / Amer / Mireille / Bran login, buton durumları.

---

### F9c — Backend: selection → scopePlan ✅

| İş | Dosya |
|----|--------|
| `scopeSelection` body parse | `api.js` |
| Selection birincil; soru parser ikincil | `scopeContextService.js` |
| Yeni modlar: `company_team_breakdown` | aynı |

**Kural:** Toolbar gönderildiyse dual scope **kapalı** (tek mod).

---

### F9d — Execute yolları ✅

| Mod | Execute |
|-----|---------|
| L — company | `buildScopedUserContext(company)` |
| D — single team | `single_team` + member breakdown |
| G — all teams | `multi_team` subscription/managed |
| H — multi teams | `multi_team` filtered teamIds |
| M — company + multi | company query + parallel team queries + seçili combined |

| Dosya | `api.js`, `scopeContextService.js` |

---

### F9e — Cevap renderer ✅ (temel)

| İş | Dosya |
|----|--------|
| `display: company_team_breakdown` | `api.js`, `index.html` |
| Chat prefix / formatBotText | `index.html` |
| KPI kartları 3 katman (M modu) | aynı |

---

### F9f — Eski davranış sadeleştirme ✅ (temel)

| İş | Not |
|----|-----|
| Toolbar aktifken dual kapat | hibrit KPI — `scopePlan.source === "toolbar"` |
| Soruda `sirket` / takım adı | toolbar override (soru ikincil) |
| Login hint → toolbar badge | `appendHierarchyLoginHint` kaldırıldı |

---

### F9g — Testler ✅ (temel)

| Script | Kapsam |
|--------|--------|
| `scripts/test-scope-toolbar-config.js` | Config L1–L4, normalize |
| `scripts/test-scope-toolbar-plan.js` | Plan matrix |
| `scripts/test-scope-toolbar.js` | API integration (toolbar modes) |
| Mevcut suite | `test-l4-scope`, `test-hybrid-scope`, `test-f7-scope` regresyon |

Persona’lar: Bran L1, Jon hibrit, Amer L3, Mireille L4.

---

### F9h — Polish

- L4 dropdown arama (46 takım)
- Çoklu seçim üst limiti
- Seçim localStorage (oturum)
- Admin panel salt okunur scope önizleme

---

## Bağımlılık sırası

```
F9a → F9b → F9c → F9d → F9e → F9f → F9g → F9h
         ↑__________________|
              paralel kısmen
```

**MVP (kullanılabilir):** F9a–F9e  
**Tam:** F9f–F9h

---

## Riskler

| Risk | Önlem |
|------|--------|
| L4 46 takım dropdown | arama + lazy load (F9h) |
| company+multi 3 paralel sorgu | concurrency limit (mevcut `mapTeamsWithConcurrency`) |
| Eski soru ipucu ile çakışma | toolbar birincil kural |

---

## Tahmini kapsam

| Faz | Dosya sayısı (tahmini) |
|-----|------------------------|
| F9a | 2–3 |
| F9b | 1 (index.html büyük) |
| F9c–F9d | 3–4 |
| F9e | 2 |
| F9f–F9g | 2–3 |
