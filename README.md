# Cardhaus

Cardhaus is a single-store trading card shop and private collection tracker built with Next.js App Router, React, TypeScript, and Supabase. Customers can scan cards, maintain a private portfolio, browse the shop, and submit orders. The store owner manages inventory, asking prices, discounts, and fulfillment.

## Features

- Supabase email/password authentication with protected pages and API routes.
- TCGDB photo identification and TCG API card-price lookup, with a card selection step before saving. A matched card can still be saved if TCG API has no current estimate for it; its portfolio value remains unknown until a price is available.
- Exact-match Pokémon card artwork from the free TCGdex catalog; cards without a matching catalog image show an explicit placeholder.
- A private portfolio with quantity, condition, grade, acquisition cost, and estimated market value.
- An editable spreadsheet-style card sheet and private expense ledger with monthly and all-time totals.
- A shared digital card catalog populated by identified cards, with artwork, search, game filters, and one-tap add-to-portfolio actions. This catalog grows from cards identified in Cardhaus; it is not a complete TCGDB card search because TCGDB's public API exposes identification rather than a catalog-search endpoint.
- One store marketplace. Buyers see the store's asking price and discounts, never a collector's private portfolio or the card catalog's market estimate.
- Cart and checkout that creates a pending order and reserves available stock. This project does not include online payment processing; the store arranges payment and delivery with the buyer.
- Store-owner order management, listing controls, inventory, and a dashboard with portfolio value, cost basis, profit tracking, and daily snapshots.
- Supabase Row Level Security (RLS) policies keep portfolios private and limit store management to the configured store owner.
- Caching for TCGDB identification (30 days) and TCG API price results (24 hours); stale prices remain available if the provider is unavailable.

## Requirements

- Node.js 20 or newer and npm.
- A Supabase project.
- A TCGDB Vision API key for photo identification and a TCG API key for market prices. Set `VISION_API_KEY` and `TCGAPI_KEY`; the app also accepts `POKEMON_TCG_API_KEY` for TCG API pricing.

## Run locally

Open PowerShell in this project directory.

### 1. Install dependencies

```powershell
node --version
npm --version
npm install
```

### 2. Create and configure Supabase

Create a project at [supabase.com](https://supabase.com). In Supabase **Project Settings → API**, copy the Project URL, anon/public key, and service-role key.

Run [`supabase/schema.sql`](supabase/schema.sql) once in **Supabase Dashboard → SQL Editor**. This creates the tables, indexes, RLS policies, order functions, private photo bucket policy, and profile trigger. New signups receive a profile automatically. If you already ran the schema before adding the expense tracker, run [`supabase/migrations/20261023_expenses.sql`](supabase/migrations/20261023_expenses.sql) once in the same SQL Editor. If the app reports that `public.profiles` is missing from the schema cache, the SQL has not completed against this project; run it in the same Supabase project whose URL is configured in `.env.local`. The script asks PostgREST to reload its schema after creation.

In **Authentication → URL Configuration**, set the local site URL to `http://localhost:3000`. For email confirmation, add `http://localhost:3000/auth/callback` to the allowed redirect URLs. You can disable email confirmation for a private development project if you want immediate sign-in; production should use your intended confirmation policy.

### 3. Add environment variables

Copy the example file if `.env.local` does not already exist:

```powershell
Copy-Item .env.example .env.local
```

Set these values in `.env.local`. `NEXT_PUBLIC_SUPABASE_URL` must be the project root URL (for example `https://your-project.supabase.co`), not an API endpoint ending in `/rest/v1` or `/auth/v1`. The app strips those common endpoint suffixes automatically, but keep the root URL here:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
VISION_API_KEY=your-tcgdb-vision-api-key
TCGAPI_KEY=your-tcgapi-key
```

`VISION_API_KEY` is used only for TCGDB photo identification. `TCGAPI_KEY` (or `POKEMON_TCG_API_KEY`) is used for TCG API prices; `PRICE_API_KEY` is accepted as a migration fallback for prices only. Never prefix provider keys or the service-role key with `NEXT_PUBLIC_`, commit `.env.local`, or expose these secrets to the browser. The service-role key bypasses RLS and is used only by authenticated server routes for shared catalog writes and price refreshes.

### 4. Start the app and create the store owner

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, then confirm the email if your Supabase auth settings require it. To designate the single store owner, find that user's UUID under **Authentication → Users** and run this in the SQL Editor:

```sql
update public.profiles
set is_store_owner = true
where id = 'AUTH_USER_UUID';
```

Sign out and back in (or refresh the page) to load the store management module. Other accounts are customers and cannot manage listings. The store owner first adds inventory to their portfolio, then lists that inventory from the Store module.

Stop the server with **Ctrl+C**. If port 3000 is in use:

```powershell
npm run dev -- -p 3001
```

Add `http://localhost:3001/auth/callback` to Supabase's allowed redirect URLs when using that port.

## Card identification, pricing, and caching

The browser sends an optimized card photo to `/api/tcg/identify`; the server calls TCGDB and caches identical photo results. Once a match is selected, `/api/tcg/price` searches TCG API by card name and game, then matches the returned set and collector number before accepting its `market_price`. TCG API uses the `X-API-Key` header and a daily request quota. Price lookups cache for 24 hours because the provider refreshes market prices daily. Prices are estimates and may not match a completed sale. TCGDB's documented identify response does not include catalog artwork for base64 scans, so Pokémon cards use an exact set/number lookup against the keyless TCGdex catalog. Missing or unsupported artwork uses a built-in placeholder rather than a broken image.

The app compresses photos on the device and rejects optimized uploads over 4 MB. Price results are cached for 24 hours and photo-identification results for 30 days. Supabase stores card catalog entries and the last known price; reads keep the last known price when the price provider is unavailable. Marketplace responses deliberately omit market-value fields and expose the seller-entered asking price instead.

## Database and privacy

Supabase provides PostgreSQL, Auth, and Storage. The schema defines a shared card catalog, user-owned collection items, single-store listings, order snapshots, and daily portfolio snapshots. RLS enforces private collections and order access. Checkout is committed through a database function that checks current prices/stock and reserves inventory atomically; cancellation restores stock, and store-owner completion adds purchased cards to the buyer's collection. Do not disable RLS or expose the service-role key.

## Deploy to Vercel

1. Push the project to a Git repository and import it into [Vercel](https://vercel.com/new).
2. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VISION_API_KEY`, and `TCGAPI_KEY` as Vercel environment variables for the environments you use. Keep service keys private.
3. Deploy with the standard Next.js build settings.
4. In Supabase **Authentication → URL Configuration**, set the production site URL to your Vercel domain and add `https://YOUR_DOMAIN/auth/callback` to allowed redirect URLs. Add preview URLs if you use preview deployments.
5. Apply `supabase/schema.sql` to the Supabase project if you have not already, then designate the store-owner account with the SQL above.

Vercel hosts the Next.js application; Supabase separately hosts the database, auth, and storage. Free-plan request limits still apply, so the card photo is compressed below the serverless request-size limit.
