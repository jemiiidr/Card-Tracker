import { NextResponse } from "next/server";
import { getApiSession, unauthorized } from "@/lib/api-session";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  const { data, error } = await session.supabase.from("listings")
    // Do not expose the collection's market estimate to buyers. The asking price is the storefront price.
    .select("id,asking_price,quantity,discount_percent,discount_min_quantity,discount_starts_at,discount_ends_at,status,created_at,card:card_catalog(id,name,set_name,card_number,game,rarity,image_url)")
    .eq("status", "active").gt("quantity", 0).order("created_at", { ascending: false }).range(0, 199);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ listings: data || [] });
}
