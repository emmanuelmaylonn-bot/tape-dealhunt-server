const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Stockage des 200 dernières annonces
let dealsStore = [];

// Prix marché de référence
const MARKET_PRICES = {
  iphone:700, macbook:900, ps5:380, airpods:180, samsung:500,
  ipad:550, sony:250, nintendo:280, gopro:300, rtx:700,
  lego:100, playmobil:80, voiture:250, quad:300,
  trottinette:150, "vélo":200, thermomix:900, dyson:400,
  nike:120, adidas:100, "north face":180,
};

function detectCategory(t) {
  if (/iphone|samsung|macbook|ipad|airpods|sony|nintendo|rtx|gopro|kindle/.test(t)) return "tech";
  if (/lego|playmobil|barbie|pokémon|hot wheels|puzzle|monopoly/.test(t)) return "toys";
  if (/voiture.*(enfant|électrique)|vélo.*enfant|draisienne|kart|quad.*enfant/.test(t)) return "vehicles_kids";
  if (/vélo|scooter|trottinette|vtt/.test(t)) return "vehicles";
  if (/veste|manteau|nike|adidas|sac|sneaker/.test(t)) return "fashion";
  if (/canapé|table|lit|matelas/.test(t)) return "furniture";
  if (/thermomix|dyson|aspirateur|café/.test(t)) return "appliances";
  if (/raquette|tapis.*course/.test(t)) return "sports";
  return "all";
}

function analyzeDeal(title, text, appName) {
  const fullText = (title + " " + text).toLowerCase();
  const priceMatch = fullText.match(/(\d+[\s]?[\.,]?\d*)\s*€/);
  const price = priceMatch ? parseFloat(priceMatch[1].replace(/\s/g,"").replace(",",".")) : 0;

  let marketPrice = null;
  for (const [k,p] of Object.entries(MARKET_PRICES)) {
    if (fullText.includes(k)) { marketPrice = p; break; }
  }

  const discount = marketPrice && price > 0
    ? Math.max(0, Math.min(80, Math.round(((marketPrice - price) / marketPrice) * 100)))
    : 0;

  const platform = appName.toLowerCase().includes("vinted") ? "vinted"
    : appName.toLowerCase().includes("leboncoin") ? "leboncoin"
    : appName.toLowerCase().includes("ricardo") ? "ricardo"
    : appName.toLowerCase().includes("anibis") ? "anibis"
    : "other";

  const platformLabel = appName.toLowerCase().includes("vinted") ? "Vinted"
    : appName.toLowerCase().includes("leboncoin") ? "Leboncoin"
    : appName.toLowerCase().includes("ricardo") ? "Ricardo.ch"
    : appName.toLowerCase().includes("anibis") ? "Anibis.ch"
    : appName;

  const platformColor = platform === "vinted" ? "#09B1BA"
    : platform === "leboncoin" ? "#F56B2A"
    : platform === "ricardo" ? "#E30613"
    : "#FFD200";

  const isGoodDeal = discount >= 20 || (price > 0 && price < 30);

  return {
    price, marketPrice, discount, platform, platformLabel, platformColor,
    category: detectCategory(fullText),
    isGoodDeal,
    score: Math.round(50 + discount * 0.8),
    isHot: discount > 35,
  };
}

// ── HEALTH CHECK ──
app.get("/api/healthz", (req, res) => {
  res.json({ status: "ok", deals: dealsStore.length, timestamp: new Date().toISOString() });
});

// ── RECEVOIR UNE NOTIFICATION MACRODROID ──
app.post("/api/analyze-notification", async (req, res) => {
  const { title = "", text = "", app: appName = "" } = req.body;

  const analysis = analyzeDeal(title, text, appName);

  let aiVerdict = null;
  if (analysis.isGoodDeal && analysis.price > 0 && process.env.ANTHROPIC_API_KEY) {
    try {
      const aiRes = await axios.post("https://api.anthropic.com/v1/messages", {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: `Analyse cette annonce en JSON sans backticks: "${title} - ${text}" à ${analysis.price}€ (marché ~${analysis.marketPrice}€). {"verdict":"EXCELLENT|BON|MOYEN|RISQUÉ","emoji":"🔥|👍|😐|⚠️","conseil":"1 phrase courte","risques":"1 phrase ou vide"}`
        }]
      }, {
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        timeout: 10000
      });
      aiVerdict = JSON.parse(aiRes.data.content[0].text.replace(/```json|```/g,"").trim());
    } catch(e) {
      console.error("AI error:", e.message);
    }
  }

  const deal = {
    id: `deal_${Date.now()}`,
    title: title || text,
    text,
    price: analysis.price,
    originalPrice: analysis.marketPrice || analysis.price,
    discount: analysis.discount,
    category: analysis.category,
    platform: analysis.platform,
    platformLabel: analysis.platformLabel,
    platformColor: analysis.platformColor,
    location: "France",
    condition: "Non précisé",
    url: "",
    postedAt: new Date().toLocaleTimeString("fr-FR", {hour:"2-digit",minute:"2-digit"}),
    isHot: analysis.isHot,
    isNew: true,
    score: analysis.score,
    isGoodDeal: analysis.isGoodDeal,
    aiVerdict,
    receivedAt: new Date().toISOString(),
  };

  // Stocker toujours (même les mauvaises affaires pour l'historique)
  dealsStore = [deal, ...dealsStore].slice(0, 200);

  console.log(`📬 Notification reçue: ${title} | ${analysis.price}€ | -${analysis.discount}% | ${analysis.isGoodDeal ? "✅ BONNE AFFAIRE" : "❌ pas rentable"}`);

  res.json({
    received: true,
    price: analysis.price,
    discount: analysis.discount,
    isGoodDeal: analysis.isGoodDeal,
    aiVerdict,
  });
});

// ── RÉCUPÉRER LES DEALS POUR L'APP ──
app.get("/api/deals", (req, res) => {
  const { category, minDiscount, onlyGood } = req.query;
  let results = [...dealsStore];
  if (category && category !== "all") results = results.filter(d => d.category === category);
  if (minDiscount) results = results.filter(d => d.discount >= parseInt(minDiscount));
  if (onlyGood === "true") results = results.filter(d => d.isGoodDeal);
  res.json({ success: true, count: results.length, total: dealsStore.length, listings: results });
});

// ── VIDER L'HISTORIQUE ──
app.delete("/api/deals", (req, res) => {
  dealsStore = [];
  res.json({ success: true, message: "Historique vidé" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ DealHunt server running on port ${PORT}`);
  console.log(`📊 Stockage: jusqu'à 200 annonces`);
});