"use client";

import { useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Bell, Camera, Check, ChevronDown, CircleDollarSign, Heart, LayoutDashboard, Plus, Search, ShoppingBag, SlidersHorizontal, Sparkles, Tag, TrendingUp, Upload, X } from "lucide-react";

type Card = { id: number; name: string; set: string; number: string; grade: string; price: number; listed?: number; condition: string; color: string; mark: string; rarity: string; trend: number; category: string };
const initialCards: Card[] = [
  { id: 1, name: "Charizard ex", set: "Obsidian Flames · 223/197", number: "223/197", grade: "PSA 10", price: 412.50, listed: 449, condition: "Gem Mint", color: "orange", mark: "✦", rarity: "Special Illustration", trend: 8.4, category: "Pokémon" },
  { id: 2, name: "Pikachu with Grey Felt Hat", set: "Van Gogh Museum · 085", number: "085", grade: "PSA 9", price: 286.00, listed: 320, condition: "Mint", color: "yellow", mark: "⚡", rarity: "Promo", trend: 3.2, category: "Pokémon" },
  { id: 3, name: "Gengar VMAX", set: "Fusion Strike · 271/264", number: "271/264", grade: "PSA 10", price: 198.75, condition: "Gem Mint", color: "purple", mark: "☾", rarity: "Alternate Art", trend: -2.1, category: "Pokémon" },
  { id: 4, name: "Umbreon VMAX", set: "Evolving Skies · 215/203", number: "215/203", grade: "PSA 10", price: 765.00, listed: 820, condition: "Gem Mint", color: "navy", mark: "☾", rarity: "Alternate Art", trend: 12.6, category: "Pokémon" },
  { id: 5, name: "Mew ex", set: "Paldean Fates · 232/091", number: "232/091", grade: "PSA 10", price: 124.90, condition: "Gem Mint", color: "pink", mark: "✳", rarity: "Special Illustration", trend: 4.8, category: "Pokémon" },
  { id: 6, name: "Lugia V", set: "Silver Tempest · 186/195", number: "186/195", grade: "PSA 10", price: 219.00, condition: "Gem Mint", color: "blue", mark: "✧", rarity: "Alternate Art", trend: -0.7, category: "Pokémon" },
  { id: 7, name: "Mewtwo VSTAR", set: "Crown Zenith · GG44/GG70", number: "GG44/GG70", grade: "PSA 10", price: 108.25, condition: "Gem Mint", color: "violet", mark: "◉", rarity: "Galarian Gallery", trend: 2.9, category: "Pokémon" },
  { id: 8, name: "Rayquaza VMAX", set: "Evolving Skies · 218/203", number: "218/203", grade: "PSA 10", price: 389.99, listed: 420, condition: "Gem Mint", color: "teal", mark: "〰", rarity: "Alternate Art", trend: 6.1, category: "Pokémon" },
];

type View = "Overview" | "Marketplace" | "My collection";
type ScanCandidate = { name: string; set: string; cardNumber: string; game: string; rarity?: string; confidence?: number };
const currency = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function optimizeScanPhoto(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPEG, PNG, or WebP photo.");
  const bitmap = await createImageBitmap(file);
  try {
    const maxBytes = 3.8 * 1024 * 1024;
    let scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 7; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot process the photo.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", Math.max(0.58, 0.84 - attempt * 0.04)));
      if (blob && blob.size <= maxBytes) return new File([blob], "card-scan.jpg", { type: "image/jpeg", lastModified: file.lastModified });
      scale *= 0.78;
    }
    throw new Error("The photo could not be compressed enough to upload.");
  } finally { bitmap.close(); }
}

