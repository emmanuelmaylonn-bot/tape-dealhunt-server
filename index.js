const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

let cachedBrowser = null;

async function getBrowser() {
  if (cachedBrowser && cachedBrowser.isConnected()) return cachedBrowser;
  let puppeteer, executablePath;
  if (process.env.RAILWAY_ENVIRONMENT) {
    const chromium = require("@sparticuz/chromium");
    puppeteer = require("puppeteer-core");
    executablePath = await chromium.executablePath();
  } else {
    puppeteer = require("puppeteer");
    executablePath = undefined;
  }
  cachedBrowser = await puppeteer.launch({
    args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu","--no-first-run","--no-zygote","--single-process"],
    executablePath,
    headless: true,
  });
  return cachedBrowser;
}

async function scrapePage(url, extractor) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1");
    await page.setExtraHTTPHeaders({ "Accept-Language": "fr-FR,fr;q=0.9" });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForTimeout(2000);
    return await page.evaluate(extractor);
  } finally {
    await page.close();
  }
}

async function scrapeLeboncoin(keyword, maxPrice) {
  try {
    const q = encodeURIComponent(keyword);
    const url = `https://www.leboncoin.fr/recherche?text=${q}&price=0-${maxPrice || 9999}`;
    const results = await scrapePage(url, () => {
      const items = [];
      document.querySelectorAll("a[data-qa-id='aditem_container']").forEach((el, i) => {
        if (i >= 8) return;
        const title = el.querySelector("[data-qa-id='aditem_title']")?.textContent?.trim();
        const priceText = el.querySelector("[data-qa-id='aditem_price']")?.textContent?.trim() || "";
        const price = parseInt(priceText.replace(/[^\d]/g, "")) || 0;
        const href = el.getAttribute("href");
        const location = el.querySelector("[data-qa-id='aditem_location']")?.textContent?.trim() || "France";
        if (title && price > 0) items.push({ title, price, location, href });
      });
      return items;
    });
    return results.map(r => ({
      id: `lbc_${Date.now()}_${Math.random()}`,
      title: r.title, price: r.price, location: r.location,
      condition: "Non précisé",
      url: `https://www.leboncoin.fr${r.href}`,
      platform: "leboncoin", platformLabel: "Leboncoin", platformColor: "#F56B2A",
      postedAt: "Récent",
    }));
  } catch(e) { console.error("LBC:", e.message); return []; }
}

async function scrapeRicardo(keyword, maxPrice) {
  try {
    const q = encodeURIComponent(keyword);
    const url = `https://www.ricardo.ch/fr/s/${q}/?sort=newest`;
    const results = await scrapePage(url, () => {
      const items = [];
      const data = document.getElementById("__NEXT_DATA__");
      if (data) {
        try {
          const json = JSON.parse(data.textContent);
          const articles = json?.props?.pageProps?.initialState?.search?.results?.articles || [];
          articles.slice(0, 8).forEach(item => {
            const price = Math.round((item?.buyNowPrice?.amount || item?.startPrice?.amount || 0) / 100);
            if (price > 0) items.push({ title: item.title, price, articleId: item.articleId, location: item?.sellerInfo?.location || "Suisse", condition: item?.condition || "Non précisé" });
          });
        } catch(e) {}
      }
      return items;
    });
    return results.map(r => ({
      id: `ric_${r.articleId}`,
      title: r.title, price: r.price, location: r.location, condition: r.condition,
      url: `https://www.ricardo.ch/fr/a/${r.articleId}/`,
      platform: "ricardo", platformLabel: "Ricardo.ch", platformColor: "#E30613",
      postedAt: "Récent",
    }));
  } catch(e) { console.error("Ricardo:", e.message); return []; }
}

