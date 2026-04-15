const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
let dealsStore = [];

const MARKET = {
  iphone:700,macbook:900,ps5:380,airpods:180,samsung:500,
  ipad:550,sony:250,nintendo:280,lego:100,voiture:250,
  trottinette:150,"vélo":200,thermomix:900,dyson:400,
};

function detectCategory(t) {
  if (/iphone|samsung|macbook|ipad|airpods|sony|nintendo|rtx|gopro/.test(t)) return "tech";
  if (/lego|playmobil|barbie|pokémon/.test(t)) return "toys";
  if (/voiture.*(enfant|électrique)|vélo.*enfant|draisienne/.test(t)) return "vehicles_kids";
  if (/vélo|scooter|trottinette/.test(t)) return "vehicles";
  if (/veste|nike|adidas|sac|sneaker/.test(t)) return "fashion";
  if (/canapé|table|lit/.test(t)) return "furniture";
  if (/thermomix|dyson|aspirateur/.test(t)) return "appliances";
  return "all";
}

app.get("/api/healthz", (req, res) => {
  res.json({ status:"ok", deals:dealsStore.length, timestamp:new Date().toISOString() });
});

app.post("/api/analyze-notification", async (req, res) => {
  const { title="", text="", app:appName="" } = req.body;
  const full = (title+" "+text).toLowerCase();
  const priceMatch = full.match(/(\d+[\s]?[\.,]?\d*)\s*€/);
  const price = priceMatch ? parseFloat(priceMatch[1].replace(/\s/g,"").replace(",",".")) : 0;

  let marketPrice = null;
  for (const [k,p] of Object.entries(MARKET)) {
    if (full.includes(k)) { marketPrice=p; break; }
  }

  const discount = marketPrice && price > 0
    ? Math.max(0, Math.min(80, Math.round(((marketPrice-price)/marketPrice)*100)))
    : 0;

  const platform = appName.toLowerCase().includes("vinted") ? "vinted"
    : appName.toLowerCase().includes("leboncoin") ? "leboncoin"
    : appName.toLowerCase().includes("ricardo") ? "ricardo"
    : "other";

  const platformLabel = platform==="vinted" ? "Vinted"
    : platform==="leboncoin" ? "Leboncoin"
    : platform==="ricardo" ? "Ricardo.ch" : appName;

  const platformColor = platform==="vinted" ? "#09B1BA"
    : platform==="leboncoin" ? "#F56B2A"
    : platform==="ricardo" ? "#E30613" : "#888";

  const isGoodDeal = discount >= 20 || (price > 0 && price < 30);

  let aiVerdict = null;
  if (isGoodDeal && price > 0 && process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await axios.post("https://api.anthropic.com/v1/messages", {
        model:"claude-haiku-4-5-20251001",
        max_tokens:200,
        messages:[{role:"user",content:`Analyse en JSON sans backticks: "${title} - ${text}" à ${price}€. {"verdict":"EXCELLENT|BON|MOYEN|RISQUÉ","emoji":"🔥|👍|😐|⚠️","conseil":"1 phrase","risques":"1 phrase ou vide"}`}]
      }, {
        headers:{"x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01","Content-Type":"application/json"},
        timeout:8000
      });
      aiVerdict = JSON.parse(r.data.content[0].text.replace(/```json|```/g,"").trim());
    } catch(e) { console.error("AI:",e.message); }
  }

  const deal = {
    id:`deal_${Date.now()}`,
    title:title||text||"Annonce",
    text, price,
    originalPrice:marketPrice||price,
    discount, category:detectCategory(full),
    platform, platformLabel, platformColor,
    location:"France", condition:"Non précisé",
    url:"", postedAt:new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}),
    isHot:discount>35, isNew:true,
    score:Math.round(50+discount*0.8),
    isGoodDeal, aiVerdict,
    receivedAt:new Date().toISOString(),
  };

  // Stocker TOUTES les notifications
  dealsStore = [deal, ...dealsStore].slice(0, 200);
  console.log(`📬 ${title} | ${price}€ | -${discount}% | ${isGoodDeal?"✅":"❌"}`);

  res.json({ received:true, price, discount, isGoodDeal, aiVerdict });
});

app.get("/api/deals", (req, res) => {
  res.json({ success:true, count:dealsStore.length, total:dealsStore.length, listings:dealsStore });
});

app.delete("/api/deals", (req, res) => {
  dealsStore = [];
  res.json({ success:true });
});

app.listen(PORT, "0.0.0.0", () => console.log(`✅ DealHunt on ${PORT} | ${dealsStore.length} deals`));