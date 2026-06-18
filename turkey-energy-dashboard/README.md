# BETAŞ EPC Intelligence — Türkiye Enerji Canlı İstihbarat Panosu

Ati (BETAŞ) için Türkiye EPC & enerji sektörünü 7/24 izleyen, **gerçek kaynaklı**
canlı bir web panosu. Manus'taki tek seferlik statik raporun yükseltilmiş hali:

- **Gerçek veri, gerçek kaynak.** Her kart, tablo satırı ve istatistik gerçek bir
  habere/rapora dayanır ve tıklanabilir kaynak bağlantısı taşır (AA, Hitachi Energy,
  IEA, Ember, Transformers Magazine, EKAP, Borsa Gündem, Atlantic Council, Linxon…).
- **İki dilli (TR / 中文).** Sağ üstteki TR / 中文 düğmesiyle tüm pano anında dil
  değiştirir; tercih `localStorage`'da hatırlanır. Arama her iki dilde de eşleşir.
- **Canlı RSS akışı.** 16 gerçek Türk/uluslararası enerji RSS beslemesinden sektör
  haberleri otomatik toplanır (`feeds.json`), anahtar kelimeyle süzülür.
- **7/24 tazelik.** GitHub Actions her 3 saatte bir yeniden derler ve GitHub Pages'e
  yayımlar. Açık bırakılan sekme her 15 dakikada bir kendini yeniler.
- **Tek dosya, her yerde açılır.** `index.html` bağımsızdır — çift tıklayıp yerelde
  de açabilirsiniz, internet olmasa bile küratörlü veri görünür.
- **Arama + filtre.** Başlık/ihale/kurum/kV/MW araması ve öncelik (Yüksek/Orta) filtresi.

## Klasör yapısı

```
turkey-energy-dashboard/
├── index.html          # üretilen pano (çift tıkla aç) — generate.mjs üretir
├── generate.mjs        # üretici (Node, bağımlılıksız): veri + RSS → index.html
├── data/
│   ├── news.json       # KÜRATÖRLÜ gerçek veri (tek doğruluk kaynağı — burayı düzenle)
│   └── last-build.json # son derleme damgası + RSS erişim durumu (otomatik)
├── feeds.json          # canlı toplama için gerçek RSS besleme listesi
└── README.md
```

## Yerelde çalıştırma

```bash
cd turkey-energy-dashboard
node generate.mjs        # index.html üretir (RSS erişilebilirse canlı akışı da doldurur)
open index.html          # macOS  (Linux: xdg-open, Windows: start)
```

`NO_FETCH=1 node generate.mjs` ile RSS'i atlayıp yalnızca küratörlü veriyi üretir
(kısıtlı ağlarda hızlı yerel önizleme).

## İçeriği güncelleme

Tüm küratörlü içerik `data/news.json` içindedir — başka hiçbir yeri elle düzenlemeyin.
Yeni bir haber/ihale eklemek için ilgili diziye bir nesne ekleyip `node generate.mjs`
çalıştırın. Her metin alanının bir de `_zh` (Çince) karşılığı vardır (örn. `title` +
`title_zh`); `_zh` boş bırakılırsa o dilde Türkçe metin gösterilir. Alanlar:

- `epc[]` — kart: `title, summary, importance(high|medium|low), date, source_name, source_url, tags[]`
- `tenders[]` — tablo satırı: `project, org, scope, ikn, date, status(active|upcoming|result)`
- `manufacturers[] / yeka[] / mena[]` — `title, body, source_name, source_url`
- `stats[]` — `label, value, accent(green|red|"")`
- `actions[]` — `title, desc, deadline`
- `strategy[]` — `title, body`
- `tickers[]` — `type(hot|new|info), text`

## 7/24 yayına alma (GitHub Pages) — tek seferlik kurulum

1. Bu dalı `main`'e birleştirin (workflow varsayılan dalda çalışır).
2. **Settings → Pages → Build and deployment → Source = "GitHub Actions"** seçin.
3. Hepsi bu. `.github/workflows/turkey-dashboard.yml` her 3 saatte bir derleyip
   yayımlar. Hemen yayımlamak için **Actions → Turkey Energy Dashboard → Run workflow**.

Pano adresiniz: `https://<kullanıcı-adı>.github.io/<repo>/`. Telefon/masaüstü fark
etmeden istediğiniz an açın. Actions açık ağda çalıştığı için canlı RSS akışı orada
dolar (yerel kısıtlı ortamlarda boş kalabilir, sorun değil).

## Tasarım notları

- Bağımlılık yok: saf Node 22 + tek `generate.mjs`. RSS ayrıştırıcı küçük ve
  hataya dayanıklıdır (bir besleme düşerse atlanır, pano yine derlenir).
- Veri ile sunum ayrıktır: `news.json` veriyi, `generate.mjs` görünümü tutar.
- Hiçbir veri uydurulmaz — kaynak bağlantısı olmayan rakam panoya girmez.
