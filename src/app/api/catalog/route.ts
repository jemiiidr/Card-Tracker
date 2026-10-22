import { NextResponse } from "next/server";
import { getApiSession, unauthorized } from "@/lib/api-session";

export async function GET(request: Request) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  const { searchParams } = new URL(request.url);
  const offset = Math.max(0, Math.min(10_000, Number(searchParams.get("offset")) || 0));
  const search = (searchParams.get("q") || "").trim().replace(/[%_,()]/g, " ").slice(0, 80);
  const game = (searchParams.get("game") || "").trim().slice(0, 80);
  let query = session.supabase.from("card_catalog")
    .select("id,catalog_key,name,set_name,card_number,game,rarity,image_url,market_value,price_updated_at")
    .order("name", { ascending: true }).order("id", { ascending: true }).range(offset, offset + 99);
  if (search) query = query.ilike("name", `%${search}%`);
  if (game) query = query.eq("game", game);
  const [{ data, error }, { data: gameRows }] = await Promise.all([
    query,
    session.supabase.from("card_catalog").select("game").order("game", { ascending: true }).range(0, 999),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cards: data || [], games: [...new Set((gameRows || []).map((row) => row.game))], hasMore: (data?.length || 0) === 100, offset });
}
