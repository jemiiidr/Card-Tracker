import { NextResponse } from "next/server";
import { getApiSession, unauthorized } from "@/lib/api-session";
import { getApiTcgKey, getCachedApiTcgImage } from "@/lib/apitcg-image";
import { getCachedPokemonCardImage } from "@/lib/tcgdex-image";

export async function POST(request: Request) {
  if (!(await getApiSession())) return unauthorized();
  let input: Record<string, unknown>;
  try { input = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const value = (key: string, max: number) => typeof input[key] === "string" ? (input[key] as string).trim().slice(0, max) : "";
  const game = value("game", 80);
  const name = value("cardName", 120);
  const set = value("set", 120);
  const cardNumber = value("cardNumber", 40);
  if (!game || !name || !set || !cardNumber) return NextResponse.json({ error: "Card, set, number, and game are required." }, { status: 400 });
  const imageUrl = (getApiTcgKey() ? await getCachedApiTcgImage(game, name, set, cardNumber) : null)
    || await getCachedPokemonCardImage(game, set, cardNumber);
  return NextResponse.json({ imageUrl });
}
