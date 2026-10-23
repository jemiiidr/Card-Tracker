import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiSession, unauthorized } from "@/lib/api-session";
import { getApiTcgKey, getCachedApiTcgImage } from "@/lib/apitcg-image";
import { getCachedPokemonCardImage } from "@/lib/tcgdex-image";

const imageInputSchema = z.object({
  game: z.string().trim().min(1).max(80),
  cardName: z.string().trim().min(1).max(120),
  set: z.string().trim().min(1).max(120),
  cardNumber: z.string().trim().min(1).max(40),
}).strict();

export async function POST(request: Request) {
  if (!(await getApiSession())) return unauthorized();
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const parsed = imageInputSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Card, set, number, and game are required." }, { status: 400 });
  const { game, cardName: name, set, cardNumber } = parsed.data;
  const imageUrl = (getApiTcgKey() ? await getCachedApiTcgImage(game, name, set, cardNumber) : null)
    || await getCachedPokemonCardImage(game, set, cardNumber);
  return NextResponse.json({ imageUrl });
}
