const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
let dealsStore = [];

const MARKET = {
  iphone:700, macbook:900, ps5:380, airpods:180, samsung:500,
  ipad:550, sony:250, nintendo:280, lego:100, voiture:250,
  trottinette:150, "vélo":200, thermomix:900, dyson:400,
  nike:120, adidas:100, console:200, xbox:300,
};

function detectCategory(t) {
  if (/iphone|samsung|macbook|ipad|airpods|sony|nintendo|rtx|gopro|console|xbox/.test(t)) return "tech";
  if (/lego|playmobil|barbie|pokémon|jouet/.test(t)) return "toys";
  if (/voiture.*(enfant|électrique)|vélo.*enfant|draisienne|kart/.test(t)) return "vehicles_kids";
  if (/vélo|scooter|trottinette|vtt/.test(t)) return "vehicles";
  if (/veste|nike|adidas|sac|sneaker|manteau/.test(t)) return "fashion";
  if (/canapé|table|lit|matelas/.test(t)) return "furniture";
  if (/thermomix|dyson|aspirateur|café/.test(t)) return "appliances";
  if (/raquette|sport|fitness/.test(t)) return "sports";
  return "all";
}

function buildDeal(title, text, appName, price, marketPrice, discount) {
  const platform = appName.toLowerCase().includes("vinted") ? "vinted"
    : appName.toLowerCase().includes("leboncoin") ? "leboncoin"
    : appName.toLowerCase().includes("ricardo") ? "ricardo"
    : appName.toLowerCase().includes("anibis") ? "anibis" : "other";

  const platformLabel = platform==="vinted" ? "Vinted"
    : platform==="leboncoin" ? "Leboncoin"
    : platform==="ricardo" ? "Ricardo.ch"
    : platform==="anibis" ? "Anibis.ch" : appName;

  const platformColor = platform==="vinted" ? "#09B1BA"
    : platform==="leboncoin" ? "#F56B2A"
    : platform==="ricardo" ? "#E30613"
    : platform==="anibis" ? "#FFD200" : "#888";

  const isGoodDeal = discount >= 20 || (price > 0 && price < 30);
  const full = (title+" "+text).toLowerCase();

  return {
    id: `deal_${Date.now()}`,
    title: title || "Annonce",
    text: text || "",
    price, originalPrice: marketPrice || price,
    discount, category: detectCategory(full),
    platform, platformLabel, platformColor,
    location: "France", condition: "Non précisé",
    url: "", postedAt: new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
    isHot: discount > 35, isNew: true,
    score: Math.round(50 + discount * 0.8),
    isGoodDeal, aiVerdict: null,
    receivedAt: new Date().toISOString(),
  };
}

function analyzeText(title, text) {
  const full = (title+" "+text).toLowerCase();
  const priceMatch = full.match(/(\d+)\s*[€e]/);
  const price = priceMatch ? parseInt(priceMatch[1]) : 0;
  let marketPrice = null;
  for (const [k,p] of Object.entries(MARKET)) {
    if (full.includes(k)) { marketPrice=p; break; }
  }
  const discount = marketPrice && price > 0
    ? Math.max(0, Math.min(80, Math.round(((marketPrice-price)/marketPrice)*100)))
    : 0;
  return { price, marketPrice, discount };
}

// ── HEALTH CHECK ──
app.get("/api/healthz", (req, res) => {
  res.json({ status:"ok", deals:dealsStore.length, timestamp:new Date().toISOString() });
});

// ── RECEVOIR VIA GET (MacroDroid URL params) ──
app.get("/api/notify", (req, res) => {
  const title = decodeURIComponent(req.query.title || "");
  const text = decodeURIComponent(req.query.text || "");
  const appName = decodeURIComponent(req.query.app || "");

  const { price, marketPrice, discount } = analyzeText(title, text);
  const deal = buildDeal(title, text, appName, price, marketPrice, discount);

  dealsStore = [deal, ...dealsStore].slice(0, 200);
  console.log(`📬 GET notify: "${title}" | ${price}€ | -${discount}% | ${deal.isGoodDeal?"✅":"❌"}`);

  res.json({ received:true, price, discount, isGoodDeal:deal.isGoodDeal });
});

// ── RECEVOIR VIA POST (backup) ──
app.post("/api/analyze-notification", (req, res) => {
  const title = req.body.title || "";
  const text = req.body.text || "";
  const appName = req.body.app || "";

  const { price, marketPrice, discount } = analyzeText(title, text);
  const deal = buildDeal(title, text, appName, price, marketPrice, discount);

  dealsStore = [deal, ...dealsStore].slice(0, 200);
  console.log(`📬 POST notify: "${title}" | ${price}€ | -${discount}% | ${deal.isGoodDeal?"✅":"❌"}`);

  res.json({ received:true, price, discount, isGoodDeal:deal.isGoodDeal });
});

// ── RÉCUPÉRER LES DEALS ──
app.get("/api/deals", (req, res) => {
  res.json({ success:true, count:dealsStore.length, total:dealsStore.length, listings:dealsStore });
});

// ── VIDER L'HISTORIQUE ──
app.delete("/api/deals", (req, res) => {
  dealsStore = [];
  res.json({ success:true, message:"Historique vidé" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ DealHunt server on port ${PORT}`);
});