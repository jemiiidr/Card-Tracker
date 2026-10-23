import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";

const baseUrl = "https://api.apitcg.com/api";
const clean = (value: unknown) => typeof value === "string"
  ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")
  : "";

function tcgSlug(game: string) {
  const value = clean(game.replace(/\s+TCG$/i, ""));
  const aliases: Record<string, string> = {
    pokemon: "pokemon", pokemontradingcardgame: "pokemon", magic: "magic", magicthegathering: "magic", mtg: "magic",
    yugioh: "yugioh", yugiohtradingcardgame: "yugioh", lorcana: "lorcana", disneylorcana: "lorcana",
    onepiece: "one-piece", onepiececardgame: "one-piece", fab: "flesh-and-blood", fleshandblood: "flesh-and-blood",
    digimon: "digimon", dragonballsuperfusionworld: "dragon-ball-super-fusion-world", dragonballsupermasters: "dragon-ball-super-masters",
    gundam: "gundam", starwarsunlimited: "star-wars-unlimited", riftbound: "riftbound", unionarena: "union-arena",
    finalfantasytcg: "final-fantasy-tcg", cardfightvanguard: "cardfight-vanguard", hololive: "hololive",
    palworld: "palworld", cyberpunk: "cyberpunk", mitosyeyendas: "mitos-y-leyendas",
  };
  return aliases[value] || null;
}

function cardNumberMatches(candidateNumber: string, productNumber: unknown) {
  if (typeof productNumber !== "string") return false;
  const wantedRaw = candidateNumber.trim().split("/")[0];
  const actualRaw = productNumber.trim().split("/")[0];
  const wanted = clean(wantedRaw).replace(/^0+/, "") || "0";
  const actual = clean(actualRaw).replace(/^0+/, "") || "0";
  if (wanted && actual && wanted === actual) return true;

  // Some catalogs put a set prefix in `code` (for example SV9-075), while
  // TCGDB provides only the collector number (075/159).
  const trailingNumber = actualRaw.match(/(\d+)$/)?.[1]?.replace(/^0+/, "") || "0";
  return Boolean(wanted && trailingNumber === wanted);
}

function setMatches(productSet: unknown, requestedSet: string) {
  const actual = clean(typeof productSet === "string" ? productSet : (productSet as any)?.name);
  const expected = clean(requestedSet);
  if (!actual || !expected) return false;
  return actual === expected || (Math.min(actual.length, expected.length) >= 6 && (actual.includes(expected) || expected.includes(actual)));
}

export function getApiTcgKey() {
  return process.env.API_TCG_KEY?.trim() || "";
}

export async function getCachedApiTcgImage(game: string, cardName: string, setName: string, cardNumber: string) {
  const apiKey = getApiTcgKey();
  const slug = tcgSlug(game);
  if (!apiKey || !slug) return null;
  const keyFingerprint = createHash("sha256").update(apiKey).digest("hex");
  const resolve = unstable_cache(async (tcg: string, name: string, set: string, number: string) => {
    const query = new URLSearchParams({ tcg, type: "card", name, limit: "100" });
    const response = await fetch(`${baseUrl}/products?${query}`, {
      headers: { "x-api-key": apiKey }, cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const wantedName = clean(name);
    const products = Array.isArray(body?.data) ? body.data : [];
    const match = products.find((product: any) => {
      return product.type === "card"
        && clean(product.name) === wantedName
        && [product.code, product.cardNumber, product.attributes?.Number].some((value) => cardNumberMatches(number, value))
        && setMatches(product.set, set);
    });
    const images = Array.isArray(match?.images) ? match.images : [];
    const imageUrl = images.map((image: any) => image?.large || image?.medium || image?.small).find((url: unknown) => {
      if (typeof url !== "string") return false;
      try { return new URL(url).protocol === "https:"; } catch { return false; }
    });
    return imageUrl || null;
  }, ["apitcg-card-image-v2", keyFingerprint], { revalidate: 60 * 60 * 24 * 30, tags: ["apitcg-card-image"] });

  try { return await resolve(slug, cardName.trim(), setName.trim(), cardNumber.trim()); }
  catch { return null; }
}
