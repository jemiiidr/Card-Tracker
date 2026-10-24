import { NextResponse } from "next/server";
import { getApiSession, unauthorized } from "@/lib/api-session";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  const { data: portfolio, error: portfolioError } = await session.supabase.from("collection_items")
    .select("quantity,purchase_price,transaction_type,sale_price,card:card_catalog(market_value)")
    .eq("owner_id", session.user.id).gt("quantity", 0);
  if (portfolioError) return NextResponse.json({ error: portfolioError.message }, { status: 500 });
  const rows = portfolio || [];
  const onHand = rows.filter((item: any) => item.transaction_type !== "sold");
  const soldCards = rows.filter((item: any) => item.transaction_type === "sold");
  const pricedOnHand = onHand.filter((item: any) => item.card?.market_value != null);
  const marketValue = pricedOnHand.length
    ? pricedOnHand.reduce((sum: number, item: any) => sum + Number(item.card.market_value) * item.quantity, 0)
    : null;
  const endingInventory = onHand.reduce((sum: number, item: any) => sum + (Number(item.purchase_price) || 0) * item.quantity, 0);
  const costBasis = endingInventory;
  const trackedCostItems = pricedOnHand.filter((item: any) => item.purchase_price != null);
  const unrealizedProfit = trackedCostItems.length
    ? trackedCostItems.reduce((sum: number, item: any) => sum + (Number(item.card.market_value) - Number(item.purchase_price)) * item.quantity, 0)
    : null;
  const cardCount = onHand.reduce((sum: number, item: any) => sum + item.quantity, 0);
  let realizedProfit = soldCards.filter((item: any) => item.purchase_price != null && item.sale_price != null)
    .reduce((sum: number, item: any) => sum + (Number(item.sale_price) - Number(item.purchase_price)) * item.quantity, 0);

  const { data: ledgerEntries, error: ledgerError } = await session.supabase.from("expenses")
    .select("category,amount").eq("owner_id", session.user.id);
  if (ledgerError) return NextResponse.json({ error: ledgerError.message }, { status: 500 });
  for (const entry of ledgerEntries || []) {
    const amount = Number(entry.amount) || 0;
    if (entry.category === "Other income") realizedProfit += amount;
    // Card purchase costs are already represented in each collection item's purchase_price.
    else if (entry.category !== "Card purchase") realizedProfit -= amount;
  }

  const { data: profile, error: profileError } = await session.supabase.from("profiles").select("is_store_owner").eq("id", session.user.id).single();
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });
  let listedValue = 0;
  if (profile?.is_store_owner) {
    const { data: listings, error: listingsError } = await session.supabase.from("listings").select("asking_price,quantity").eq("seller_id", session.user.id).eq("status", "active");
    if (listingsError) return NextResponse.json({ error: listingsError.message }, { status: 500 });
    listedValue = (listings || []).reduce((sum: number, item: any) => sum + Number(item.asking_price) * item.quantity, 0);
    const { data: completed, error: completedError } = await session.supabase.from("orders").select("items:order_items(quantity,unit_price,unit_cost_snapshot)").eq("seller_id", session.user.id).eq("status", "completed");
    if (completedError) return NextResponse.json({ error: completedError.message }, { status: 500 });
    for (const order of completed || []) for (const item of (order as any).items || []) {
      if (item.unit_cost_snapshot != null) realizedProfit += (Number(item.unit_price) - Number(item.unit_cost_snapshot)) * item.quantity;
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  if (marketValue !== null) {
    const snapshot = { owner_id: session.user.id, snapshot_date: today, market_value: marketValue, cost_basis: costBasis };
    const { error: snapshotError } = await session.supabase.from("portfolio_snapshots").upsert(snapshot, { onConflict: "owner_id,snapshot_date" });
    if (snapshotError) return NextResponse.json({ error: snapshotError.message }, { status: 500 });
  }
  const { data: recentHistory } = await session.supabase.from("portfolio_snapshots").select("snapshot_date,market_value,cost_basis")
    .eq("owner_id", session.user.id).order("snapshot_date", { ascending: false }).limit(30);
  return NextResponse.json({
    marketValue, costBasis, unrealizedProfit, realizedProfit, listedValue, cardCount,
    history: (recentHistory || []).reverse(),
  });
}
