import { NextResponse } from "next/server";
import { badRequest, getApiSession, unauthorized } from "@/lib/api-session";

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  const { data, error } = await session.supabase.from("orders")
    .select("id,buyer_id,buyer_name,buyer_email,shipping_address,subtotal,status,created_at,items:order_items(id,card_name_snapshot,set_snapshot,quantity,unit_price)")
    .order("created_at", { ascending: false }).range(0, 99);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orders: data || [] });
}

export async function POST(request: Request) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  let body: any;
  try { body = await request.json(); } catch { return badRequest("Invalid checkout details."); }
  const items = Array.isArray(body.items) ? body.items.slice(0, 30).map((item: any) => ({ listing_id: String(item.listingId || ""), quantity: Math.max(1, Math.min(99, Number(item.quantity) || 1)) })) : [];
  const buyerName = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const buyerEmail = typeof body.email === "string" ? body.email.trim().slice(0, 200) : "";
  const address = typeof body.address === "string" ? body.address.trim().slice(0, 800) : "";
  if (!items.length || items.some((item: any) => !item.listing_id) || !buyerName || !buyerEmail || address.length < 5) return badRequest("Enter your contact and shipping details and keep one or more items in your cart.");
  const { data, error } = await session.supabase.rpc("place_order", { p_items: items, p_buyer_name: buyerName, p_buyer_email: buyerEmail, p_shipping_address: address });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ orderId: data, status: "pending" });
}
