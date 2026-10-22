import { unstable_cache } from "next/cache";

const normalized = (value: string) => value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

/**
 * TCGDB identifies the card; TCG API supplies its price. Its free base64 identify response does not
 * include catalog artwork, so use TCGdex's public Pokémon catalog for an exact
 * set + collector-number image match. Unsupported games or missing catalog art
 * gracefully use the UI placeholder.
 */
export async function getCachedPokemonCardImage(game: string, setName: string, cardNumber: string) {
  if (!normalized(game).includes("pokemon")) return null;

  const resolveImage = unstable_cache(async (requestedSet: string, requestedNumber: string) => {
    const setResponse = await fetch(`https://api.tcgdex.net/v2/en/sets?name=${encodeURIComponent(requestedSet)}`, { next: { revalidate: 60 * 60 * 24 * 30 } });
    if (!setResponse.ok) return null;
    const sets = await setResponse.json();
    if (!Array.isArray(sets)) return null;
    const set = sets.find((entry: any) => normalized(String(entry.name || "")) === normalized(requestedSet));
    if (!set?.id) return null;

    const localId = requestedNumber.split("/")[0].trim();
    if (!localId) return null;
    const cardUrl = `https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(set.id)}/${encodeURIComponent(localId)}`;
    const cardResponse = await fetch(cardUrl, { next: { revalidate: 60 * 60 * 24 * 30 } });
    if (!cardResponse.ok) return null;
    const card = await cardResponse.json();
    if (normalized(String(card.name || "")) === "" || normalized(String(card.set?.name || "")) !== normalized(requestedSet)) return null;
    if (normalized(String(card.localId || "")) !== normalized(localId)) return null;
    if (typeof card.image !== "string" || !card.image.startsWith("https://assets.tcgdex.net/")) return null;
    return `${card.image.replace(/\/$/, "")}/low.webp`;
  }, ["tcgdex-pokemon-card-image-v1"], { revalidate: 60 * 60 * 24 * 30 });

  try { return await resolveImage(setName.trim(), cardNumber.trim()); }
  catch { return null; }
}
