import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";

const baseUrl = "https://api.tcgapi.dev/v1";
const cacheSeconds = 60 * 60 * 24;

export function getTcgApiKey() {
  // TCG API's documented key format is tcg_live_*. Keep PRICE_API_KEY as a
  // migration fallback for deployments that have not renamed the variable.
  return process.env.TCGAPI_KEY || process.env.POKEMON_TCG_API_KEY || process.env.PRICE_API_KEY;
}

const clean = (value: unknown) => typeof value === "string" ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "") : "";

function normalizedNumber(value: unknown) {
  if (typeof value !== "string") return "";
  const first = value.trim().split("/")[0].toUpperCase();
  return /^\d+$/.test(first) ? String(Number(first)) : first;
}

function setNameMatches(apiSet: unknown, identifiedSet: string) {
  const actual = clean(apiSet);
  const expected = clean(identifiedSet);
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  // TCGDB and TCG API sometimes include different punctuation or a game/set
  // prefix. Accept containment only when the shorter name is reasonably specific.
  const shorterLength = Math.min(actual.length, expected.length);
  return shorterLength >= 6 && (actual.includes(expected) || expected.includes(actual));
}

async function getGames() {
  const response = await fetch(`${baseUrl}/games?per_page=100`, { next: { revalidate: 60 * 60 * 24 * 7 }, signal: AbortSignal.timeout(5_000) });
  const body = await response.json();
  if (!response.ok || !Array.isArray(body?.data)) throw new Error("Could not load TCG API game list.");
  return body.data as { name: string; slug: string }[];
}

async function findGameSlug(game: string) {
  const games = await getGames();
  const requested = clean(game.replace(/\s+TCG$/i, ""));
  const aliases: Record<string, string[]> = {
    pokemon: ["pokemon", "pokemontradingcardgame"],
    magic: ["magic", "magicthegathering", "mtg"],
    yugioh: ["yugioh", "yugiohtradingcardgame"],
    lorcana: ["lorcana", "disneylorcana"],
    onepiece: ["onepiece", "onepiececardgame"],
    fab: ["flesh and blood", "fleshandblood", "fab"],
  };
  const candidates = Object.entries(aliases).find(([, names]) => names.includes(requested))?.[0];
  const matches = games.find((entry) => clean(entry.name) === requested || clean(entry.slug) === requested)
    || (candidates ? games.find((entry) => aliases[candidates].includes(clean(entry.name)) || aliases[candidates].includes(clean(entry.slug))) : undefined);
  if (!matches) throw new Error(`TCG API does not have a matching game for “${game}”.`);
  return matches.slug;
}

function extractPrice(value: unknown): number | null {
  const price = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(price) && price >= 0 ? price : null;
}

export async function getCachedTcgPrice(cardName: string, set: string, cardNumber: string, game: string) {
  const apiKey = getTcgApiKey();
  if (!apiKey) throw new Error("Set TCGAPI_KEY (or POKEMON_TCG_API_KEY) in the server environment.");
  const keyFingerprint = createHash("sha256").update(apiKey).digest("hex");
  const name = cardName.trim();
  const setName = set.trim();
  const number = cardNumber.trim();
  const gameSlug = await findGameSlug(game);

  const lookup = unstable_cache(async (card: string, expansion: string, collectorNumber: string, slug: string) => {
    const wantedName = clean(card);
    const wantedNumber = normalizedNumber(collectorNumber);
    const matches: any[] = [];
    let body: any;
    // The search endpoint is relevance-ranked and paginated. Common card names
    // can push the identified printing beyond page one, so walk a few pages.
    for (let page = 1; page <= 3; page++) {
      const query = new URLSearchParams({ q: card, game: slug, per_page: "100", page: String(page) });
      const response = await fetch(`${baseUrl}/search?${query}`, {
        headers: { "X-API-Key": apiKey }, cache: "no-store", signal: AbortSignal.timeout(8_000),
      });
      body = await response.json();
      if (!response.ok) {
        const message = body?.error?.message || body?.error || `TCG API price lookup failed (${response.status}).`;
        throw new Error(typeof message === "string" ? message : `TCG API price lookup failed (${response.status}).`);
      }
      const rows = Array.isArray(body?.data) ? body.data : [];
      matches.push(...rows.filter((row: any) => {
        const nameMatches = clean(row.name) === wantedName || clean(row.clean_name) === wantedName;
        const number = normalizedNumber(row.number);
        return nameMatches && Boolean(wantedNumber && number && number === wantedNumber) && setNameMatches(row.set_name, expansion);
      }));
      if (matches.length || !body?.meta?.has_more) break;
    }
    matches.sort((a: any, b: any) => Number(Boolean(b.foil_only)) - Number(Boolean(a.foil_only)));
    const match = matches[0];
    return {
      success: true,
      marketValue: extractPrice(match?.market_price),
      priceUpdatedAt: match?.price_updated_at || match?.market_price_as_of || null,
      data: match || null,
      rate_limit: body?.rate_limit,
    };
  }, ["tcgapi-price-v1", keyFingerprint], { revalidate: cacheSeconds, tags: ["tcgapi-price"] });

  return lookup(name, setName, number, gameSlug);
}
