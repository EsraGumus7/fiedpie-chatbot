# Saha Operasyonlari DB Chatbot (MVP)

Bu proje, `dbo.Visit` ve `dbo.DynamicData` tablolarini backend tarafinda kuralli SQL ile sorgulayip, basit chat arayuzunden cevap dondurur.

## Ozellikler

- SQL Server baglantisi (`mssql`)
- Intent tabanli guvenli sorgu secimi
- `/api/chat/query` dogal dil endpointi
- Basit web chat ekrani
- Opsiyonel Gemini ile cevap metni ozetleme

## Kurulum

1. Paketleri yukleyin:

```bash
npm install
```

2. `.env` dosyasini olusturun:

```bash
copy .env.example .env
```

3. `.env` icine veritabani bilgilerinizi girin.

## Calistirma

```bash
npm run dev
```

Ardindan:

- UI: `http://localhost:3000`
- Health: `http://localhost:3000/api/health`

## Temel Endpointler

- `POST /api/chat/query`
- `GET /api/visit/count`
- `GET /api/visit/duration/avg`
- `GET /api/visit/by-state`
- `GET /api/dynamic-data/field-summary?fieldName=Raf`

## Notlar

- Hesaplama mantigi backenddedir; LLM sadece opsiyonel metin duzenlemesi icindir.
- Uretimde read-only DB kullanicisi ile calisin.
