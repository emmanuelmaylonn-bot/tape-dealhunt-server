const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const SCRAPER_KEY = "3e15cb0f58b96efe7d0eef40e72d7602";

// ── VINTED avec cookie auth ──
async function scrapeVinted(keyword, maxPrice) {
  try {
    // Étape 1 : récupérer le token
    const cookieRes = await axios.get("https://www.vinted.fr", {
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1", "Accept-Language": "fr-FR,fr;q=0.9" },
      maxRedirects: 10, timeout: 15000,
    });
    const cookies = cookieRes.headers["set-cookie"] || [];
    const token = cookies.map(c => c.split(";")[0]).find(c => c.startsWith("access_token_web=")) || "";

    // Étape 2 : appeler l'API
    const q = encodeURIComponent(keyword);
    const url = `https://www.vinted.fr/api/v2/catalog/items?search_text=${q}&per_page=20${maxPrice ? `&price_to=${maxPrice}` : ""}`;
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Accept": "application/json",
        "Accept-Language": "fr-FR,fr;q=0.9",
        "Cookie": token,
      },
      timeout: 15000,
    });
    return (data.items || []).slice(0, 15).map(item => ({
      id: `vin_${item.id}`,
      title: item.title,
      price: parseFloat(item.price?.amount || item.price || 0),
      location: item.user?.city || "France",
      condition: item.status || "Non précisé",
      url: `https://www.vinted.fr/items/${item.id}`,
      image: item.photo?.url || null,
      platform: "vinted", platformLabel: "Vinted", platformColor: "#09B1BA",
      postedAt: "Récent",
    })).filter(i => i.price > 0);
  } catch (e) { console.error("Vinted:", e.message); return []; }
}

// ── RICARDO ──
async function scrapeRicardo(keyword, maxPrice) {
  try {
    const q = encodeURIComponent(keyword);
    const target = `https://www.ricardo.ch/fr/s/${q}/?sort=newest`;
    const url = `http://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(target)}&render=true`;
    const { data } = await axios.get(url, { timeout: 30000 });
    const $ = cheerio.load(data);
    const results = [];
    const nextData = $("#__NEXT_DATA__").html();
    if (nextData) {
      try {
        const articles = JSON.parse(nextData)?.props?.pageProps?.initialState?.search?.results?.articles || [];
        articles.slice(0, 10).forEach(item => {
          const price = Math.round((item?.buyNowPrice?.amount || item?.startPrice?.amount || 0) / 100);
          if (price > 0 && (!maxPrice || price <= maxPrice)) {
            results.push({ id: `ric_${item.articleId}`, title: item.title, price, location: item?.sellerInfo?.location || "Suisse", condition: "Non précisé", url: `https://www.ricardo.ch/fr/a/${item.articleId}/`, platform: "ricardo", platformLabel: "Ricardo.ch", platformColor: "#E30613", postedAt: "Récent" });
          }
        });
      } catch (_) {}
    }
    return results;
  } catch (e) { console.error("Ricardo:", e.message); return []; }
}

// ── ANIBIS ──
async function scrapeAnibis(keyword, maxPrice) {
  try {
    const q = encodeURIComponent(keyword);
    const target = `https://www.anibis.ch/fr/s?q=${q}`;
    const url = `http://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(target)}&render=true`;
    const { data } = await axios.get(url, { timeout: 30000 });
    const $ = cheerio.load(data);
    const results = [];
    const nextData = $("#__NEXT_DATA__").html();
    if (nextData) {
      try {
        const json = JSON.parse(nextData);
        const listings = json?.props?.pageProps?.listings || json?.props?.pageProps?.initialData?.listings || [];
        listings.slice(0, 10).forEach((item, i) => {
          const price = parseInt(item?.price || item?.Price || 0);
          if (price > 0 && (!maxPrice || price <= maxPrice)) {
            results.push({ id: `ani_${item.id || i}`, title: item.title || item.Title, price, location: item.canton || "Suisse", condition: "Non précisé", url: item.url ? `https://www.anibis.ch${item.url}` : "https://www.anibis.ch", platform: "anibis", platformLabel: "Anibis.ch", platformColor: "#FFD200", postedAt: "Récent" });
          }
        });
      } catch (_) {}
    }
    return results;
  } catch (e) { console.error("Anibis:", e.message); return []; }
}

const MARKET_PRICES = { iphone:700,macbook:900,ps5:380,airpods:180,samsung:500,ipad:550,sony:250,nintendo:280,gopro:300,rtx:700,lego:100,playmobil:80,voiture:250,quad:300,trottinette:150,"vélo":200,thermomix:900,dyson:400 };

function enrichListing(l) {
  const t = (l.title || "").toLowerCase();
  let mp = null;
  for (const [k,p] of Object.entries(MARKET_PRICES)) if (t.includes(k)) { mp=p; break; }
  const discount = mp && l.price > 0 ? Math.max(0,Math.min(80,Math.round(((mp-l.price)/mp)*100))) : 0;
  const cat = /iphone|samsung|macbook|ipad|airpods|sony|nintendo|rtx|gopro/.test(t) ? "tech" : /lego|playmobil|barbie|pokémon/.test(t) ? "toys" : /voiture.*(enfant|électrique)|vélo.*enfant|draisienne/.test(t) ? "vehicles_kids" : /vélo|scooter|trottinette/.test(t) ? "vehicles" : /veste|nike|adidas|sac|sneaker/.test(t) ? "fashion" : /canapé|table|lit/.test(t) ? "furniture" : /thermomix|dyson|aspirateur/.test(t) ? "appliances" : "all";
  return { ...l, originalPrice: mp||l.price, discount, score: Math.round(50+discount*0.8), isHot: discount>35, isNew: true, category: cat };
}

app.get("/api/healthz", (req,res) => res.json({status:"ok"}));

app.get("/api/search", async (req,res) => {
  const {q="iphone", maxPrice} = req.query;
  const [vin,ric,ani] = await Promise.allSettled([scrapeVinted(q,maxPrice),scrapeRicardo(q,maxPrice),scrapeAnibis(q,maxPrice)]);
  const listings = [...(vin.value||[]),...(ric.value||[]),...(ani.value||[])].map(enrichListing).sort((a,b)=>b.discount-a.discount);
  res.json({success:true, count:listings.length, listings});
});

app.get("/api/scan", async (req,res) => {
  const {keywords="iphone,lego,vélo", maxPrice} = req.query;
  const all = [];
  for (const kw of keywords.split(",").slice(0,5)) {
    const [vin,ric,ani] = await Promise.allSettled([scrapeVinted(kw.trim(),maxPrice),scrapeRicardo(kw.trim(),maxPrice),scrapeAnibis(kw.trim(),maxPrice)]);
    all.push(...(vin.value||[]),...(ric.value||[]),...(ani.value||[]));
    await new Promise(r=>setTimeout(r,500));
  }
  res.json({success:true, count:all.length, listings:all.map(enrichListing).sort((a,b)=>b.discount-a.discount).slice(0,50)});
});

app.listen(PORT,"0.0.0.0",()=>console.log(`✅ DealHunt on ${PORT}`));