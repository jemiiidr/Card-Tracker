import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, getApiSession, unauthorized } from "@/lib/api-session";

const listingCreateSchema = z.object({
  collectionItemId: z.string().trim().min(1).max(80),
  askingPrice: z.coerce.number().finite().positive(),
  discountPercent: z.coerce.number().min(0).max(100).default(0),
  discountMinQuantity: z.coerce.number().int().min(1).max(99).default(1),
  discountStartsAt: z.string().max(50).optional().nullable(),
  discountEndsAt: z.string().max(50).optional().nullable(),
}).strict();
const listingUpdateSchema = z.object({
  id: z.string().trim().min(1).max(80),
  status: z.enum(["active", "withdrawn"]).optional(),
  askingPrice: z.coerce.number().finite().positive().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  discountMinQuantity: z.coerce.number().int().min(1).max(99).optional(),
}).strict().refine((value) => Object.keys(value).length > 1, "Provide at least one listing change.");

const ownerCheck = async (supabase: any, userId: string) => {
  const { data, error } = await supabase.from("profiles").select("is_store_owner").eq("id", userId).single();
  return !error && data?.is_store_owner === true;
};

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!(await ownerCheck(session.supabase, session.user.id))) return NextResponse.json({ error: "Store owner access required." }, { status: 403 });
  const { data, error } = await session.supabase.from("listings")
    .select("id,inventory_item_id,asking_price,quantity,discount_percent,discount_min_quantity,discount_starts_at,discount_ends_at,status,created_at,card:card_catalog(id,name,set_name,card_number,game,rarity,market_value)")
    .eq("seller_id", session.user.id).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ listings: data || [] });
}

export async function POST(request: Request) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!(await ownerCheck(session.supabase, session.user.id))) return NextResponse.json({ error: "Store owner access required." }, { status: 403 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return badRequest("Invalid request body."); }
  const parsed = listingCreateSchema.safeParse(payload);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Check the listing details.");
  const body = parsed.data;
  const itemId = typeof body.collectionItemId === "string" ? body.collectionItemId : "";
  const askingPrice = Number(body.askingPrice);
  const discountPercent = body.discountPercent;
  const discountMinQuantity = body.discountMinQuantity;
  if (!itemId || !Number.isFinite(askingPrice) || askingPrice <= 0) return badRequest("Select a card and enter a positive asking price.");
  const startsDate = body.discountStartsAt ? new Date(body.discountStartsAt) : null;
  const endsDate = body.discountEndsAt ? new Date(body.discountEndsAt) : null;
  if ((startsDate && !Number.isFinite(startsDate.getTime())) || (endsDate && !Number.isFinite(endsDate.getTime()))) return badRequest("Enter valid discount dates.");
  const startsAt = startsDate?.toISOString() ?? null;
  const endsAt = endsDate?.toISOString() ?? null;
  if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) return badRequest("Discount end time must be after its start time.");
  const { data: item, error: itemError } = await session.supabase.from("collection_items").select("id,card_id,quantity").eq("id", itemId).eq("owner_id", session.user.id).single();
  if (itemError || !item) return NextResponse.json({ error: "That card is not in your store inventory." }, { status: 404 });
  const { data: existing } = await session.supabase.from("listings").select("id,status").eq("inventory_item_id", itemId).maybeSingle();
  if (existing && existing.status !== "withdrawn") return badRequest("This inventory item already has a listing. Manage or withdraw it first.");
  const listingData = {
    card_id: item.card_id, inventory_item_id: item.id, seller_id: session.user.id, asking_price: askingPrice,
    quantity: item.quantity, discount_percent: discountPercent, discount_min_quantity: discountMinQuantity,
    discount_starts_at: startsAt, discount_ends_at: endsAt, status: "active",
  };
  const { data, error } = existing
    ? await session.supabase.from("listings").update(listingData).eq("id", existing.id).select("id").single()
    : await session.supabase.from("listings").insert(listingData).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ listingId: data.id });
}

export async function PATCH(request: Request) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  if (!(await ownerCheck(session.supabase, session.user.id))) return NextResponse.json({ error: "Store owner access required." }, { status: 403 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return badRequest("Invalid request body."); }
  const parsed = listingUpdateSchema.safeParse(payload);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Check the listing changes.");
  const body = parsed.data;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status !== undefined) {
    if (!["active","withdrawn"].includes(body.status)) return badRequest("Invalid listing status.");
    updates.status = body.status;
  }
  if (body.askingPrice !== undefined) {
    const value = Number(body.askingPrice);
    updates.asking_price = value;
  }
  if (body.discountPercent !== undefined) updates.discount_percent = body.discountPercent;
  if (body.discountMinQuantity !== undefined) updates.discount_min_quantity = body.discountMinQuantity;
  const { data, error } = await session.supabase.from("listings").update(updates).eq("id", body.id).eq("seller_id", session.user.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  return NextResponse.json({ success: true });
}
