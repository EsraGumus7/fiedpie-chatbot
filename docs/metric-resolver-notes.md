Metric Resolver Geliştirmesi
Amaç:
Bu geliştirme, chatbot’un kullanıcı sorularını daha doğru intent/query template ile eşleştirmesi için yapılmıştır.

Önceki yapıda /chat/query akışı büyük ölçüde intentParser.js içindeki regex/keyword kontrollerine dayanıyordu. Bu nedenle kullanıcı sorusu beklenen kelimeyi içermediğinde yanlış intent seçilebiliyordu.

Yeni Yapı:
Yeni yapıda metricResolver.js eklendi. Bu resolver, intents/*.json ve metrics/*.json dosyalarındaki bilgileri birlikte kullanarak intent adaylarını skorlar ve en uygun intent’i seçer.

Yeni akış:

Kullanıcı sorusu
→ metricResolver
→ intent adaylarını skorla
→ en uygun intent’i seç
→ queryTemplates.js içindeki güvenli SQL template’i çalıştır

Değiştirilen / Eklenen Dosyalar
src/services/metricResolver.js
src/planner/metricRegistry.js
src/planner/queryPlanner.js
src/routes/api.js
src/intents/users.intents.json
docs/metric-resolver-notes.md

Kısa dosya açıklamaları:
-metricResolver.js: Yeni skor tabanlı intent seçici eklendi.
-metricRegistry.js: Metrics yanında intents dosyalarını da okuyacak şekilde güncellendi.
-queryPlanner.js: parseQuestion yerine resolveIntent kullanacak şekilde değiştirildi.
-api.js : /chat/query endpoint’i resolver kullanacak şekilde güncellendi.
-users.intents.json: User intentleri alias, keyword ve negative keyword alanlarıyla güçlendirildi.

Diğer Modüller İçin Not:
Metric resolver altyapısı tüm domainler için kullanılabilir durumdadır. Ancak Client, Visit ve Sales/Finance taraflarında aynı başarıyı almak için ilgili intent dosyalarının da güçlendirilmesi gerekir.

Güncellenmesi gereken dosyalar:
src/intents/client.intents.json
src/intents/visit.intents.json
src/intents/sales.intents.json