// ── ANALYSE NOTIFICATION MACRODROID ──
app.post("/api/analyze-notification", async (req, res) => {
  const { title = "", text = "", app: appName = "" } = req.body;
  const fullText = `${title} ${text}`.toLowerCase();

  // Extraire le prix
  const priceMatch = fullText.match(/(\d+[\.,]?\d*)\s*€/);
  const price = priceMatch ? parseFloat(priceMatch[1].replace(",", ".")) : 0;

  // Détecter la catégorie
  const category =
    /iphone|samsung|macbook|ipad|airpods|sony|nintendo|gopro|rtx/.test(fullText) ? "tech" :
    /lego|playmobil|barbie|pokémon|jouet/.test(fullText) ? "toys" :
    /voiture.*enfant|vélo.*enfant|draisienne|kart|quad.*enfant/.test(fullText) ? "vehicles_kids" :
    /vélo|scooter|trottinette|vtt/.test(fullText) ? "vehicles" :
    /veste|nike|adidas|sac|sneaker|manteau/.test(fullText) ? "fashion" :
    /canapé|table|lit|matelas/.test(fullText) ? "furniture" :
    /thermomix|dyson|aspirateur/.test(fullText) ? "appliances" : "other";

  // Prix marché estimé
  const MARKET = { iphone:700,macbook:900,ps5:380,airpods:180,samsung:500,ipad:550,sony:250,nintendo:280,lego:100,voiture:250,trottinette:150,"vélo":200,thermomix:900,dyson:400 };
  let marketPrice = null;
  for (const [k,p] of Object.entries(MARKET)) if (fullText.includes(k)) { marketPrice=p; break; }

  const discount = marketPrice && price > 0 ? Math.max(0, Math.min(80, Math.round(((marketPrice-price)/marketPrice)*100))) : 0;
  const isGoodDeal = discount >= 25 || (price > 0 && price < 50);

  // Analyse IA si bonne affaire
  let aiVerdict = null;
  if (isGoodDeal && price > 0) {
    try {
      const aiRes = await axios.post("https://api.anthropic.com/v1/messages", {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{ role: "user", content: `Analyse cette annonce en 1 phrase max : "${title} - ${text}" à ${price}€. Est-ce une bonne affaire ? Réponds en JSON: {"verdict":"EXCELLENT|BON|MOYEN|RISQUÉ","emoji":"🔥|👍|😐|⚠️","conseil":"1 phrase courte"}` }]
      }, {
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01", "Content-Type": "application/json" }
      });
      const txt = aiRes.data.content[0].text;
      aiVerdict = JSON.parse(txt.replace(/```json|```/g, "").trim());
    } catch(e) { console.error("AI:", e.message); }
  }

  res.json({
    received: true,
    title, text, appName, price, category, discount,
    marketPrice, isGoodDeal,
    aiVerdict,
    notification: isGoodDeal ? {
      show: true,
      message: aiVerdict ? `${aiVerdict.emoji} ${aiVerdict.verdict} — ${aiVerdict.conseil}` : `🔥 -${discount}% détecté !`
    } : { show: false }
  });
});