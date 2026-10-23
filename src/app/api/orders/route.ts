import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, getApiSession, unauthorized } from "@/lib/api-session";

const checkoutSchema = z.object({
  items: z.array(z.object({ listingId: z.string().trim().min(1).max(80), quantity: z.coerce.number().int().min(1).max(99) }).strict()).min(1).max(30),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  address: z.string().trim().min(5).max(800),
}).strict();

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
  let payload: unknown;
  try { payload = await request.json(); } catch { return badRequest("Invalid checkout details."); }
  const parsed = checkoutSchema.safeParse(payload);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Enter valid checkout details.");
  const { items: checkoutItems, name: buyerName, email: buyerEmail, address } = parsed.data;
  const items = checkoutItems.map((item) => ({ listing_id: item.listingId, quantity: item.quantity }));
  const { data, error } = await session.supabase.rpc("place_order", { p_items: items, p_buyer_name: buyerName, p_buyer_email: buyerEmail, p_shipping_address: address });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ orderId: data, status: "pending" });
}
