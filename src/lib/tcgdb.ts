import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";

export function getTcgdbKey() { return process.env.TCGDB_API_KEY || process.env.PRICE_API_KEY; }

function priceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** TCGDB may return a successful lookup with a null estimate for unsupported cards. */
export function extractTcgdbPrice(payload: any): number | null {
  const prices = [
    // The documented response exposes the raw USD estimate at data.price.
    payload?.data?.price,
    payload?.data?.pricing?.ungraded?.price,
    payload?.data?.marketPrice,
    payload?.data?.marketValue,
  ];
  for (const value of prices) {
    const parsed = priceNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

export async function getCachedTcgdbPrice(cardName: string, set: string, game: string, condition = "Near Mint") {
  const apiKey = getTcgdbKey();
  if (!apiKey) throw new Error("Set TCGDB_API_KEY (or PRICE_API_KEY) in the server environment.");
  const accountFingerprint = createHash("sha256").update(apiKey).digest("hex");
  const getPrice = unstable_cache(async (name: string, setName: string, gameName: string, cardCondition: string) => {
    const response = await fetch("https://tcgdb.org/api/external/price", {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ cardName: name, set: setName, game: gameName, condition: cardCondition }),
      // Keep the lookup under common serverless request limits; report a clear
      // timeout while still allowing the card to be saved without an estimate.
      cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    const body = await response.json();
    if (!response.ok || !body?.success) throw new Error(body?.error || `TCGDB price lookup failed (${response.status}).`);
    return body;
  }, ["tcgdb-price-v1", accountFingerprint], { revalidate: 60 * 60 * 6, tags: ["tcgdb-price"] });
  return getPrice(cardName.trim(), set.trim(), game.trim(), condition.trim() || "Near Mint");
}
