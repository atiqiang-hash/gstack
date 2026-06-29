# BETAŞ EPC Intelligence — Türkiye Enerji Canlı İstihbarat Panosu

Ati (BETAŞ) için Türkiye EPC & enerji sektörünü 7/24 izleyen, **gerçek kaynaklı**
canlı bir web panosu. Manus'taki tek seferlik statik raporun yükseltilmiş hali:

- **Gerçek veri, gerçek kaynak.** Her kart, tablo satırı ve istatistik gerçek bir
  habere/rapora dayanır ve tıklanabilir kaynak bağlantısı taşır (AA, Hitachi Energy,
  IEA, Ember, Transformers Magazine, EKAP, Borsa Gündem, Atlantic Council, Linxon…).
- **Üç dilli (TR / EN / 中文).** Sağ üstteki TR / EN / 中文 düğmesiyle tüm pano anında
  dil değiştirir; tercih `localStorage`'da hatırlanır. Arama üç dilde de eşleşir.
- **Canlı RSS akışı.** 16 gerçek Türk/uluslararası enerji RSS beslemesinden sektör
  haberleri otomatik toplanır (`feeds.json`), anahtar kelimeyle süzülür. İsteğe bağlı
  makine çevirisiyle canlı başlıklar üç dile de çevrilebilir (aşağıya bakın).
- **7/24 tazelik.** GitHub Actions her 3 saatte bir yeniden derler ve GitHub Pages'e
  yayımlar. Açık bırakılan sekme her 15 dakikada bir kendini yeniler.
- **Tek dosya, her yerde açılır.** `index.html` bağımsızdır — çift tıklayıp yerelde
  de açabilirsiniz, internet olmasa bile küratörlü veri görünür.
- **Arama + filtre.** Başlık/ihale/kurum/kV/MW araması ve öncelik (Yüksek/Orta) filtresi.
- **Analitik / Genel Bakış.** Üstte, verilerden canlı hesaplanan panel: EPC önem dağılımı,
  ihale durumu kırılımı, sektör kapsamı ve toplam takip edilen başlık + farklı kaynak sayısı.
  Saf CSS çubuklar, bağımlılıksız; veri değişince otomatik güncellenir.
- **Mini trend grafiği + günlük arşiv.** Her derleme, metrikleri `data/history.json`'a
  (commit'lenir) ve tam anlık görüntüyü `data/archive/<tarih>.json`'a (gitignore) yazar.
  Genel Bakış'taki SVG sparkline zamanla dolar; CI her gün bir veri noktası ekler.
- **Canlı akışta kaynak bayrağı + kategori etiketi.** Her RSS başlığı, beslemenin ülke
  bayrağını (🇹🇷/🇬🇧/🌐/🌍/🌊) ve başlıktan çıkarılan renkli kategori etiketini
  (Trafo, İhale, Rüzgar, Güneş, Depolama, GIS, Şebeke) gösterir.
- **Tek tık Yazdır / PDF.** Üstteki 🖨 düğmesi, baskıya optimize (açık tema, tek sütun,
  arayüz gizli) bir çıktı üretir — tarayıcıdan "PDF olarak kaydet" ile rapor olur.

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
çalıştırın. Her metin alanının `_en` (İngilizce) ve `_zh` (Çince) karşılığı vardır
(örn. `title` + `title_en` + `title_zh`); bir dil boş bırakılırsa o dilde Türkçe metin
gösterilir. Alanlar:

- `epc[]` — kart: `title, summary, importance(high|medium|low), date, source_name, source_url, tags[]`
- `tenders[]` — tablo satırı: `project, org, scope, ikn, date, status(active|upcoming|result)`
- `manufacturers[] / yeka[] / mena[]` — `title, body, source_name, source_url`
- `stats[]` — `label, value, accent(green|red|"")`
- `actions[]` — `title, desc, deadline`
- `strategy[]` — `title, body`
- `tickers[]` — `type(hot|new|info), text`

## Canlı başlık makine çevirisi (isteğe bağlı, varsayılan KAPALI)

Canlı RSS başlıkları normalde kaynak dilinde (TR/EN) gösterilir. İstenirse her başlık
TR + EN + 中文'ye çevrilip dil düğmesine bağlanabilir. Çeviri **best-effort**'tur:
herhangi bir çağrı başarısız olursa başlık orijinal diliyle kalır, pano yine derlenir.

```bash
# Ücretsiz, anahtarsız (resmi olmayan Google uç noktası)
TRANSLATE=google node generate.mjs

# Kendi LibreTranslate sunucunuzla
TRANSLATE=libre LIBRETRANSLATE_URL=https://libretranslate.example node generate.mjs
# (gerekirse LIBRETRANSLATE_API_KEY ekleyin)

TRANSLATE_MAX=18   # derleme başına çevrilecek başlık sayısı (varsayılan 18)
```

GitHub Actions'ta açmak için: **Settings → Secrets and variables → Actions → Variables**
altında `DASH_TRANSLATE` değişkenini `google` (veya `libre`) yapın. Libre için ayrıca
`LIBRETRANSLATE_URL` değişkenini ve gerekiyorsa `LIBRETRANSLATE_API_KEY` secret'ını ekleyin.
Değişken boşsa çeviri kapalı kalır.

## Gizlilik dostu ziyaretçi sayacı (isteğe bağlı, varsayılan KAPALI)

Pano hiçbir izleyici yüklemeden çalışır. İsterseniz gizlilik dostu (çerezsiz, kişisel
veri toplamayan) bir sayaç ekleyebilirsiniz. `data/news.json` → `meta.analytics`
içinde `provider` boş olduğu sürece **hiçbir üçüncü taraf script yüklenmez**.

Etkinleştirmek için `provider`'ı seçip ilgili alanı doldurun:

| provider | Doldurulacak alan | Not |
|----------|-------------------|-----|
| `goatcounter` | `goatcounter_code` (örn. `betas` → `betas.goatcounter.com`) | **Önerilen.** Ücretsiz, çerezsiz, açık kaynak. |
| `plausible` | `plausible_domain` (örn. `betas.github.io`) | Barındırılan/öz-barındırılan. |
| `umami` | `umami_src` + `umami_id` | Öz-barındırılan. |
| `cloudflare` | `cloudflare_token` | Cloudflare Web Analytics. |

Örnek (GoatCounter): goatcounter.com'da ücretsiz hesap açın, kodunuzu (`betas`) alın,
`meta.analytics.provider`'ı `"goatcounter"`, `goatcounter_code`'u `"betas"` yapın,
`node generate.mjs` çalıştırın. İstatistikler `betas.goatcounter.com` panelinde görünür.

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
