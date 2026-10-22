import { NextResponse } from "next/server";
import { getApiSession, unauthorized } from "@/lib/api-session";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  const { data: portfolio, error: portfolioError } = await session.supabase.from("collection_items")
    .select("quantity,purchase_price,card:card_catalog(market_value)").eq("owner_id", session.user.id).gt("quantity", 0);
  if (portfolioError) return NextResponse.json({ error: portfolioError.message }, { status: 500 });
  const marketValue = (portfolio || []).reduce((sum: number, item: any) => sum + (Number(item.card?.market_value) || 0) * item.quantity, 0);
  const trackedCostItems = (portfolio || []).filter((item: any) => item.purchase_price !== null);
  const costBasis = trackedCostItems.reduce((sum: number, item: any) => sum + Number(item.purchase_price) * item.quantity, 0);
  const unrealizedProfit = trackedCostItems.reduce((sum: number, item: any) => sum + ((Number(item.card?.market_value) || 0) - Number(item.purchase_price)) * item.quantity, 0);
  const cardCount = (portfolio || []).reduce((sum: number, item: any) => sum + item.quantity, 0);
  const { data: profile } = await session.supabase.from("profiles").select("is_store_owner").eq("id", session.user.id).single();
  let listedValue = 0;
  let realizedProfit = 0;
  if (profile?.is_store_owner) {
    const { data: listings } = await session.supabase.from("listings").select("asking_price,quantity").eq("seller_id", session.user.id).eq("status", "active");
    listedValue = (listings || []).reduce((sum: number, item: any) => sum + Number(item.asking_price) * item.quantity, 0);
    const { data: completed } = await session.supabase.from("orders").select("items:order_items(quantity,unit_price,unit_cost_snapshot)").eq("status", "completed");
    realizedProfit = (completed || []).reduce((total: number, order: any) => total + (order.items || []).reduce((sum: number, item: any) => item.unit_cost_snapshot == null ? sum : sum + (Number(item.unit_price) - Number(item.unit_cost_snapshot)) * item.quantity, 0), 0);
  }
  const today = new Date().toISOString().slice(0, 10);
  const snapshot = { owner_id: session.user.id, snapshot_date: today, market_value: marketValue, cost_basis: costBasis };
  const { error: snapshotError } = await session.supabase.from("portfolio_snapshots").upsert(snapshot, { onConflict: "owner_id,snapshot_date" });
  if (snapshotError) return NextResponse.json({ error: snapshotError.message }, { status: 500 });
  const { data: recentHistory } = await session.supabase.from("portfolio_snapshots").select("snapshot_date,market_value,cost_basis")
    .eq("owner_id", session.user.id).order("snapshot_date", { ascending: false }).limit(30);
  return NextResponse.json({
    marketValue, costBasis, unrealizedProfit, realizedProfit, listedValue, cardCount,
    history: (recentHistory || []).reverse(),
  });
}
