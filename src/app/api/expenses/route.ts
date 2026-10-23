import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiSession, unauthorized } from "@/lib/api-session";

const categories = ["Card purchase", "Grading", "Supplies", "Shipping", "Fees", "Other"] as const;
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Enter a valid expense date.");
const expenseFields = {
  description: z.string().trim().min(1).max(160),
  category: z.enum(categories),
  amount: z.coerce.number().finite().positive().max(9999999999),
  expenseDate: dateSchema,
  collectionItemId: z.union([z.string().uuid(), z.literal("")]).nullable().optional(),
};
const createExpenseSchema = z.object(expenseFields).strict();
const updateExpenseSchema = z.object({ id: z.string().uuid(), ...expenseFields }).strict();

export async function GET() {
  const session = await getApiSession();
  if (!session) return unauthorized();
  const { data, error } = await session.supabase.from("expenses")
    .select("id,description,category,amount,expense_date,collection_item_id,created_at,collection_item:collection_items(card:card_catalog(name,set_name,card_number))")
    .eq("owner_id", session.user.id).order("expense_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Could not load expenses." }, { status: 500 });
  return NextResponse.json({ expenses: data || [] }, { headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" } });
}

export async function POST(request: Request) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid expense details." }, { status: 400 }); }
  const parsed = createExpenseSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Check the expense details." }, { status: 400 });
  const value = parsed.data;
  const collectionItemId = value.collectionItemId || null;
  if (collectionItemId) {
    const { data: item } = await session.supabase.from("collection_items").select("id").eq("id", collectionItemId).eq("owner_id", session.user.id).maybeSingle();
    if (!item) return NextResponse.json({ error: "Choose a card in your own collection." }, { status: 400 });
  }
  const { data, error } = await session.supabase.from("expenses").insert({
    owner_id: session.user.id, description: value.description, category: value.category,
    amount: value.amount, expense_date: value.expenseDate, collection_item_id: collectionItemId,
  }).select("id").single();
  if (error || !data) return NextResponse.json({ error: "Could not save this expense." }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" } });
}

export async function PATCH(request: Request) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid expense details." }, { status: 400 }); }
  const parsed = updateExpenseSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Check the expense details." }, { status: 400 });
  const value = parsed.data;
  const collectionItemId = value.collectionItemId || null;
  if (collectionItemId) {
    const { data: item } = await session.supabase.from("collection_items").select("id").eq("id", collectionItemId).eq("owner_id", session.user.id).maybeSingle();
    if (!item) return NextResponse.json({ error: "Choose a card in your own collection." }, { status: 400 });
  }
  const { data, error } = await session.supabase.from("expenses").update({
    description: value.description, category: value.category, amount: value.amount,
    expense_date: value.expenseDate, collection_item_id: collectionItemId, updated_at: new Date().toISOString(),
  }).eq("id", value.id).eq("owner_id", session.user.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not update this expense." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Expense not found." }, { status: 404 });
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" } });
}

export async function DELETE(request: Request) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid expense ID." }, { status: 400 });
  const { data, error } = await session.supabase.from("expenses").delete().eq("id", id).eq("owner_id", session.user.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: "Could not remove this expense." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Expense not found." }, { status: 404 });
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "private, no-store, max-age=0, must-revalidate" } });
}
