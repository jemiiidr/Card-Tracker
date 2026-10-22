import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Leave headroom beneath Vercel's 4.5 MB function request limit (multipart overhead included).
const maxImageBytes = 4 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const apiKey = process.env.TCGDB_API_KEY || process.env.PRICE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "TCGDB_API_KEY is not configured on the server." }, { status: 503 });
  const incoming = await request.formData();
  const image = incoming.get("image");
  if (!(image instanceof File)) return NextResponse.json({ error: "Choose a card photo to identify." }, { status: 400 });
  if (!allowedTypes.has(image.type)) return NextResponse.json({ error: "Use a JPEG, PNG, or WebP image." }, { status: 415 });
  if (image.size > maxImageBytes) return NextResponse.json({ error: "The optimized photo must be 4 MB or smaller." }, { status: 413 });

  const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
  const fingerprint = createHash("sha256").update(image.type).update(base64).digest("hex");
  const accountFingerprint = createHash("sha256").update(apiKey).digest("hex");
  try {
    // Next's Data Cache persists across serverless invocations on Vercel.
    // Identical image bytes reuse the result for 30 days.
    const identifyCached = unstable_cache(async () => {
      const response = await fetch("https://tcgdb.org/api/external/identify", {
        method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({ imageData: base64 }), cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok || !body?.success) throw new Error(body?.error || `TCGDB identification failed (${response.status}).`);
      return body;
    }, ["tcgdb-identify-v1", accountFingerprint, fingerprint], { revalidate: 60 * 60 * 24 * 30, tags: ["tcgdb-identify"] });
    return NextResponse.json(await identifyCached());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "TCGDB identification failed." }, { status: 502 });
  }
}