export default function Home() {
  const [view, setView] = useState<View>("Overview");
  const [cards, setCards] = useState<Card[]>(() => initialCards);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All cards");
  const [cart, setCart] = useState<number[]>([]);
  const [saved, setSaved] = useState<number[]>([]);
  const [modal, setModal] = useState<"scan" | "sell" | "cart" | null>(null);
  const [scanCandidates, setScanCandidates] = useState<ScanCandidate[]>([]);
  const [scanStatus, setScanStatus] = useState("");
  const [scanError, setScanError] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const listedCards = useMemo(() => cards.filter((card) => card.listed), [cards]);
  const filtered = useMemo(() => (view === "Marketplace" ? listedCards : cards).filter((card) => {
    const matchesText = `${card.name} ${card.set} ${card.grade}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "All cards" || (filter === "On sale" ? !!card.listed : !card.listed);
    return matchesText && matchesFilter;
  }), [cards, filter, listedCards, query, view]);
  const collectionValue = useMemo(() => cards.reduce((sum, card) => sum + card.price, 0), [cards]);
  const listedValue = useMemo(() => listedCards.reduce((sum, card) => sum + (card.listed || 0), 0), [listedCards]);

  function notify(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 2800); }
  function addToCart(id: number) { setCart((items) => items.includes(id) ? items : [...items, id]); notify("Added to your cart"); }
  async function handleScan(file?: File) {
    if (!file) return;
    setModal("scan");
    setScanCandidates([]); setScanError(""); setScanStatus(""); setScanLoading(true);
    try {
      const optimizedPhoto = await optimizeScanPhoto(file);
      const form = new FormData(); form.append("image", optimizedPhoto);
      const response = await fetch("/api/tcg/identify", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Card identification failed.");
      if (!body.success || !body.data) throw new Error("TCGDB returned an invalid identification response.");
      const matches = body.data.candidates?.length ? body.data.candidates : [body.data];
      setScanStatus(body.data.lowConfidence ? "ambiguous" : "matched");
      setScanCandidates(matches);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Card identification failed.");
    } finally { setScanLoading(false); }
  }
  async function addScannedCard(candidateOverride?: ScanCandidate) {
    const candidate = candidateOverride || scanCandidates[0];
    if (!candidate) return;
    setScanLoading(true); setScanError("");
    try {
      const response = await fetch("/api/tcg/price", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardName: candidate.name, set: candidate.set, game: candidate.game, condition: "Near Mint" }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Price lookup failed.");
      const price = body.data?.pricing?.ungraded?.price ?? body.data?.price ?? 0;
      if (typeof price !== "number" || !Number.isFinite(price) || price < 0) throw new Error("TCGDB did not return a market price for this card.");
      const newCard: Card = { id: Date.now(), name: candidate.name, set: `${candidate.set} · ${candidate.cardNumber}`, number: candidate.cardNumber, grade: "Ungraded", price, condition: "Near Mint", color: "green", mark: "✳", rarity: candidate.rarity || "Unverified", trend: 0, category: candidate.game };
      setCards((all) => [newCard, ...all]); setModal(null); setView("My collection"); notify("Card added to your private collection");
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Could not get a current market price.");
    } finally { setScanLoading(false); }
  }
  function saveListing() {
    const priceInput = document.getElementById("listing-price") as HTMLInputElement | null;
    const selectedId = Number((document.getElementById("listing-card") as HTMLSelectElement | null)?.value);
    const price = Number(priceInput?.value);
    if (!price || price <= 0) return notify("Enter a valid asking price");
    setCards((all) => all.map((card) => card.id === selectedId ? { ...card, listed: price } : card)); setModal(null); setView("Marketplace"); notify("Your listing is live in the marketplace");
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#home"><span className="brand-icon">c.</span><span>cardhaus<span className="brand-dot">.</span></span></a>
      <div className="workspace"><div className="avatar">J</div><div><b>Jamie’s shop</b><small>Personal collection</small></div><ChevronDown size={15} /></div>
      <span className="nav-caption">WORKSPACE</span>
      <nav>{([ ["Overview", LayoutDashboard], ["Marketplace", ShoppingBag], ["My collection", Tag] ] as const).map(([label, Icon]) => <button key={label} className={`nav-link ${view === label ? "active" : ""}`} onClick={() => { setView(label); setQuery(""); }}><Icon size={17} strokeWidth={1.8} />{label}{label === "Marketplace" && <span className="nav-count">{listedCards.length}</span>}</button>)}</nav>
      <div className="sidebar-card"><div className="side-spark"><Sparkles size={15} /></div><b>Your collection,<br />all in one place.</b><p>Track value, discover deals, and find a new home for the cards you love.</p><button onClick={() => setModal("scan")}>Add a card <ArrowRight size={14} /></button><div className="side-watermark">✳</div></div>
      <div className="profile"><div className="avatar profile-avatar">J</div><div><b>Jamie Chen</b><small>Collector account</small></div><ChevronDown size={15} /></div>
    </aside>

    <section className="main-area">
      <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <b>{view}</b></div><div className="top-actions"><span className="live-dot" /> Market data updated 8 min ago <button className="icon-button notification" aria-label="Notifications"><Bell size={18} /><i /></button></div></header>

      <div className="content">
        <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR COLLECTION AT A GLANCE</div><h1>{view === "Overview" ? <>A good day to<br /><em>collect something.</em></> : view === "Marketplace" ? <>Find your next<br /><em>favorite card.</em></> : <>Your cards,<br /><em>beautifully tracked.</em></>}</h1><p className="intro">{view === "Overview" ? "A little snapshot of the cards you love and the value they hold." : view === "Marketplace" ? "One collector to another. Find something special." : "Your personal collection is private, just for you."}</p></div><button className="primary-button scan-button" onClick={() => setModal("scan")}><Camera size={16} /> Scan a card <span className="button-plus">+</span></button></section>

        {view === "Overview" && <>
          <section className="stats-grid">
            <div className="stat-card featured-stat"><div className="stat-top"><span>COLLECTION VALUE</span><span className="stat-icon green-icon"><CircleDollarSign size={17} /></span></div><div className="stat-number">{currency(collectionValue)}</div><div className="stat-bottom"><span className="growth"><ArrowUpRight size={14} /> 8.6%</span><span>vs. last month</span><span className="sparkline"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></span></div></div>
            <div className="stat-card"><div className="stat-top"><span>CARDS COLLECTED</span><span className="stat-icon purple-icon"><Tag size={16} /></span></div><div className="stat-number">{cards.length}<span className="stat-unit"> cards</span></div><div className="stat-note"><span className="muted-dot" /> Across 6 different sets</div></div>
            <div className="stat-card"><div className="stat-top"><span>LISTED FOR SALE</span><span className="stat-icon yellow-icon"><ShoppingBag size={16} /></span></div><div className="stat-number">{currency(listedValue)}</div><div className="stat-note"><span className="listing-pill">{listedCards.length} active</span> listings on the market</div></div>
            <div className="stat-card"><div className="stat-top"><span>PROFIT / LOSS</span><span className="stat-icon orange-icon"><TrendingUp size={16} /></span></div><div className="stat-number positive">+$486.30</div><div className="stat-bottom"><span className="growth"><ArrowUpRight size={14} /> 14.2%</span><span>unrealized return</span></div></div>
          </section>
          <section className="dashboard-grid"><div className="chart-card"><div className="section-heading"><div><h2>Portfolio performance</h2><p>Your collection is growing nicely.</p></div><button className="select-button">Last 30 days <ChevronDown size={14} /></button></div><div className="chart-summary"><span className="chart-total">$2,504.39</span><span className="growth small-growth"><ArrowUpRight size={13} /> $198.42 (8.6%)</span></div><div className="chart-wrap"><div className="chart-y"><span>$2.6k</span><span>$2.4k</span><span>$2.2k</span><span>$2.0k</span></div><div className="chart"><div className="gridline g1"/><div className="gridline g2"/><div className="gridline g3"/><svg viewBox="0 0 660 190" preserveAspectRatio="none" aria-label="Portfolio value trending upward"><defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#356d52" stopOpacity=".18"/><stop offset="100%" stopColor="#356d52" stopOpacity="0"/></linearGradient></defs><path d="M0 156 C25 148 32 164 58 140 S91 147 113 129 S145 138 170 112 S197 119 224 104 S260 121 284 91 S323 101 344 81 S382 99 404 68 S446 87 465 60 S507 80 530 42 S570 67 592 37 S628 52 660 17 L660 190 L0 190Z" fill="url(#fill)"/><path d="M0 156 C25 148 32 164 58 140 S91 147 113 129 S145 138 170 112 S197 119 224 104 S260 121 284 91 S323 101 344 81 S382 99 404 68 S446 87 465 60 S507 80 530 42 S570 67 592 37 S628 52 660 17" fill="none" stroke="#356d52" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/><circle cx="660" cy="17" r="5" fill="#356d52" stroke="white" strokeWidth="3" vectorEffect="non-scaling-stroke"/></svg><div className="chart-x"><span>SEP 23</span><span>SEP 28</span><span>OCT 3</span><span>OCT 8</span><span>OCT 13</span><span>OCT 18</span><span>OCT 22</span></div></div></div></div>
            <div className="insight-card"><div className="insight-head"><span className="insight-icon"><Sparkles size={15} /></span><span>COLLECTOR INSIGHT</span><span className="new-tag">NEW</span></div><h3>Charizard is on a<br /><em>little hot streak.</em></h3><p>Your Obsidian Flames Charizard ex is up 8.4% this week. It’s now the most valuable card in your collection.</p><div className="insight-foot"><span>Based on recent market sales</span><span className="insight-spark">⌁</span></div><div className="insight-decoration">✳</div></div></section>
          <section className="collection-section"><div className="section-heading"><div><div className="section-kicker">A FEW OF YOUR FAVORITES</div><h2>Recently added <span className="subtle-count">{cards.length} cards</span></h2></div><button className="text-button" onClick={() => setView("My collection")}>View collection <ArrowRight size={14} /></button></div><CardGrid cards={cards.slice(0, 4)} addToCart={addToCart} saved={saved} setSaved={setSaved} mode="portfolio" setCards={setCards} notify={notify} /></section>
        </>}

        {view !== "Overview" && <section className="collection-section full-collection"><div className="section-heading"><div><div className="section-kicker">{view === "Marketplace" ? "GOOD CARDS, GOOD HOMES" : "JUST FOR YOUR EYES"}</div><h2>{view === "Marketplace" ? "Shop the marketplace" : "Your collection"} <span className="subtle-count">{view === "Marketplace" ? listedCards.length : cards.length} cards</span></h2></div>{view === "Marketplace" ? <button className="primary-button compact-button" onClick={() => setModal("sell")}><Plus size={15} /> List a card</button> : <button className="primary-button compact-button" onClick={() => setModal("scan")}><Camera size={15} /> Add a card</button>}</div><div className="filter-row"><label className="search-box"><Search size={16} /><input placeholder="Search cards, sets, grades…" value={query} onChange={(e) => setQuery(e.target.value)} /><kbd>⌘ K</kbd></label><button className="filter-button" onClick={() => setFilter(filter === "On sale" ? "All cards" : "On sale")}><SlidersHorizontal size={15} /> {filter === "All cards" ? "Filters" : filter} <ChevronDown size={14} /></button><div className="filter-chips"><button className={filter === "All cards" ? "chip selected" : "chip"} onClick={() => setFilter("All cards")}>All cards</button><button className={filter === "On sale" ? "chip selected" : "chip"} onClick={() => setFilter("On sale")}>On sale</button><button className="chip">Pokémon <X size={12}/></button></div></div>{filtered.length ? <CardGrid cards={filtered} addToCart={addToCart} saved={saved} setSaved={setSaved} mode={view === "Marketplace" ? "market" : "portfolio"} setCards={setCards} notify={notify} /> : <div className="empty-state"><div className="empty-icon"><ShoppingBag size={23}/></div><h3>{view === "Marketplace" ? "A little quiet around here." : "No cards found."}</h3><p>{view === "Marketplace" ? "There are no cards listed yet. Check back soon, or list one from your collection." : "Try a different search, or add your first card."}</p>{view === "Marketplace" && <button className="primary-button compact-button" onClick={() => setModal("sell")}>List your first card <ArrowRight size={14}/></button>}</div>}</section>}
      </div>
    </section>

    {cart.length > 0 && <button className="cart-float" onClick={() => setModal("cart")}><ShoppingBag size={16}/> Cart <span>{cart.length}</span></button>}
    {notice && <div className="toast"><Check size={16}/>{notice}</div>}
    {modal && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}><div className="modal"><button className="modal-close" onClick={() => setModal(null)}><X size={18}/></button>{modal === "scan" ? <><div className="modal-icon"><Camera size={19}/></div><div className="section-kicker">ADD TO YOUR COLLECTION</div><h2>Let’s find your card.</h2><p>Take a photo to identify the card, then check its current TCGDB market price.</p><button className="upload-box" disabled={scanLoading} onClick={() => fileRef.current?.click()}><Upload size={20}/><b>{scanLoading ? "Identifying your card…" : "Choose a card photo"}</b><span>JPEG, PNG or WebP · optimized on your device</span></button><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ""; void handleScan(file); }}/>{scanError && <p className="scan-error">{scanError}</p>}{scanCandidates.length > 0 && <div className="scan-candidates">{scanCandidates.map((candidate) => <div className="scan-result" key={`${candidate.game}-${candidate.set}-${candidate.cardNumber}-${candidate.name}`}><div className="scan-result-icon">✳</div><div className="scan-candidate-info"><small>{scanStatus === "matched" ? "MATCHED PRINTING" : "POSSIBLE MATCH"}</small><b>{candidate.name}</b><span>{candidate.set} · {candidate.cardNumber} · {candidate.game}</span><span>{Math.round((candidate.confidence || 0) * 100)}% match confidence</span></div><button className="primary-button compact-button" disabled={scanLoading} onClick={() => addScannedCard(candidate)}>{scanLoading ? "Getting price…" : "Add card"}</button></div>)}</div>}{scanStatus && scanCandidates.length === 0 && <p className="scan-error">No confident catalog match was found. Try a clear photo with the card number visible.</p>}<div className="modal-footnote"><Sparkles size={13}/> Repeated scans of the same photo are cached for 30 days.</div></> : modal === "sell" ? <><div className="modal-icon"><Tag size={19}/></div><div className="section-kicker">YOUR MARKETPLACE LISTING</div><h2>Find a new home for it.</h2><p>Choose a card in your private collection and set the price you want buyers to see.</p><label className="field-label">CARD TO LIST<select id="listing-card">{cards.filter((c) => !c.listed).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.grade}</option>)}</select></label><label className="field-label">YOUR ASKING PRICE<div className="price-input"><span>$</span><input id="listing-price" type="number" min="1" step=".01" placeholder="0.00"/><span className="price-hint">USD</span></div></label><div className="market-value-note"><CircleDollarSign size={15}/><span>The card’s market estimate stays private. Buyers see your asking price.</span></div><button className="primary-button modal-submit" onClick={saveListing}>Publish listing <ArrowRight size={15}/></button></> : <><div className="modal-icon"><ShoppingBag size={19}/></div><div className="section-kicker">YOUR BAG</div><h2>Nice picks.</h2><p>Your marketplace cart is ready for checkout.</p><div className="cart-items">{cart.map((id) => { const card = cards.find((c) => c.id === id); return card ? <div className="cart-item" key={id}><div className={`mini-card-art ${card.color}`}>{card.mark}</div><div><b>{card.name}</b><span>{card.grade}</span></div><strong>{currency(card.listed || card.price)}</strong></div> : null; })}</div><div className="cart-total"><span>Subtotal</span><b>{currency(cart.reduce((sum, id) => { const card = cards.find((c) => c.id === id); return sum + (card?.listed || card?.price || 0); }, 0))}</b></div><button className="primary-button modal-submit" onClick={() => notify("Checkout will be available when payments are connected")}>Continue to checkout <ArrowRight size={15}/></button><p className="checkout-note">Secure checkout will be enabled with Stripe.</p></>}</div></div>}
  </main>;
}

function CardGrid({ cards, addToCart, saved, setSaved, mode, setCards, notify }: { cards: Card[]; addToCart: (id: number) => void; saved: number[]; setSaved: (fn: (old: number[]) => number[]) => void; mode: "portfolio" | "market"; setCards: (fn: (old: Card[]) => Card[]) => void; notify: (message: string) => void }) {
  return <div className="card-grid">{cards.map((card, index) => <article className="trading-card" key={card.id} style={{ animationDelay: `${index * 45}ms` }}><div className={`card-art ${card.color}`}><div className="art-glow"/><span className="art-brand">{card.category === "Pokémon" ? "Pokémon" : "TRADING CARD"}</span><span className="art-mark">{card.mark}</span><span className="art-title">{card.name}</span><span className="art-set">{card.set.split(" · ")[0]}</span><span className="art-bottom"><span>{card.rarity}</span><span>{card.number}</span></span><button className={`favorite ${saved.includes(card.id) ? "is-saved" : ""}`} aria-label="Save card" onClick={() => setSaved((old) => old.includes(card.id) ? old.filter((id) => id !== card.id) : [...old, card.id])}><Heart size={15} fill={saved.includes(card.id) ? "currentColor" : "none"}/></button>{card.grade.startsWith("PSA") && <span className="grade-label">{card.grade}</span>}</div><div className="card-info"><div className="card-title-line"><h3>{card.name}</h3><span className="card-condition">{card.grade === "Ungraded" ? "RAW" : card.grade}</span></div><div className="card-setline">{card.set}</div><div className="card-pricing"><div><span className="card-price">{mode === "market" && card.listed ? currency(card.listed) : currency(card.price)}</span><span className="market-caption">{mode === "market" ? "ASKING PRICE" : "MARKET VALUE"}</span></div><span className={`trend ${card.trend < 0 ? "down" : ""}`}>{card.trend < 0 ? <ArrowDownRight size={13}/> : <ArrowUpRight size={13}/>} {Math.abs(card.trend)}%</span></div>{mode === "market" ? <button className="buy-button" onClick={() => addToCart(card.id)}>Add to cart <ShoppingBag size={14}/></button> : card.listed ? <div className="listed-row"><span className="listed-dot"/> Listed for {currency(card.listed)}<button onClick={() => { setCards((all) => all.map((item) => item.id === card.id ? { ...item, listed: undefined } : item)); notify("Listing removed from marketplace"); }}>Remove</button></div> : <button className="sell-link" onClick={() => notify("Open Marketplace → List a card to set your asking price")}>List for sale <ArrowRight size={13}/></button>}</div></article>)}</div>;
}
