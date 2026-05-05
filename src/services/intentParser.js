function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .trim();
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getLastNDaysRange(days) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - days);
  return { startDate: toIsoDate(start), endDate: toIsoDate(today) };
}

function getRelativeDateRange(normalizedQuestion) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/(bugun|today)/.test(normalizedQuestion)) {
    return { startDate: toIsoDate(today), endDate: toIsoDate(today) };
  }

  if (/(dun|yesterday)/.test(normalizedQuestion)) {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return { startDate: toIsoDate(yesterday), endDate: toIsoDate(yesterday) };
  }

  if (/(bu hafta|this week)/.test(normalizedQuestion)) {
    const start = new Date(today);
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    return { startDate: toIsoDate(start), endDate: toIsoDate(today) };
  }

  if (/(gecen hafta|last week)/.test(normalizedQuestion)) {
    const start = new Date(today);
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day - 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }

  if (/(bu ay|this month)/.test(normalizedQuestion)) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { startDate: toIsoDate(start), endDate: toIsoDate(today) };
  }

  if (/(gecen ay|last month)/.test(normalizedQuestion)) {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }

  return null;
}

function resolveFieldName(rawValue = "") {
  const val = normalizeText(rawValue);
  const aliases = [
    { canonical: "Raf Sayisi", patterns: ["raf sayisi", "raf", "raf adet"] },
    { canonical: "Stok", patterns: ["stok", "stock"] },
    { canonical: "Siparis", patterns: ["siparis", "order"] },
    { canonical: "Promosyon", patterns: ["promosyon", "kampanya"] },
  ];

  const hit = aliases.find((item) => item.patterns.some((p) => val.includes(p)));
  return hit ? hit.canonical : rawValue;
}

