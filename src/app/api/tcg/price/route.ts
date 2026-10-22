import { NextResponse } from "next/server";
import { getCachedTcgPrice, getTcgApiKey } from "@/lib/tcg-pricing";
import { getApiSession, unauthorized } from "@/lib/api-session";

type PriceInput = { cardName?: string; set?: string; cardNumber?: string; game?: string };
const clean = (value: unknown, max = 120) => typeof value === "string" ? value.trim().slice(0, max) : "";

export async function POST(request: Request) {
  if (!(await getApiSession())) return unauthorized();
  if (!getTcgApiKey()) return NextResponse.json({ error: "TCGAPI_KEY is not configured on the server." }, { status: 503 });
  let input: PriceInput;
  try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const cardName = clean(input.cardName);
  const set = clean(input.set);
  const cardNumber = clean(input.cardNumber, 40);
  const game = clean(input.game);
  if (!cardName || !set || !cardNumber || !game) return NextResponse.json({ error: "Card name, set, card number, and game are required." }, { status: 400 });

  try {
    return NextResponse.json(await getCachedTcgPrice(cardName, set, cardNumber, game));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "TCG API price request timed out. You can still save the card and try again later." : error instanceof Error ? error.message : "TCG API price lookup failed." }, { status: 502 });
  }
}
