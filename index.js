// ============================================================
//  DealHunt Server — À déployer sur Replit
//  Scrape Leboncoin, Ricardo.ch, Anibis.ch en temps réel
// ============================================================

const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// ── Cache pour éviter de scraper trop souvent ──
let cache = {
  listings: [],
  lastFetch: null,
  ttl: 5 * 60 * 1000, // 5 minutes
};

// ── Headers pour simuler un vrai navigateur ──
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
};

// ══════════════════════════════════════════════
//  SCRAPER LEBONCOIN
// ══════════════════════════════════════════════
async function scrapeLeboncoin(keyword, maxPrice) {
  try {
    const q = encodeURIComponent(keyword);
    const url = `https://www.leboncoin.fr/recherche?text=${q}&price=0-${maxPrice || 9999}`;

    const { data } = await axios.get(url, {
      headers: HEADERS,
      timeout: 8000,
    });

    const $ = cheerio.load(data);
    const results = [];

    // Leboncoin utilise du JSON dans la page pour les annonces
    const scriptTags = $("script").toArray();
    for (const script of scriptTags) {
      const content = $(script).html() || "";
      if (content.includes('"price"') && content.includes('"subject"')) {
        try {
          const match = content.match(/\{"ads":\[.*?\]\}/);
          if (match) {
            const json = JSON.parse(match[0]);
            if (json.ads) {
              json.ads.slice(0, 8).forEach((ad) => {
                if (ad.price && ad.subject) {
                  results.push({
                    id: `lbc_${ad.list_id}`,
                    title: ad.subject,
                    price: ad.price[0] || 0,
                    location: ad.location?.city || "France",
                    condition: ad.attributes?.find(a => a.key === "item_condition")?.value_label || "Non précisé",
                    url: `https://www.leboncoin.fr${ad.url}`,
                    platform: "leboncoin",
                    platformLabel: "Leboncoin",
                    platformColor: "#F56B2A",
                    image: ad.images?.thumb_url || null,
                    postedAt: ad.first_publication_date || "",
                  });
                }
              });
            }
          }
        } catch (_) {}
      }
    }

    // Fallback : lecture HTML directe
    if (results.length === 0) {
      $("a[data-qa-id='aditem_container']").each((i, el) => {
        if (i >= 8) return false;
        const title = $(el).find("[data-qa-id='aditem_title']").text().trim();
        const priceText = $(el).find("[data-qa-id='aditem_price']").text().trim();
        const price = parseInt(priceText.replace(/[^\d]/g, "")) || 0;
        const href = $(el).attr("href");
        const location = $(el).find("[data-qa-id='aditem_location']").text().trim();

        if (title && price > 0) {
          results.push({
            id: `lbc_${i}_${Date.now()}`,
            title,
            price,
            location: location || "France",
            condition: "Non précisé",
            url: href ? `https://www.leboncoin.fr${href}` : url,
            platform: "leboncoin",
            platformLabel: "Leboncoin",
            platformColor: "#F56B2A",
            image: null,
            postedAt: "Récent",
          });
        }
      });
    }

    return results;
  } catch (err) {
    console.error("Leboncoin error:", err.message);
    return [];
  }
}

