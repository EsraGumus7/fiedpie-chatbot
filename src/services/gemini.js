const env = require("../config/env");

async function summarizeWithGemini(payload) {
  if (!env.gemini.apiKey) {
    return null;
  }

  const prompt = `
Kullaniciya veritabani sonucu acikla.
Sadece verilen veriye dayan.
Kisa ve net turkce cevap ver.

Soru: ${payload.question}
Intent: ${payload.intent}
Veri:
${JSON.stringify(payload.data, null, 2)}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.gemini.model}:generateContent?key=${env.gemini.apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const data = await response.json();
  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
    "Sonuc alindi ancak metin olusturulamadi."
  );
}

module.exports = { summarizeWithGemini };
