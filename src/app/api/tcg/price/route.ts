import { NextResponse } from "next/server";
import { z } from "zod";
import { getCachedTcgPrice, getTcgApiKey } from "@/lib/tcg-pricing";
import { getApiSession, unauthorized } from "@/lib/api-session";

const priceInputSchema = z.object({
  cardName: z.string().trim().min(1).max(120),
  set: z.string().trim().min(1).max(120),
  cardNumber: z.string().trim().min(1).max(40),
  game: z.string().trim().min(1).max(120),
}).strict();

export async function POST(request: Request) {
  if (!(await getApiSession())) return unauthorized();
  if (!getTcgApiKey()) return NextResponse.json({ error: "TCGAPI_KEY is not configured on the server." }, { status: 503 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const parsed = priceInputSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Card name, set, card number, and game are required." }, { status: 400 });
  const { cardName, set, cardNumber, game } = parsed.data;

  try {
    return NextResponse.json(await getCachedTcgPrice(cardName, set, cardNumber, game));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "TCG API price request timed out. You can still save the card and try again later." : error instanceof Error ? error.message : "TCG API price lookup failed." }, { status: 502 });
  }
}