// ══════════════════════════════════════════════
//  SCRAPER RICARDO.CH
// ══════════════════════════════════════════════
async function scrapeRicardo(keyword, maxPrice) {
  try {
    const q = encodeURIComponent(keyword);
    const url = `https://www.ricardo.ch/fr/s/${q}/?sort=newest`;

    const { data } = await axios.get(url, {
      headers: { ...HEADERS, "Accept-Language": "fr-CH,fr;q=0.9" },
      timeout: 8000,
    });

    const $ = cheerio.load(data);
    const results = [];

    // Ricardo expose souvent les données via __NEXT_DATA__
    const nextData = $("#__NEXT_DATA__").html();
    if (nextData) {
      try {
        const json = JSON.parse(nextData);
        const articles =
          json?.props?.pageProps?.initialState?.search?.results?.articles ||
          json?.props?.pageProps?.articles || [];

        articles.slice(0, 8).forEach((item, i) => {
          const price = item?.buyNowPrice?.amount || item?.startPrice?.amount || 0;
          if (!maxPrice || price <= maxPrice) {
            results.push({
              id: `ric_${item.articleId || i}`,
              title: item.title || "Annonce Ricardo",
              price: Math.round(price / 100),
              location: item?.sellerInfo?.location || "Suisse",
              condition: item?.condition || "Non précisé",
              url: `https://www.ricardo.ch/fr/a/${item.articleId}/`,
              platform: "ricardo",
              platformLabel: "Ricardo.ch",
              platformColor: "#E30613",
              image: item?.images?.[0]?.url || null,
              postedAt: "Récent",
            });
          }
        });
      } catch (_) {}
    }

    // Fallback HTML
    if (results.length === 0) {
      $("article, [class*='article'], [class*='listing-item']").each((i, el) => {
        if (i >= 8) return false;
        const title = $(el).find("h2, h3, [class*='title']").first().text().trim();
        const priceText = $(el).find("[class*='price']").first().text().trim();
        const price = parseInt(priceText.replace(/[^\d]/g, "")) || 0;
        const href = $(el).find("a").first().attr("href");

        if (title && price > 0 && (!maxPrice || price <= maxPrice)) {
          results.push({
            id: `ric_${i}_${Date.now()}`,
            title,
            price,
            location: "Suisse",
            condition: "Non précisé",
            url: href ? (href.startsWith("http") ? href : `https://www.ricardo.ch${href}`) : url,
            platform: "ricardo",
            platformLabel: "Ricardo.ch",
            platformColor: "#E30613",
            image: null,
            postedAt: "Récent",
          });
        }
      });
    }

    return results;
  } catch (err) {
    console.error("Ricardo error:", err.message);
    return [];
  }
}

// ══════════════════════════════════════════════
//  SCRAPER ANIBIS.CH
// ══════════════════════════════════════════════
async function scrapeAnibis(keyword, maxPrice) {
  try {
    const q = encodeURIComponent(keyword);
    const url = `https://www.anibis.ch/fr/s?q=${q}${maxPrice ? `&priceMax=${maxPrice}` : ""}`;

    const { data } = await axios.get(url, {
      headers: { ...HEADERS, "Accept-Language": "fr-CH,fr;q=0.9" },
      timeout: 8000,
    });

    const $ = cheerio.load(data);
    const results = [];

    $("[class*='listing'], [class*='ad-item'], article").each((i, el) => {
      if (i >= 8) return false;
      const title = $(el).find("[class*='title'], h2, h3").first().text().trim();
      const priceText = $(el).find("[class*='price']").first().text().trim();
      const price = parseInt(priceText.replace(/[^\d]/g, "")) || 0;
      const href = $(el).find("a").first().attr("href");

      if (title && price > 0 && (!maxPrice || price <= maxPrice)) {
        results.push({
          id: `ani_${i}_${Date.now()}`,
          title,
          price,
          location: "Suisse",
          condition: "Non précisé",
          url: href ? (href.startsWith("http") ? href : `https://www.anibis.ch${href}`) : url,
          platform: "anibis",
          platformLabel: "Anibis.ch",
          platformColor: "#FFD200",
          image: null,
          postedAt: "Récent",
        });
      }
    });

    return results;
  } catch (err) {
    console.error("Anibis error:", err.message);
    return [];
  }
}

// ══════════════════════════════════════════════
//  CALCUL DU SCORE & RÉDUCTION ESTIMÉE
// ══════════════════════════════════════════════
const MARKET_PRICES = {
  iphone: 700, macbook: 900, ps5: 380, airpods: 180, samsung: 500,
  ipad: 550, sony: 250, nintendo: 280, gopro: 300, rtx: 700,
  lego: 100, playmobil: 80, barbie: 100, voiture: 250, quad: 300,
  trottinette: 150, vélo: 200, thermomix: 900, dyson: 400, delonghi: 250,
};

function estimateMarketPrice(title) {
  const t = title.toLowerCase();
  for (const [key, price] of Object.entries(MARKET_PRICES)) {
    if (t.includes(key)) return price;
  }
  return null;
}

function enrichListing(listing) {
  const marketPrice = estimateMarketPrice(listing.title);
  let discount = 0;
  if (marketPrice && listing.price > 0) {
    discount = Math.round(((marketPrice - listing.price) / marketPrice) * 100);
    discount = Math.max(0, Math.min(80, discount));
  }
  return {
    ...listing,
    originalPrice: marketPrice || listing.price,
    discount,
    score: Math.round(50 + discount * 0.8 + Math.random() * 10),
    isHot: discount > 35,
    isNew: true,
    category: detectCategory(listing.title),
  };
}