function parseQuestion(question, filters = {}) {
  const normalized = normalizeText(question);
  const relativeRange = getRelativeDateRange(normalized);
  const baseFilters = {
    startDate: filters.startDate || relativeRange?.startDate || null,
    endDate: filters.endDate || relativeRange?.endDate || null,
  };

  // 1. KULLANICI (USER) MODÜLÜ KONTROLLERİ (Orijinal)
  const isUserQuestion =
    /(kullanici|user|personel|calisan|hesap|login|giris|rol|role|takim|team|cihaz|device|admin|client user|api user|contractor|adim|step|saved view|kayitli gorunum)/.test(
      normalized
    );

  if (isUserQuestion) {
    const limit = filters.limit || 20;

    if (/(rol|role)/.test(normalized)) {
      return { intent: "usersByRole", params: baseFilters };
    }

    if (/(takim|team|ekip|manager|member|yonetici|uye)/.test(normalized)) {
      return { intent: "usersByTeam", params: baseFilters };
    }

    if (/(marka|brand)/.test(normalized)) {
      return { intent: "usersByBrand", params: baseFilters };
    }

    if (/(client|musteri|customer)/.test(normalized)) {
      return { intent: "usersByClient", params: { ...baseFilters, limit } };
    }

    if (/(son giris|recent login|login kaydi|login kayit|giris gecmisi)/.test(normalized)) {
      return { intent: "userRecentLogins", params: { ...baseFilters, limit } };
    }

    if (/(login|giris).*(basari|basarisiz|success|fail)/.test(normalized)) {
      return { intent: "userLoginSuccessSummary", params: baseFilters };
    }

    if (/(cihaz|device|app version|uygulama versiyon)/.test(normalized)) {
      return { intent: "userDeviceSummary", params: baseFilters };
    }

    if (/(kayitli gorunum|saved view|view|filtre|filter)/.test(normalized)) {
      return { intent: "userSavedViewSummary", params: baseFilters };
    }

    if (/(adim|step|hareket)/.test(normalized)) {
      return { intent: "userStepSummary", params: { ...baseFilters, limit } };
    }

    if (/(ziyaret|visit)/.test(normalized)) {
      return { intent: "userVisitSummary", params: { ...baseFilters, limit } };
    }

    if (/(admin|api user|client user|contractor|yonetici)/.test(normalized)) {
      return { intent: "userAdminSummary", params: baseFilters };
    }

    if (/(aktif|pasif|bloke|blocked|silme|delete|durum|status|ozet)/.test(normalized)) {
      return { intent: "userStatusSummary", params: baseFilters };
    }

    return { intent: "userTotalCount", params: baseFilters };
  }

  // 2. SATIŞ VE FİNANS (SALES & FINANCE) MODÜLÜ KONTROLLERİ (Yeni Eklendi)
  const isSalesQuestion = 
    /(siparis|sipariş|fatura|tahsilat|odeme|ödeme|ciro|kampanya|maliyet|gider|komisyon|prim|pos|iyzico)/.test(
      normalized
    );
    
  if (isSalesQuestion) {
    if (/(fatura).*(odenmemis|bakiye|alacak|kalan)/.test(normalized)) return { intent: "totalInvoiceBalance", params: baseFilters };
    if (/(fatura).*(tutar|ciro|hacim)/.test(normalized)) return { intent: "totalInvoiceAmount", params: baseFilters };
    if (/(fatura).*(durum|statu)/.test(normalized)) return { intent: "invoicesByStatus", params: baseFilters };
    if (/(fatura).*(tahsilat|odeme|ödeme)/.test(normalized)) return { intent: "totalInvoicePayments", params: baseFilters };
    if (/(fatura).*(kalem|detay)/.test(normalized)) return { intent: "invoice_detail_count", params: baseFilters };
    if (/(fatura).*(trend|gunluk|aylik)/.test(normalized)) return { intent: "invoiceTrend", params: baseFilters };
    if (/(fatura)/.test(normalized)) return { intent: "totalInvoices", params: baseFilters };

    if (/(siparis|sipariş).*(tutar|ciro|hacim)/.test(normalized)) return { intent: "totalPurchaseOrderAmount", params: baseFilters };
    if (/(siparis|sipariş).*(durum|statu)/.test(normalized)) return { intent: "purchaseOrdersByStatus", params: baseFilters };
    if (/(siparis|sipariş).*(trend|gunluk|aylik)/.test(normalized)) return { intent: "purchaseOrderTrend", params: baseFilters };
    if (/(siparis|sipariş).*(kalem|detay)/.test(normalized)) return { intent: "totalPurchaseOrderDetails", params: baseFilters };
    if (/(siparis|sipariş)/.test(normalized)) return { intent: "totalPurchaseOrders", params: baseFilters };

    if (/(kampanya).*(aktif|guncel)/.test(normalized)) return { intent: "activeCampaigns", params: baseFilters };
    if (/(kampanya).*(urun)/.test(normalized)) return { intent: "totalCampaignProducts", params: baseFilters };
    if (/(kampanya)/.test(normalized)) return { intent: "totalCampaigns", params: baseFilters };

    if (/(maliyet|gider).*(kategori|tur|dagilim)/.test(normalized)) return { intent: "costsByCategory", params: baseFilters };
    if (/(maliyet|gider)/.test(normalized)) return { intent: "totalCosts", params: baseFilters };
    
    if (/(komisyon|prim)/.test(normalized)) return { intent: "totalCommissions", params: baseFilters };
    
    if (/(iyzico|pos).*(durum|statu)/.test(normalized)) return { intent: "iyzicoTransactionsByStatus", params: baseFilters };
    if (/(iyzico|pos)/.test(normalized)) return { intent: "totalIyzicoTransactions", params: baseFilters };
    
    if (/(odeme|ödeme).*(durum|statu)/.test(normalized)) return { intent: "paymentsByState", params: baseFilters };
    if (/(odeme|ödeme|tahsilat).*(trend|gunluk|aylik)/.test(normalized)) return { intent: "invoicePaymentTrend", params: baseFilters };
    if (/(odeme|ödeme|tahsilat)/.test(normalized)) return { intent: "totalPayments", params: baseFilters };

    if (/(fiyat|iskonto|ozel fiyat)/.test(normalized)) return { intent: "totalClientProductPrices", params: baseFilters };
    if (/(takip|kargo|teslimat)/.test(normalized)) return { intent: "totalTrackedOrders", params: baseFilters };
    if (/(bip|promosyon|indirim kodu)/.test(normalized)) return { intent: "totalBipPromotions", params: baseFilters };
    if (/(ticari|risk|limit|teminat)/.test(normalized)) return { intent: "totalDistributorCommercials", params: baseFilters };

    return { intent: "totalPurchaseOrders", params: baseFilters };
  }

  const isClientQuestion = 
    /(musteri|client|distributor|distribütör|bayi|tuketici|rni|donanim)/.test(
      normalized
    );

  if (isClientQuestion) {
    if (/(aktif|calisan)/.test(normalized)) return { intent: "clientCountActive", params: baseFilters };
    if (/(grup|kategori).*(musteri|client)/.test(normalized)) return { intent: "clientsByGroup", params: baseFilters };
    if (/(trend|zaman|gunluk).*(musteri|client)/.test(normalized)) return { intent: "clientTrend", params: baseFilters };
    if (/(bolge|bölge).*(distributor|bayi|distribütör)/.test(normalized)) return { intent: "distributorsByRegion", params: baseFilters };
    if (/(distributor|bayi|distribütör)/.test(normalized)) return { intent: "totalDistributors", params: baseFilters };
    if (/(tuketici)/.test(normalized)) return { intent: "consumerCountTotal", params: baseFilters };
    
    return { intent: "clientCountTotal", params: baseFilters };
  }

  // 4. SAHA OPERASYONLARI (VISIT) MODÜLÜ KONTROLLERİ (Orijinal Fallback)
  if (/(trend|gunluk|zaman|haftalik|aylik|line)/.test(normalized)) {
    return { intent: "visitTrend", params: baseFilters };
  }

  if (/(ortalama|süre|sure|duration)/.test(normalized)) {
    return { intent: "avgVisitDuration", params: baseFilters };
  }

  if (/(durum|state|statü|statu)/.test(normalized)) {
    return { intent: "visitsByState", params: baseFilters };
  }

  if (/(tip|type|ziyaret tipi)/.test(normalized)) {
    return { intent: "visitsByType", params: baseFilters };
  }

  if (/(form|alan|field|dynamic|anket|raf)/.test(normalized)) {
    const match = normalized.match(/["']([^"']+)["']/);
    const fieldIdMatch = normalized.match(/field[-\s]?(\d{3,})/);
    const rawField = match?.[1] || filters.fieldName || "Raf";
    const fieldName = resolveFieldName(rawField);
    const dynamicRange =
      baseFilters.startDate || baseFilters.endDate ? baseFilters : getLastNDaysRange(30);
    return {
      intent: "dynamicFieldSummary",
      params: { ...dynamicRange, fieldName, fieldId: filters.fieldId || fieldIdMatch?.[1] || null },
    };
  }

  return { intent: "visitCountRealized", params: baseFilters };
}

module.exports = { parseQuestion, resolveFieldName };