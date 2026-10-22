import { NextResponse } from "next/server";
import { getApiSession, unauthorized } from "@/lib/api-session";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const session = await getApiSession();
  if (!session) return unauthorized();
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid order action." }, { status: 400 }); }
  const rpc = body.action === "complete" ? "complete_order" : body.action === "cancel" ? "cancel_order" : null;
  if (!rpc) return NextResponse.json({ error: "Unknown order action." }, { status: 400 });
  const { error } = await session.supabase.rpc(rpc, { p_order_id: params.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