function detectCategory(title) {
  const t = title.toLowerCase();
  if (/iphone|samsung|macbook|ipad|airpods|sony|nintendo|rtx|gopro|kindle|watch/.test(t)) return "tech";
  if (/lego|playmobil|barbie|pokémon|hot wheels|puzzle|monopoly|duplo/.test(t)) return "toys";
  if (/voiture.*(enfant|électrique)|quad.*enfant|draisienne|kart|scooter.*enfant|vélo.*enfant/.test(t)) return "vehicles_kids";
  if (/vélo|scooter|trottinette|vtt/.test(t)) return "vehicles";
  if (/veste|manteau|nike|adidas|sac|sneaker/.test(t)) return "fashion";
  if (/canapé|table|lit|matelas|armoire/.test(t)) return "furniture";
  if (/thermomix|dyson|robot|aspirateur|café/.test(t)) return "appliances";
  if (/raquette|vélo.*route|tapis.*course/.test(t)) return "sports";
  return "all";
}

// ══════════════════════════════════════════════
//  ROUTES API
// ══════════════════════════════════════════════

// GET /health — vérifier que le serveur tourne
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "DealHunt server is running 🚀", timestamp: new Date().toISOString() });
});

// GET /search?q=iphone&maxPrice=500&platforms=leboncoin,ricardo
app.get("/search", async (req, res) => {
  const { q = "iphone", maxPrice, platforms = "leboncoin,ricardo,anibis" } = req.query;
  const platformList = platforms.split(",");
  const max = maxPrice ? parseInt(maxPrice) : null;

  const tasks = [];
  if (platformList.includes("leboncoin")) tasks.push(scrapeLeboncoin(q, max));
  if (platformList.includes("ricardo")) tasks.push(scrapeRicardo(q, max));
  if (platformList.includes("anibis")) tasks.push(scrapeAnibis(q, max));

  try {
    const results = await Promise.allSettled(tasks);
    const listings = results
      .flatMap(r => r.status === "fulfilled" ? r.value : [])
      .map(enrichListing)
      .sort((a, b) => b.discount - a.discount);

    res.json({ success: true, count: listings.length, query: q, listings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /scan — scan multi-mots-clés (pour les alertes)
app.get("/scan", async (req, res) => {
  const { keywords = "iphone,vélo,lego", maxPrice, platforms = "leboncoin,ricardo,anibis" } = req.query;

  // Cache valide ?
  if (cache.lastFetch && Date.now() - cache.lastFetch < cache.ttl) {
    return res.json({ success: true, cached: true, count: cache.listings.length, listings: cache.listings });
  }

  const keywordList = keywords.split(",").slice(0, 5); // max 5 mots-clés
  const allResults = [];

  for (const kw of keywordList) {
    const tasks = [];
    if (platforms.includes("leboncoin")) tasks.push(scrapeLeboncoin(kw.trim(), maxPrice));
    if (platforms.includes("ricardo")) tasks.push(scrapeRicardo(kw.trim(), maxPrice));
    if (platforms.includes("anibis")) tasks.push(scrapeAnibis(kw.trim(), maxPrice));

    const results = await Promise.allSettled(tasks);
    allResults.push(...results.flatMap(r => r.status === "fulfilled" ? r.value : []));

    await new Promise(r => setTimeout(r, 500)); // pause entre requêtes
  }

  const listings = allResults
    .map(enrichListing)
    .sort((a, b) => b.discount - a.discount)
    .slice(0, 50);

  cache.listings = listings;
  cache.lastFetch = Date.now();

  res.json({ success: true, cached: false, count: listings.length, listings });
});

// ══════════════════════════════════════════════
//  DÉMARRAGE
// ══════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`✅ DealHunt server running on port ${PORT}`);
  console.log(`🔍 Routes disponibles :`);
  console.log(`   GET /health`);
  console.log(`   GET /search?q=iphone&maxPrice=500`);
  console.log(`   GET /scan?keywords=iphone,lego,vélo`);
});
