const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const SCRAPER_KEY = "3e15cb0f58b96efe7d0eef40e72d7602";

function scraperUrl(targetUrl) {
  return `http://api.scraperapi.com?api_key=${SCRAPER_KEY}&url=${encodeURIComponent(targetUrl)}&render=true&country_code=fr`;
}

async function fetchPage(url) {
  const { data } = await axios.get(scraperUrl(url), { timeout: 30000 });
  return require("cheerio").load(data);
}

async function scrapeLeboncoin(keyword, maxPrice) {
  try {
    const q = encodeURIComponent(keyword);
    const url = `https://www.leboncoin.fr/recherche?text=${q}&price=0-${maxPrice || 9999}`;
    const $ = await fetchPage(url);
    const results = [];
    $("script").each((_, el) => {
      const content = $(el).html() || "";
      if (content.includes('"price"') && content.includes('"subject"')) {
        try {
          const match = content.match(/"ads"\s*:\s*(\[[\s\S]*?\])/);
          if (match) {
            JSON.parse(match[1]).slice(0, 10).forEach(ad => {
              if (ad.subject && ad.price?.[0]) {
                results.push({ id: `lbc_${ad.list_id}`, title: ad.subject, price: ad.price[0], location: ad.location?.city || "France", condition: "Non précisé", url: `https://www.leboncoin.fr${ad.url}`, platform: "leboncoin", platformLabel: "Leboncoin", platformColor: "#F56B2A", postedAt: "Récent" });
              }
            });
          }
        } catch (_) {}
      }
    });
    if (results.length === 0) {
      $("a[data-qa-id='aditem_container']").each((i, el) => {
        if (i >= 10) return false;
        const title = $(el).find("[data-qa-id='aditem_title']").text().trim();
        const price = parseInt($(el).find("[data-qa-id='aditem_price']").text().replace(/[^\d]/g, "")) || 0;
        const href = $(el).attr("href");
        if (title && price > 0) results.push({ id: `lbc_${i}`, title, price, location: "France", condition: "Non précisé", url: `https://www.leboncoin.fr${href}`, platform: "leboncoin", platformLabel: "Leboncoin", platformColor: "#F56B2A", postedAt: "Récent" });
      });
    }
    return results;
  } catch (e) { console.error("LBC:", e.message); return []; }
}

async function scrapeRicardo(keyword, maxPrice) {
  try {
    const q = encodeURIComponent(keyword);
    const $ = await fetchPage(`https://www.ricardo.ch/fr/s/${q}/?sort=newest`);
    const results = [];
    const nextData = $("#__NEXT_DATA__").html();
    if (nextData) {
      try {
        const articles = JSON.parse(nextData)?.props?.pageProps?.initialState?.search?.results?.articles || [];
        articles.slice(0, 10).forEach(item => {
          const price = Math.round((item?.buyNowPrice?.amount || item?.startPrice?.amount || 0) / 100);
          if (price > 0) results.push({ id: `ric_${item.articleId}`, title: item.title, price, location: item?.sellerInfo?.location || "Suisse", condition: "Non précisé", url: `https://www.ricardo.ch/fr/a/${item.articleId}/`, platform: "ricardo", platformLabel: "Ricardo.ch", platformColor: "#E30613", postedAt: "Récent" });
        });
      } catch (_) {}
    }
    return results;
  } catch (e) { console.error("Ricardo:", e.message); return []; }
}

async function scrapeAnibis(keyword, maxPrice) {
  try {
    const q = encodeURIComponent(keyword);
    const $ = await fetchPage(`https://www.anibis.ch/fr/s?q=${q}`);
    const results = [];
    $("[class*='listing'],[class*='ad-item'],article").each((i, el) => {
      if (i >= 10) return false;
      const title = $(el).find("[class*='title'],h2,h3").first().text().trim();
      const price = parseInt($(el).find("[class*='price']").first().text().replace(/[^\d]/g, "")) || 0;
      const href = $(el).find("a").first().attr("href");
      if (title && price > 0) results.push({ id: `ani_${i}`, title, price, location: "Suisse", condition: "Non précisé", url: href ? (href.startsWith("http") ? href : `https://www.anibis.ch${href}`) : "", platform: "anibis", platformLabel: "Anibis.ch", platformColor: "#FFD200", postedAt: "Récent" });
    });
    return results;
  } catch (e) { console.error("Anibis:", e.message); return []; }
}

const MARKET_PRICES = { iphone:700,macbook:900,ps5:380,airpods:180,samsung:500,ipad:550,sony:250,nintendo:280,gopro:300,rtx:700,lego:100,playmobil:80,voiture:250,quad:300,trottinette:150,"vélo":200,thermomix:900,dyson:400 };

function enrichListing(l) {
  const t = l.title.toLowerCase();
  let mp = null;
  for (const [k,p] of Object.entries(MARKET_PRICES)) if (t.includes(k)) { mp=p; break; }
  const discount = mp && l.price > 0 ? Math.max(0,Math.min(80,Math.round(((mp-l.price)/mp)*100))) : 0;
  const cat = /iphone|samsung|macbook|ipad|airpods|sony|nintendo|rtx|gopro/.test(t) ? "tech" : /lego|playmobil|barbie|pokémon/.test(t) ? "toys" : /voiture.*(enfant|électrique)|vélo.*enfant/.test(t) ? "vehicles_kids" : /vélo|scooter|trottinette/.test(t) ? "vehicles" : /veste|nike|adidas|sac/.test(t) ? "fashion" : /canapé|table|lit/.test(t) ? "furniture" : /thermomix|dyson|aspirateur/.test(t) ? "appliances" : "all";
  return { ...l, originalPrice: mp||l.price, discount, score: Math.round(50+discount*0.8), isHot: discount>35, isNew: true, category: cat };
}

app.get("/api/healthz", (req,res) => res.json({status:"ok"}));

app.get("/api/search", async (req,res) => {
  const {q="iphone", maxPrice} = req.query;
  const [a,b,c] = await Promise.allSettled([scrapeLeboncoin(q,maxPrice),scrapeRicardo(q,maxPrice),scrapeAnibis(q,maxPrice)]);
  const listings = [...(a.value||[]),...(b.value||[]),...(c.value||[])].map(enrichListing).sort((x,y)=>y.discount-x.discount);
  res.json({success:true, count:listings.length, listings});
});

app.get("/api/scan", async (req,res) => {
  const {keywords="iphone,lego,vélo", maxPrice} = req.query;
  const all = [];
  for (const kw of keywords.split(",").slice(0,5)) {
    const [a,b,c] = await Promise.allSettled([scrapeLeboncoin(kw.trim(),maxPrice),scrapeRicardo(kw.trim(),maxPrice),scrapeAnibis(kw.trim(),maxPrice)]);
    all.push(...(a.value||[]),...(b.value||[]),...(c.value||[]));
    await new Promise(r=>setTimeout(r,500));
  }
  res.json({success:true, count:all.length, listings:all.map(enrichListing).sort((x,y)=>y.discount-x.discount).slice(0,50)});
});

app.listen(PORT,"0.0.0.0",()=>console.log(`✅ DealHunt on ${PORT}`));