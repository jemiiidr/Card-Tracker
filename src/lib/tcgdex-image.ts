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
    const alternateLocalId = /^\d+$/.test(localId) ? String(Number(localId)) : localId;
    const localIds = [...new Set([localId, alternateLocalId])];
    for (const candidateId of localIds) {
      const cardUrl = `https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(set.id)}/${encodeURIComponent(candidateId)}`;
      const cardResponse = await fetch(cardUrl, { next: { revalidate: 60 * 60 * 24 * 30 } });
      if (!cardResponse.ok) continue;
      const card = await cardResponse.json();
      const normalizedLocalId = (value: unknown) => {
        const id = normalized(String(value || ""));
        return /^\d+$/.test(id) ? String(Number(id)) : id;
      };
      if (normalized(String(card.name || "")) === "" || normalized(String(card.set?.name || "")) !== normalized(requestedSet)) continue;
      if (normalizedLocalId(card.localId) !== normalizedLocalId(localId)) continue;
      if (typeof card.image !== "string" || !card.image.startsWith("https://assets.tcgdex.net/")) continue;
      return `${card.image.replace(/\/$/, "")}/low.webp`;
    }
    return null;
  }, ["tcgdex-pokemon-card-image-v2"], { revalidate: 60 * 60 * 24 * 30 });

  try { return await resolveImage(setName.trim(), cardNumber.trim()); }
  catch { return null; }
}
