import { NextResponse } from "next/server";
import { extractTcgdbPrice, getCachedTcgdbPrice } from "@/lib/tcgdb";
import { getApiSession, unauthorized } from "@/lib/api-session";

type PriceInput = { cardName?: string; set?: string; game?: string; condition?: string };
const clean = (value: unknown, max = 120) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request) {
  if (!(await getApiSession())) return unauthorized();
  if (!(process.env.TCGDB_API_KEY || process.env.PRICE_API_KEY)) return NextResponse.json({ error: "TCGDB_API_KEY is not configured on the server." }, { status: 503 });
  let input: PriceInput;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const cardName = clean(input.cardName);
  const set = clean(input.set);
  const game = clean(input.game);
  const condition = clean(input.condition, 40) || "Near Mint";
  if (!cardName || !set || !game) return NextResponse.json({ error: "Card name, set, and game are required." }, { status: 400 });

  try {
    const result = await getCachedTcgdbPrice(cardName, set, game, condition);
    return NextResponse.json({ ...result, marketValue: extractTcgdbPrice(result) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "TCGDB price request timed out. You can still save the card and try again later." : error instanceof Error ? error.message : "TCGDB price lookup failed." }, { status: 502 });
  }
}
