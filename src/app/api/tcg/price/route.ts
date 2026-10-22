import { unstable_cache } from "next/cache";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

type PriceInput = { cardName?: string; set?: string; game?: string; condition?: string };
const clean = (value: unknown, max = 120) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request) {
  const apiKey = process.env.TCGDB_API_KEY || process.env.PRICE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "TCGDB_API_KEY is not configured on the server." }, { status: 503 });
  let input: PriceInput;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const cardName = clean(input.cardName);
  const set = clean(input.set);
  const game = clean(input.game);
  const condition = clean(input.condition, 40) || "Near Mint";
  if (!cardName || !set || !game) return NextResponse.json({ error: "Card name, set, and game are required." }, { status: 400 });
  const accountFingerprint = createHash("sha256").update(apiKey).digest("hex");

  try {
    // Prices revalidate every six hours. Normalized arguments form the persistent cache key.
    const getPrice = unstable_cache(async (name: string, setName: string, gameName: string, cardCondition: string) => {
      const response = await fetch("https://tcgdb.org/api/external/price", {
        method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ cardName: name, set: setName, game: gameName, condition: cardCondition }), cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok || !body?.success) throw new Error(body?.error || `TCGDB price lookup failed (${response.status}).`);
      return body;
    }, ["tcgdb-price-v1", accountFingerprint], { revalidate: 60 * 60 * 6, tags: ["tcgdb-price"] });
    return NextResponse.json(await getPrice(cardName, set, game, condition));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "TCGDB price lookup failed." }, { status: 502 });
  }
}