async function scrapeAnibis(keyword, maxPrice) {
  try {
    const q = encodeURIComponent(keyword);
    const url = `https://www.anibis.ch/fr/s?q=${q}${maxPrice ? `&priceMax=${maxPrice}` : ""}`;
    const results = await scrapePage(url, () => {
      const items = [];
      document.querySelectorAll("[class*='listing-item'],[class*='ad-item'],article").forEach((el, i) => {
        if (i >= 8) return;
        const title = el.querySelector("[class*='title'],h2,h3")?.textContent?.trim();
        const priceText = el.querySelector("[class*='price']")?.textContent?.trim() || "";
        const price = parseInt(priceText.replace(/[^\d]/g, "")) || 0;
        const href = el.querySelector("a")?.getAttribute("href");
        if (title && price > 0) items.push({ title, price, href });
      });
      return items;
    });
    return results.map(r => ({
      id: `ani_${Date.now()}_${Math.random()}`,
      title: r.title, price: r.price, location: "Suisse", condition: "Non précisé",
      url: r.href ? (r.href.startsWith("http") ? r.href : `https://www.anibis.ch${r.href}`) : url,
      platform: "anibis", platformLabel: "Anibis.ch", platformColor: "#FFD200",
      postedAt: "Récent",
    }));
  } catch(e) { console.error("Anibis:", e.message); return []; }
}

const MARKET_PRICES = {
  iphone: 700, macbook: 900, ps5: 380, airpods: 180, samsung: 500,
  ipad: 550, sony: 250, nintendo: 280, gopro: 300, rtx: 700,
  lego: 100, playmobil: 80, voiture: 250, quad: 300,
  trottinette: 150, vélo: 200, thermomix: 900, dyson: 400,
};

function enrichListing(listing) {
  const t = listing.title.toLowerCase();
  let marketPrice = null;
  for (const [key, price] of Object.entries(MARKET_PRICES)) {
    if (t.includes(key)) { marketPrice = price; break; }
  }
  const discount = marketPrice && listing.price > 0
    ? Math.max(0, Math.min(80, Math.round(((marketPrice - listing.price) / marketPrice) * 100)))
    : 0;
  return { ...listing, originalPrice: marketPrice || listing.price, discount, score: Math.round(50 + discount * 0.8), isHot: discount > 35, isNew: true, category: detectCategory(t) };
}

function detectCategory(t) {
  if (/iphone|samsung|macbook|ipad|airpods|sony|nintendo|rtx|gopro|kindle/.test(t)) return "tech";
  if (/lego|playmobil|barbie|pokémon|hot wheels|puzzle|monopoly/.test(t)) return "toys";
  if (/voiture.*(enfant|électrique)|quad.*enfant|draisienne|kart|scooter.*enfant|vélo.*enfant/.test(t)) return "vehicles_kids";
  if (/vélo|scooter|trottinette|vtt/.test(t)) return "vehicles";
  if (/veste|manteau|nike|adidas|sac|sneaker/.test(t)) return "fashion";
  if (/canapé|table|lit|matelas/.test(t)) return "furniture";
  if (/thermomix|dyson|aspirateur|café/.test(t)) return "appliances";
  if (/raquette|tapis.*course/.test(t)) return "sports";
  return "all";
}

app.get("/api/healthz", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

app.get("/api/scan", async (req, res) => {
  const { keywords = "iphone,lego,vélo", maxPrice } = req.query;
  const kwList = keywords.split(",").slice(0, 5);
  const all = [];
  for (const kw of kwList) {
    const [lbc, ric, ani] = await Promise.allSettled([
      scrapeLeboncoin(kw.trim(), maxPrice),
      scrapeRicardo(kw.trim(), maxPrice),
      scrapeAnibis(kw.trim(), maxPrice),
    ]);
    all.push(...(lbc.value||[]), ...(ric.value||[]), ...(ani.value||[]));
    await new Promise(r => setTimeout(r, 1000));
  }
  const listings = all.map(enrichListing).sort((a,b) => b.discount - a.discount).slice(0, 50);
  res.json({ success: true, count: listings.length, listings });
});

app.get("/api/search", async (req, res) => {
  const { q = "iphone", maxPrice } = req.query;
  const [lbc, ric, ani] = await Promise.allSettled([
    scrapeLeboncoin(q, maxPrice),
    scrapeRicardo(q, maxPrice),
    scrapeAnibis(q, maxPrice),
  ]);
  const listings = [...(lbc.value||[]), ...(ric.value||[]), ...(ani.value||[])].map(enrichListing).sort((a,b) => b.discount - a.discount);
  res.json({ success: true, count: listings.length, listings });
});

app.listen(PORT, "0.0.0.0", () => console.log(`✅ DealHunt running on ${PORT}`));