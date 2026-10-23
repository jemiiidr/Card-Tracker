import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiSession, unauthorized } from "@/lib/api-session";

const orderActionSchema = z.object({ action: z.enum(["complete", "cancel"]) }).strict();

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid order action." }, { status: 400 }); }
  const parsed = orderActionSchema.safeParse(payload);
  if (!parsed.success) return NextResponse.json({ error: "Unknown order action." }, { status: 400 });
  if (params.id.length > 80) return NextResponse.json({ error: "Invalid order ID." }, { status: 400 });
  const rpc = parsed.data.action === "complete" ? "complete_order" : "cancel_order";
  const { error } = await session.supabase.rpc(rpc, { p_order_id: params.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
