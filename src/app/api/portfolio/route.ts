import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { badRequest, getApiSession, unauthorized } from "@/lib/api-session";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { extractTcgdbPrice, getCachedTcgdbPrice } from "@/lib/tcgdb";
import { getCachedPokemonCardImage } from "@/lib/tcgdex-image";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  let { data, error } = await session.supabase.from("collection_items")
    .select("id,quantity,condition,grade,purchase_price,acquired_at,created_at,card:card_catalog(id,catalog_key,name,set_name,card_number,game,rarity,image_url,market_value,price_updated_at)")
    .eq("owner_id", session.user.id).gt("quantity", 0).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const staleCards = new Map<string, any>();
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const item of data || []) {
    const card = Array.isArray(item.card) ? item.card[0] : item.card;
    if (card && (!card.price_updated_at || new Date(card.price_updated_at).getTime() < cutoff)) staleCards.set(card.id, card);
  }
  if ((process.env.TCGDB_API_KEY || process.env.PRICE_API_KEY) && staleCards.size) {
    const admin = createSupabaseAdminClient();
    await Promise.all([...staleCards.values()].slice(0, 8).map(async (card) => {
      try {
        const priced = await getCachedTcgdbPrice(card.name, card.set_name, card.game);
        const value = extractTcgdbPrice(priced);
        if (typeof value === "number") await admin.from("card_catalog").update({ market_value: value, price_updated_at: priced?.data?.pricing?.ungraded?.priceUpdatedAt || priced?.data?.lastUpdated || new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", card.id);
      } catch { /* Keep the last known price if the provider is unavailable or its daily quota is exhausted. */ }
    }));
    const refreshed = await session.supabase.from("collection_items")
      .select("id,quantity,condition,grade,purchase_price,acquired_at,created_at,card:card_catalog(id,catalog_key,name,set_name,card_number,game,rarity,image_url,market_value,price_updated_at)")
      .eq("owner_id", session.user.id).gt("quantity", 0).order("created_at", { ascending: false });
    if (!refreshed.error) data = refreshed.data;
  }
  return NextResponse.json({ items: data || [] });
}

export async function POST(request: Request) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  let body: any;
  try { body = await request.json(); } catch { return badRequest("Invalid request body."); }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const set = typeof body.set === "string" ? body.set.trim().slice(0, 120) : "";
  const cardNumber = typeof body.cardNumber === "string" ? body.cardNumber.trim().slice(0, 40) : "";
  const game = typeof body.game === "string" ? body.game.trim().slice(0, 80) : "";
  const rarity = typeof body.rarity === "string" ? body.rarity.slice(0, 100) : null;
  let imageUrl: string | null = null;
  if (typeof body.imageUrl === "string") {
    try {
      const candidateUrl = new URL(body.imageUrl);
      if (candidateUrl.protocol === "https:" && candidateUrl.hostname === "assets.tcgdex.net") imageUrl = candidateUrl.toString().slice(0, 500);
    } catch { /* Ignore malformed or untrusted catalog-image URLs. */ }
  }
  const grade = typeof body.grade === "string" ? body.grade.slice(0, 50) : "Ungraded";
  const condition = typeof body.condition === "string" ? body.condition.slice(0, 50) : "Near Mint";
  const quantity = Math.min(99, Math.max(1, Number(body.quantity) || 1));
  const purchasePrice = body.purchasePrice === "" || body.purchasePrice == null ? null : Number(body.purchasePrice);
  if (!name || !set || !cardNumber || !game) return badRequest("Card name, set, number, and game are required.");
  if (purchasePrice != null && (!Number.isFinite(purchasePrice) || purchasePrice < 0)) return badRequest("Purchase price must be zero or more.");

  try {
    // A successful card match should still be saveable when TCGDB has no price for it.
    let priceResult: any = null;
    try { priceResult = await getCachedTcgdbPrice(name, set, game, condition); } catch { /* Preserve the last known price or save without an estimate. */ }
    const marketValue = extractTcgdbPrice(priceResult);
    const catalogKey = createHash("sha256").update(`${game}|${set}|${cardNumber}|${name}`.toLowerCase()).digest("hex");
    const admin = createSupabaseAdminClient();
    const resolvedImageUrl = imageUrl || await getCachedPokemonCardImage(game, set, cardNumber);
    const { data: existingCatalog } = await admin.from("card_catalog").select("id,image_url,market_value,price_updated_at").eq("catalog_key", catalogKey).maybeSingle();
    const { data: catalog, error: catalogError } = await admin.from("card_catalog").upsert({
      catalog_key: catalogKey, name, set_name: set, card_number: cardNumber, game, rarity,
      image_url: resolvedImageUrl || existingCatalog?.image_url || null,
      market_value: marketValue ?? existingCatalog?.market_value ?? null,
      price_updated_at: marketValue === null ? existingCatalog?.price_updated_at ?? null : priceResult?.data?.pricing?.ungraded?.priceUpdatedAt || priceResult?.data?.lastUpdated || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "catalog_key" }).select("id").single();
    if (catalogError || !catalog) throw new Error(catalogError?.message || "Could not save card details.");
    const { data: item, error } = await admin.from("collection_items").insert({
      owner_id: session.user.id, card_id: catalog.id, quantity, condition, grade, purchase_price: purchasePrice,
    }).select("id").single();
    if (error || !item) throw new Error(error?.message || "Could not add card to your collection.");
    return NextResponse.json({ itemId: item.id, marketValue: marketValue ?? existingCatalog?.market_value ?? null, priceUnavailable: marketValue === null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not add card." }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  let body: any;
  try { body = await request.json(); } catch { return badRequest("Invalid request body."); }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return badRequest("Collection item is required.");
  const updates: Record<string, unknown> = {};
  if (body.quantity !== undefined) updates.quantity = Math.max(1, Math.min(99, Number(body.quantity) || 1));
  if (body.purchasePrice !== undefined) updates.purchase_price = body.purchasePrice === "" ? null : Number(body.purchasePrice);
  if (body.grade !== undefined) updates.grade = String(body.grade).slice(0, 50);
  if (body.condition !== undefined) updates.condition = String(body.condition).slice(0, 50);
  if (updates.purchase_price !== undefined && updates.purchase_price !== null && (!Number.isFinite(updates.purchase_price) || Number(updates.purchase_price) < 0)) return badRequest("Purchase price must be zero or more.");
  if (updates.quantity !== undefined) {
    const { data: activeListing } = await session.supabase.from("listings").select("id").eq("inventory_item_id", id).eq("status", "active").maybeSingle();
    if (activeListing) {
      const { error: stockError } = await session.supabase.from("listings").update({ quantity: updates.quantity, updated_at: new Date().toISOString() }).eq("id", activeListing.id);
      if (stockError) return NextResponse.json({ error: stockError.message }, { status: 400 });
    }
  }
  if (!Object.keys(updates).length) return badRequest("No changes provided.");
  const { data, error } = await session.supabase.from("collection_items").update(updates).eq("id", id).eq("owner_id", session.user.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Card not found." }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return badRequest("Collection item is required.");
  const { data: activeListing } = await session.supabase.from("listings").select("id").eq("inventory_item_id", id).eq("status", "active").maybeSingle();
  if (activeListing) return NextResponse.json({ error: "Withdraw this store listing before removing the inventory card." }, { status: 409 });
  const { data, error } = await session.supabase.from("collection_items").delete().eq("id", id).eq("owner_id", session.user.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Card not found or is currently listed." }, { status: 404 });
  return NextResponse.json({ success: true });
}
