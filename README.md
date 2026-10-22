# Cardhaus

A single-owner, collector-inspired trading card marketplace built with **Next.js App Router, React, TypeScript, and Supabase**. The current UI runs on realistic sample cards; data stays local to the browser until Supabase credentials and the server actions are configured.

## What’s in the app

- Portfolio dashboard with estimated collection value, card count, listings, profit/loss, and portfolio trend.
- Private collection view with search and filters. The portfolio is private by design.
- Marketplace listing flow with a seller-entered asking price. Marketplace cards display the asking price; their market estimate remains private.
- Marketplace search, saved cards, a working in-browser cart, and sample discounts/listing states.
- Phone camera/photo upload flow through a server-side TCGDB route, followed by a current price lookup for the selected match.
- Responsive layout for desktop and mobile.

## Stack and database

Use **Supabase** for managed PostgreSQL, user authentication, Row Level Security, and private photo storage. The schema is in [`supabase/schema.sql`](supabase/schema.sql). It creates private card portfolios, public active listings, orders, order items, and storage policies. Listing prices are separate from `cards.market_value`, so only the seller’s asking price is exposed to marketplace buyers. Apply the schema in Supabase Dashboard → SQL Editor.

## Run locally

1. Install Node.js 20 or later.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local` and enter your Supabase project URL, anon key, and TCGDB key as `TCGDB_API_KEY`. The existing server-only `PRICE_API_KEY` name is also accepted. Never prefix either provider key with `NEXT_PUBLIC_`.
4. Run `npm run dev` and open `http://localhost:3000`.

The starter UI deliberately uses sample data so the product can be explored before setting up integrations. Never expose a service-role key or a provider secret in browser code.

## API keys and services

Create a Supabase project at [supabase.com](https://supabase.com). In Project Settings → API, copy the Project URL and anon/public key into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only and use it only for trusted server operations that need to bypass RLS.

TCGDB is used for photo identification and market prices. The browser calls the app's `/api/tcg/identify` and `/api/tcg/price` routes; those server routes call TCGDB's `/api/external/identify` and `/api/external/price` endpoints. The key is read only on the server. The browser compresses photos before upload to stay below Vercel's 4.5 MB function request limit.

TCGDB currently describes its public API as free during open beta with 100 successful calls per UTC day for standard accounts. It returns usage information with responses, but has no SLA and may change availability or limits during beta. A new photo uses one call; pricing a chosen match uses another. Cache hits reuse results without spending another call.

## Caching

- Card identification results are cached by SHA-256 photo fingerprint for 30 days using Next.js's server Data Cache.
- Market-price lookups are cached by card name, set, game, and condition for 6 hours.
- Static assets are served through Next.js/Vercel's built-in asset caching. Client-side card search filters the loaded collection in memory and does not call the pricing API.
- Card photos are resized and JPEG-compressed in the browser before upload, reducing mobile bandwidth and keeping the request under Vercel's serverless payload cap.
- A cache hit avoids a provider call. Unique photos still use one identification request, and a chosen match uses one price request. Supabase persistence is not connected to the sample UI yet, so the demo collection itself remains browser memory only.

Supabase persistence/authentication and checkout are not wired into the sample UI yet; the schema is a starter for that next step. No paid card-data, vision, or payment APIs are included.

## Deploy to Vercel

1. Push this project to GitHub and import it in [Vercel](https://vercel.com/new).
2. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-side `TCGDB_API_KEY` under Project → Settings → Environment Variables.
3. Keep provider secrets out of public variables. No service-role key is needed by the current demo.
4. Deploy. Set Supabase Auth → URL Configuration to your Vercel production URL and add preview URLs if needed.

Vercel builds the Next.js app automatically. Supabase is hosted separately; Vercel does not provision or host the database.
