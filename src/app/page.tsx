"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen, Camera, Check, ChevronDown, CircleDollarSign, LayoutDashboard, LoaderCircle, LogOut, PackageCheck, Plus, Search, ShoppingBag, SlidersHorizontal, Sparkles, Tag, TrendingUp, Upload, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type View = "Overview" | "Card catalog" | "Marketplace" | "My collection" | "My orders" | "Store manager";
type Card = { id: string; name: string; set_name: string; card_number: string; game: string; rarity: string | null; image_url: string | null; market_value: number | null; price_updated_at: string | null };
type PortfolioItem = { id: string; quantity: number; condition: string; grade: string; purchase_price: number | null; card: Card };
type Listing = { id: string; asking_price: number; quantity: number; discount_percent: number; discount_min_quantity: number; discount_starts_at: string | null; discount_ends_at: string | null; status: string; card: Card };
type Order = { id: string; buyer_id: string; buyer_name: string; buyer_email: string; shipping_address: string; subtotal: number; status: string; created_at: string; items: { id: string; card_name_snapshot: string; set_snapshot: string; quantity: number; unit_price: number }[] };
type Candidate = { name: string; set: string; cardNumber: string; game: string; rarity?: string; confidence?: number; imageUrl?: string | null };
type Dashboard = { marketValue: number; costBasis: number; unrealizedProfit: number; realizedProfit: number; listedValue: number; cardCount: number; history: { snapshot_date: string; market_value: number; cost_basis: number }[] };
type CartLine = { listingId: string; quantity: number };
const currency = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount || 0);

async function compressPhoto(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Use a JPEG, PNG, or WebP image.");
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 7; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d"); if (!context) throw new Error("This browser cannot process the image.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", Math.max(.58, .84 - attempt * .04)));
      if (blob && blob.size <= 3.8 * 1024 * 1024) return new File([blob], "card-scan.jpg", { type: "image/jpeg", lastModified: file.lastModified });
      scale *= .78;
    }
    throw new Error("Could not compress this photo enough to upload.");
  } finally { bitmap.close(); }
}

function activeDiscount(listing: Listing, quantity = 1) {
  const now = Date.now();
  const inWindow = (!listing.discount_starts_at || new Date(listing.discount_starts_at).getTime() <= now) && (!listing.discount_ends_at || new Date(listing.discount_ends_at).getTime() > now);
  return listing.discount_percent > 0 && inWindow && quantity >= listing.discount_min_quantity;
}
function salePrice(listing: Listing, quantity = 1) { return Math.round(listing.asking_price * (activeDiscount(listing, quantity) ? 1 - listing.discount_percent / 100 : 1) * 100) / 100; }

export default function Home() {
  const router = useRouter();
  const [view, setView] = useState<View>("Overview");
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [collection, setCollection] = useState<PortfolioItem[]>([]);
  const [catalog, setCatalog] = useState<Card[]>([]);
  const [catalogGames, setCatalogGames] = useState<string[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogGame, setCatalogGame] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [catalogAdding, setCatalogAdding] = useState("");
  const [market, setMarket] = useState<Listing[]>([]);
  const [ownerListings, setOwnerListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [apiPending, setApiPending] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"scan" | "cart" | "listing" | "edit" | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [scanSuccess, setScanSuccess] = useState("");
  const [showScanDetails, setShowScanDetails] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanUnmatched, setScanUnmatched] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [marketPrice, setMarketPrice] = useState<number | null>(null);
  const [priceBusy, setPriceBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [editingItem, setEditingItem] = useState<PortfolioItem | null>(null);
  const [listingItem, setListingItem] = useState<PortfolioItem | null>(null);
  const [filter, setFilter] = useState<"all" | "sale">("all");
  const fileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const catalogLoaded = useRef(false);
  const catalogOffset = useRef(0);
  const catalogRequest = useRef(0);

  useEffect(() => {
    if (modal !== "scan" || !cameraActive) return;
    let cancelled = false;
    setCameraStarting(true);
    setCameraReady(false);
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Live camera is not available in this browser. Choose a photo to scan instead.");
      setCameraStarting(false);
      return;
    }
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }
        cameraStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraStarting(false);
      })
      .catch(() => {
        if (!cancelled) {
          setCameraError("Allow camera access to scan live, or choose a photo from your device.");
          setCameraStarting(false);
        }
      });
    return () => {
      cancelled = true;
      cameraStreamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
      cameraStreamRef.current = null;
    };
  }, [modal, cameraActive]);

  const trackedFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    setApiPending((count) => count + 1);
    try { return await fetch(input, init); }
    finally { setApiPending((count) => Math.max(0, count - 1)); }
  }, []);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true);
    setError("");
    try {
      const meRes = await trackedFetch("/api/me", { cache: "no-store" });
      if (!meRes.ok) throw new Error((await meRes.json()).error || "Please sign in again.");
      const me = await meRes.json(); setUser(me.user); setIsOwner(Boolean(me.profile?.is_store_owner));
      const jobs = [trackedFetch("/api/portfolio", { cache: "no-store" }), trackedFetch("/api/marketplace", { cache: "no-store" }), trackedFetch("/api/dashboard", { cache: "no-store" }), trackedFetch("/api/orders", { cache: "no-store" })];
      if (me.profile?.is_store_owner) jobs.push(trackedFetch("/api/listings", { cache: "no-store" }));
      const responses = await Promise.all(jobs);
      const values = await Promise.all(responses.map(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.error || "Could not load your account."); return value; }));
      setCollection(values[0].items || []); setMarket(values[1].listings || []); setDashboard(values[2]); setOrders(values[3].orders || []); setOwnerListings(me.profile?.is_store_owner ? values[4].listings || [] : []);
      try { setCart(JSON.parse(localStorage.getItem(`cardhaus-cart-${me.user.id}`) || "[]")); } catch { setCart([]); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load Cardhaus."); }
    finally { if (!quiet) setBusy(false); }
  }, [trackedFetch]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => { if (user) localStorage.setItem(`cardhaus-cart-${user.id}`, JSON.stringify(cart)); }, [cart, user]);

  const loadCatalog = useCallback(async (reset = true, search = catalogSearch, game = catalogGame) => {
    const requestId = ++catalogRequest.current;
    const offset = reset ? 0 : catalogOffset.current;
    setCatalogBusy(true); setCatalogError("");
    if (reset) setCatalogRefreshing(true);
    try {
      const params = new URLSearchParams({ offset: String(offset) });
      if (search.trim()) params.set("q", search.trim());
      if (game) params.set("game", game);
      const response = await trackedFetch(`/api/catalog?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load the card catalog.");
      if (requestId !== catalogRequest.current) return;
      setCatalog((current) => reset ? result.cards || [] : [...current, ...(result.cards || [])]);
      setCatalogGames(result.games || []);
      catalogOffset.current = offset + (result.cards?.length || 0);
      setCatalogHasMore(Boolean(result.hasMore)); catalogLoaded.current = true;
    } catch (cause) {
      if (requestId === catalogRequest.current) setCatalogError(cause instanceof Error ? cause.message : "Could not load the card catalog.");
    } finally { if (requestId === catalogRequest.current) { setCatalogBusy(false); setCatalogRefreshing(false); } }
  }, [catalogSearch, catalogGame, trackedFetch]);

  useEffect(() => {
    if (view !== "Card catalog") return;
    const delay = catalogLoaded.current ? 250 : 0;
    const timer = window.setTimeout(() => { void loadCatalog(true, catalogSearch, catalogGame); }, delay);
    return () => window.clearTimeout(timer);
  }, [view, catalogSearch, catalogGame, loadCatalog]);

  function notify(text: string) { setNotice(text); window.setTimeout(() => setNotice(""), 3000); }
  async function api(url: string, method = "GET", body?: unknown) {
    const response = await trackedFetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || "Request failed."); return value;
  }
  async function signOut() { if (supabase) await supabase.auth.signOut(); router.replace("/login"); router.refresh(); }
  const filteredMarket = useMemo(() => market.filter((listing) => {
    const text = `${listing.card.name} ${listing.card.set_name} ${listing.card.card_number} ${listing.card.game}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (filter === "all" || listing.discount_percent > 0);
  }), [market, query, filter]);
  const cartRows = useMemo(() => cart.map((line) => ({ line, listing: market.find((item) => item.id === line.listingId) })).filter((row): row is { line: CartLine; listing: Listing } => Boolean(row.listing)), [cart, market]);
  const cartTotal = cartRows.reduce((sum, row) => sum + salePrice(row.listing, row.line.quantity) * row.line.quantity, 0);

  async function scan(file?: File) {
    if (!file) return;
    setCameraActive(false); setCandidates([]); setSelected(null); setMarketPrice(null); setImageBusy(false); setScanError(""); setScanSuccess(""); setScanUnmatched(false); setScanBusy(true);
    try {
      const compressed = await compressPhoto(file); const form = new FormData(); form.append("image", compressed);
      const response = await trackedFetch("/api/tcg/identify", { method: "POST", body: form });
      const body = await response.json(); if (!response.ok || !body.success) throw new Error(body.error || "Card identification failed.");
      const rawCandidates = body.data?.candidates?.length ? body.data.candidates : body.data ? [body.data] : [];
      const list: Candidate[] = rawCandidates.map((candidate: any) => ({
        ...candidate,
        imageUrl: candidate.imageUrl || candidate.image_url || candidate.image || body.data?.cardImageUrl || null,
      }));
      setCandidates(list);
      if (!list.length) {
        setScanUnmatched(true);
        setScanError("TCGDB could not match this card. Try again with a clearer photo and the full card number visible.");
        return;
      }
      await chooseCandidate(list[0]);
    } catch (cause) { setScanError(cause instanceof Error ? cause.message : "Could not identify this card."); }
    finally { setScanBusy(false); }
  }
  async function captureCard() {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("This browser could not capture the camera frame. Choose a photo to scan instead.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (blob) void scan(new File([blob], "card-scan.jpg", { type: "image/jpeg" }));
  }
  function resetScanner() {
    setCandidates([]); setSelected(null); setMarketPrice(null); setImageBusy(false); setScanError(""); setScanSuccess(""); setScanUnmatched(false); setShowScanDetails(false); setCameraActive(true);
  }
  function openScanner() {
    resetScanner();
    setModal("scan");
  }
  async function chooseCandidate(candidate: Candidate) {
    setSelected(candidate); setMarketPrice(null); setPriceBusy(true); setImageBusy(true); setScanError("");
    try {
      const details = { cardName: candidate.name, set: candidate.set, cardNumber: candidate.cardNumber, game: candidate.game };
      const [priceResult, imageResult] = await Promise.allSettled([
        api("/api/tcg/price", "POST", details),
        api("/api/tcg/image", "POST", details),
      ]);
      if (priceResult.status === "fulfilled" && typeof priceResult.value.marketValue === "number") setMarketPrice(priceResult.value.marketValue);
      else if (priceResult.status === "rejected") setScanError(priceResult.reason instanceof Error ? priceResult.reason.message : "Could not look up this card's price.");
      if (imageResult.status === "fulfilled" && typeof imageResult.value.imageUrl === "string") {
        setSelected((current) => current === candidate ? { ...candidate, imageUrl: imageResult.value.imageUrl } : current);
      }
    } catch (cause) { setScanError(cause instanceof Error ? cause.message : "Could not look up this card's price."); }
    finally { setPriceBusy(false); setImageBusy(false); }
  }
  async function addScannedCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget);
    setSaveBusy(true);
    try {
      const saved = await api("/api/portfolio", "POST", { name: selected.name, set: selected.set, cardNumber: selected.cardNumber, game: selected.game, rarity: selected.rarity, imageUrl: selected.imageUrl, condition: form.get("condition"), grade: form.get("grade"), quantity: form.get("quantity"), purchasePrice: form.get("purchasePrice") });
      setScanSuccess(saved.priceUnavailable ? "Added to your collection. No market estimate is available yet." : "Added to your collection.");
      setCandidates([]); setSelected(null); setMarketPrice(null); setScanError(""); setShowScanDetails(false); setCameraActive(true);
      await loadData(true);
    } catch (cause) { setScanError(cause instanceof Error ? cause.message : "Could not save card."); }
    finally { setSaveBusy(false); }
  }
  async function addCatalogCard(card: Card) {
    setCatalogAdding(card.id);
    try {
      const result = await api("/api/portfolio", "POST", { name: card.name, set: card.set_name, cardNumber: card.card_number, game: card.game, rarity: card.rarity, imageUrl: card.image_url, condition: "Near Mint", grade: "Ungraded", quantity: 1, purchasePrice: "" });
      await loadData(true);
      notify(result.priceUnavailable ? "Card added. No current market estimate is available." : "Card added to your private collection.");
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Could not add card to your collection."); }
    finally { setCatalogAdding(""); }
  }
  async function saveCollectionEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editingItem) return; const form = new FormData(event.currentTarget);
    setFormBusy(true);
    try { await api("/api/portfolio", "PATCH", { id: editingItem.id, quantity: form.get("quantity"), purchasePrice: form.get("purchasePrice"), grade: form.get("grade"), condition: form.get("condition") }); setModal(null); await loadData(true); notify("Collection item updated."); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Could not update card."); }
    finally { setFormBusy(false); }
  }
  async function removeCollectionItem(item: PortfolioItem) {
    if (!window.confirm(`Remove ${item.card.name} from your collection?`)) return;
    try { await api(`/api/portfolio?id=${encodeURIComponent(item.id)}`, "DELETE"); await loadData(true); notify("Card removed from your collection."); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Could not remove card."); }
  }
  async function publishListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!listingItem) return; const form = new FormData(event.currentTarget);
    setFormBusy(true);
    try { await api("/api/listings", "POST", { collectionItemId: listingItem.id, askingPrice: form.get("askingPrice"), discountPercent: form.get("discountPercent"), discountMinQuantity: form.get("discountMinQuantity"), discountStartsAt: form.get("discountStartsAt") || null, discountEndsAt: form.get("discountEndsAt") || null }); setModal(null); await loadData(true); notify("Your store listing is live."); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Could not publish listing."); }
    finally { setFormBusy(false); }
  }
  async function addCart(listing: Listing) {
    setCart((current) => { const found = current.find((item) => item.listingId === listing.id); if (found) return current.map((item) => item.listingId === listing.id ? { ...item, quantity: Math.min(listing.quantity, item.quantity + 1) } : item); return [...current, { listingId: listing.id, quantity: 1 }]; });
    notify("Added to your cart.");
  }
  function setCartQuantity(id: string, quantity: number) { setCart((items) => quantity <= 0 ? items.filter((line) => line.listingId !== id) : items.map((line) => line.listingId === id ? { ...line, quantity } : line)); }
  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setFormBusy(true);
    try { const result = await api("/api/orders", "POST", { items: cartRows.map(({ line }) => ({ listingId: line.listingId, quantity: line.quantity })), name: form.get("name"), email: form.get("email"), address: form.get("address") }); setCart([]); setModal(null); setView("My orders"); await loadData(true); notify(`Order ${String(result.orderId).slice(0, 8)} placed. The store will contact you to arrange payment and delivery.`); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Checkout failed."); }
    finally { setFormBusy(false); }
  }
  async function changeOrder(order: Order, action: "complete" | "cancel") {
    try { await api(`/api/orders/${order.id}`, "PATCH", { action }); await loadData(true); notify(action === "complete" ? "Order completed; the buyer's collection is updated." : "Order cancelled and inventory restored."); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Order update failed."); }
  }
  async function changeListing(listing: Listing, updates: Record<string, unknown>) {
    try { await api("/api/listings", "PATCH", { id: listing.id, ...updates }); await loadData(true); notify("Listing updated."); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Could not update listing."); }
  }

  const ownerOrders = isOwner ? orders : [];
  return <main className="app-shell">
    <aside className="sidebar"><a className="brand" href="#home"><span className="brand-icon">c.</span><span>cardhaus<span className="brand-dot">.</span></span></a>
      <div className="workspace"><div className="avatar">{user?.email?.[0]?.toUpperCase() || "C"}</div><div><b>{isOwner ? "Cardhaus store" : "Collector account"}</b><small>{user?.email}</small></div><ChevronDown size={15}/></div>
      <span className="nav-caption">WORKSPACE</span><nav>{([ ["Overview", LayoutDashboard], ["Card catalog", BookOpen], ["Marketplace", ShoppingBag], ["My collection", Tag], ["My orders", PackageCheck], ...(isOwner ? [["Store manager", TrendingUp] as const] : []) ] as const).map(([label, Icon]) => <button key={label} className={`nav-link ${view === label ? "active" : ""}`} onClick={() => { setView(label as View); setQuery(""); }}><Icon size={17}/>{label === "Card catalog" ? "Catalog" : label}{label === "Marketplace" && <span className="nav-count">{market.length}</span>}{label === "My orders" && <span className="nav-count">{orders.length}</span>}</button>)}</nav>
      <div className="sidebar-card"><div className="side-spark"><Sparkles size={15}/></div><b>Your cards,<br/>your own little corner.</b><p>Keep your portfolio private, see what it’s worth, and shop one collector-owned store.</p><button onClick={openScanner}><Plus size={13}/> Add a card</button><div className="side-watermark">✳</div></div>
      <div className="profile"><div className="avatar profile-avatar">{user?.email?.[0]?.toUpperCase() || "C"}</div><div><b>{user?.email}</b><small>{isOwner ? "Store owner" : "Collector"}</small></div><button className="logout-button" title="Sign out" onClick={signOut}><LogOut size={15}/></button></div>
    </aside>

    <section className="main-area"><header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <b>{view}</b></div><div className="top-actions"><span className={`live-dot ${apiPending ? "request-active" : ""}`}/><span className={apiPending ? "api-request-status is-loading" : "api-request-status"} aria-live="polite">{apiPending ? <><LoaderCircle className="spin" size={12}/> {apiPending > 1 ? `${apiPending} requests in progress…` : "Request in progress…"}</> : busy ? "Loading your account…" : "Your collection is private"}</span><button className="icon-button notification" aria-label="Cart" onClick={() => setModal("cart")}><ShoppingBag size={18}/>{cart.length > 0 && <i/>}</button></div></header>
      <div className="content">
        <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line"/>{view === "Marketplace" ? "THE CARDHAUS STORE" : view === "Store manager" ? "SINGLE STORE CONTROL PANEL" : view === "Card catalog" ? "DIGITAL CARD LIBRARY" : "YOUR COLLECTION AT A GLANCE"}</div><h1>{view === "Overview" ? <>A good day to<br/><em>collect something.</em></> : view === "Card catalog" ? <>Browse the<br/><em>card catalog.</em></> : view === "Marketplace" ? <>Find your next<br/><em>favorite card.</em></> : view === "Store manager" ? <>Run your<br/><em>little card shop.</em></> : view === "My orders" ? <>Your orders,<br/><em>all in one place.</em></> : <>Your cards,<br/><em>beautifully tracked.</em></>}</h1><p className="intro">{view === "Overview" ? "A little snapshot of the cards you love and what they’re worth." : view === "Card catalog" ? "Explore digital card entries, view their artwork, and add copies to your private collection." : view === "Marketplace" ? "One store, thoughtful listings, prices set by the shop." : view === "Store manager" ? "Manage listings, discounts, inventory, and orders." : view === "My orders" ? "Check order status or review the cards you’ve purchased." : "Your collection is private. Only you can see these cards."}</p></div><div className="welcome-actions">{view === "Marketplace" && <button className="primary-button" onClick={() => setModal("cart")}><ShoppingBag size={15}/> Cart · {cart.length}</button>}{(view === "Overview" || view === "My collection" || view === "Card catalog") && <button className="primary-button scan-button" onClick={openScanner}><Camera size={16}/> Scan a card <span className="button-plus">+</span></button>}</div></section>

        {error && <div className="page-error">{error}{!user && <button onClick={() => router.push("/login")}>Sign in</button>}</div>}
        {busy && <AccountSkeleton />}

        {!busy && view === "Overview" && <>
          <section className="stats-grid"><Stat title="COLLECTION VALUE" value={dashboard?.marketValue == null ? "—" : currency(dashboard.marketValue)} icon={<CircleDollarSign size={17}/>} tone="green" note={dashboard?.history?.length ? `${dashboard.history.length} daily snapshots` : "Market estimates from TCG API"}/><Stat title="CARDS COLLECTED" value={`${dashboard?.cardCount || 0}`} icon={<Tag size={16}/>} tone="purple" note="Across your private portfolio"/><Stat title={isOwner ? "ACTIVE STORE LISTINGS" : "AVAILABLE IN STORE"} value={isOwner ? currency(dashboard?.listedValue || 0) : `${market.length} cards`} icon={<ShoppingBag size={16}/>} tone="yellow" note={isOwner ? "Current asking prices × stock" : "One independent storefront"}/><Stat title="UNREALIZED PROFIT / LOSS" value={`${(dashboard?.unrealizedProfit || 0) >= 0 ? "+" : "−"}${currency(Math.abs(dashboard?.unrealizedProfit || 0))}`} icon={<TrendingUp size={16}/>} tone="orange" positive={(dashboard?.unrealizedProfit || 0) >= 0} note={`Realized sales: ${currency(dashboard?.realizedProfit || 0)}`}/></section>
          <section className="dashboard-grid"><div className="chart-card"><div className="section-heading"><div><h2>Portfolio performance</h2><p>Daily market value snapshots, recorded when you open your dashboard.</p></div></div><div className="chart-summary"><span className="chart-total">{currency(dashboard?.marketValue || 0)}</span><span className={(dashboard?.unrealizedProfit || 0) >= 0 ? "growth small-growth" : "trend down"}>{(dashboard?.unrealizedProfit || 0) >= 0 ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>} {currency(Math.abs(dashboard?.unrealizedProfit || 0))} unrealized</span></div><div className="performance-list">{dashboard?.history?.length ? dashboard.history.slice(-8).map((point) => <div key={point.snapshot_date}><span>{new Date(`${point.snapshot_date}T00:00:00`).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</span><div className="performance-track"><i style={{ width: `${Math.max(2, Math.min(100, (point.market_value / Math.max(dashboard.marketValue, 1)) * 100))}%` }}/></div><b>{currency(point.market_value)}</b></div>) : <p className="empty-chart">Your portfolio value snapshots will appear here as you check back over time.</p>}</div></div><div className="insight-card"><div className="insight-head"><span className="insight-icon"><Sparkles size={15}/></span><span>COLLECTOR SNAPSHOT</span></div><h3>{collection.length ? <>Your collection has<br/><em>{collection.length} unique entries.</em></> : <>Your collection<br/><em>starts with one card.</em></>}</h3><p>{collection.length ? `${dashboard?.cardCount || 0} total cards. ${dashboard?.costBasis ? `You have tracked ${currency(dashboard.costBasis)} in purchase costs.` : "Add purchase prices to track your cost basis and profit."}` : "Scan a card to identify it, check its current estimate, and add it to your private portfolio."}</p><div className="insight-foot"><span>{collection.length ? "Private to your account" : "TCGDB identification · TCG API pricing"}</span><span className="insight-spark">⌁</span></div><div className="insight-decoration">✳</div></div></section>
          <section className="collection-section"><div className="section-heading"><div><div className="section-kicker">PRIVATE TO YOU</div><h2>Recently added <span className="subtle-count">{collection.length} entries</span></h2></div><button className="text-button" onClick={() => setView("My collection")}>View collection <ArrowRight size={14}/></button></div><PortfolioGrid items={collection.slice(0,4)} isOwner={isOwner} onEdit={(item) => { setEditingItem(item); setModal("edit"); }} onList={(item) => { setListingItem(item); setModal("listing"); }} onRemove={removeCollectionItem}/></section>
        </>}

        {!busy && view === "My collection" && <section className="collection-section full-collection"><div className="section-heading"><div><div className="section-kicker">JUST FOR YOUR EYES</div><h2>Your collection <span className="subtle-count">{collection.length} entries</span></h2></div><button className="primary-button compact-button" onClick={openScanner}><Camera size={15}/> Scan a card</button></div><div className="filter-row"><label className="search-box"><Search size={16}/><input placeholder="Search your cards…" value={query} onChange={(e) => setQuery(e.target.value)}/></label><span className="private-tag"><UserRound size={13}/> Private portfolio</span></div><PortfolioGrid items={collection.filter((item) => `${item.card.name} ${item.card.set_name} ${item.card.game}`.toLowerCase().includes(query.toLowerCase()))} isOwner={isOwner} onEdit={(item) => { setEditingItem(item); setModal("edit"); }} onList={(item) => { setListingItem(item); setModal("listing"); }} onRemove={removeCollectionItem}/></section>}

        {!busy && view === "Card catalog" && <section className="collection-section full-collection" aria-busy={catalogBusy}><div className="section-heading"><div><div className="section-kicker">DIGITAL CARD LIBRARY</div><h2>Browse cards <span className="subtle-count">{catalog.length}{catalogHasMore ? "+" : ""} shown</span></h2></div><button className="primary-button compact-button" onClick={openScanner}><Camera size={15}/> Scan a card</button></div><div className="filter-row catalog-filters"><label className="search-box"><Search size={16}/><input placeholder="Search card names…" value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)}/></label><label className="catalog-game-filter"><span>GAME</span><select value={catalogGame} onChange={(e) => setCatalogGame(e.target.value)}><option value="">All games</option>{catalogGames.map((game) => <option key={game} value={game}>{game}</option>)}</select></label></div>{catalogError && <div className="page-error">{catalogError}<button onClick={() => void loadCatalog(true)}>Retry</button></div>}{catalogRefreshing ? <CardSkeleton count={6} label="Loading catalog cards"/> : <CatalogGrid cards={catalog} collection={collection} addingId={catalogAdding} onAdd={addCatalogCard}/ >}{catalogHasMore && !catalogRefreshing && <button className="primary-button catalog-load-more" disabled={catalogBusy} onClick={() => void loadCatalog(false)}>{catalogBusy ? <><LoaderCircle className="spin" size={14}/> Loading…</> : "Load more cards"}</button>}</section>}

        {!busy && view === "Marketplace" && <section className="collection-section full-collection"><div className="section-heading"><div><div className="section-kicker">GOOD CARDS, ONE GOOD SHOP</div><h2>Shop the marketplace <span className="subtle-count">{filteredMarket.length} listings</span></h2></div><button className="primary-button compact-button" onClick={() => setModal("cart")}><ShoppingBag size={15}/> Cart · {cart.length}</button></div><div className="filter-row"><label className="search-box"><Search size={16}/><input placeholder="Search cards, sets, games…" value={query} onChange={(e) => setQuery(e.target.value)}/></label><button className="filter-button" onClick={() => setFilter(filter === "all" ? "sale" : "all")}><SlidersHorizontal size={15}/>{filter === "sale" ? "Discounted" : "Filters"}<ChevronDown size={14}/></button><button className={`chip ${filter === "sale" ? "selected" : ""}`} onClick={() => setFilter(filter === "sale" ? "all" : "sale")}>On sale</button></div><MarketGrid listings={filteredMarket} cart={cart} onAdd={addCart}/></section>}

        {!busy && view === "My orders" && <section className="collection-section full-collection"><div className="section-heading"><div><div className="section-kicker">ORDER HISTORY</div><h2>{isOwner ? "Store orders" : "Your orders"} <span className="subtle-count">{orders.length} total</span></h2></div></div><OrderList orders={orders} isOwner={isOwner} onAction={changeOrder}/></section>}

        {!busy && view === "Store manager" && isOwner && <><section className="stats-grid"><Stat title="ACTIVE LISTINGS" value={`${ownerListings.filter((x) => x.status === "active").length}`} icon={<Tag size={16}/>} tone="green" note="Visible to signed-in shoppers"/><Stat title="ASKING VALUE" value={currency(ownerListings.filter((x) => x.status === "active").reduce((sum, x) => sum + x.asking_price * x.quantity, 0))} icon={<CircleDollarSign size={17}/>} tone="purple" note="Before eligible discounts"/><Stat title="PENDING ORDERS" value={`${ownerOrders.filter((x) => x.status === "pending").length}`} icon={<ShoppingBag size={16}/>} tone="yellow" note="Arrange payment and delivery"/><Stat title="COMPLETED SALES" value={currency(dashboard?.realizedProfit || 0)} icon={<TrendingUp size={16}/>} tone="orange" note="Realized profit after recorded cost"/></section><section className="collection-section"><div className="section-heading"><div><div className="section-kicker">YOUR SINGLE STOREFRONT</div><h2>Store listings</h2></div><button className="text-button" onClick={() => setView("My collection")}>Choose inventory <ArrowRight size={14}/></button></div><ListingManager listings={ownerListings} onChange={changeListing}/></section><section className="collection-section"><div className="section-heading"><div><div className="section-kicker">FULFILLMENT</div><h2>Recent orders</h2></div><button className="text-button" onClick={() => setView("My orders")}>All orders <ArrowRight size={14}/></button></div><OrderList orders={ownerOrders.slice(0,5)} isOwner onAction={changeOrder}/></section></>}
      </div>
    </section>

    {cart.length > 0 && <button className="cart-float" onClick={() => setModal("cart")}><ShoppingBag size={16}/> Cart <span>{cart.length}</span></button>}
    {notice && <div className="toast"><Check size={16}/>{notice}</div>}
    {modal && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}><div className={`modal ${modal === "scan" ? "scan-modal" : ""}`}><button className="modal-close" onClick={() => setModal(null)}><X size={18}/></button>
      {modal === "scan" && <div className="scan-flow">
        <div className="scan-flow-heading"><div><div className="section-kicker">ADD TO YOUR PRIVATE COLLECTION</div><h2>{candidates.length ? "Review your match" : scanBusy ? "Finding your card…" : "Scan a card"}</h2><p>{candidates.length ? "Confirm the printing, then set quantity and condition." : "Frame one card at a time. Keep the set and card number in view."}</p></div><span className="scan-step">{candidates.length ? "02 / 02" : "01 / 02"}</span></div>
        {cameraActive && <>
          <div className={`scanner-view ${cameraError ? "scanner-view-fallback" : ""}`}>
            {!cameraError && <video ref={videoRef} autoPlay playsInline muted onLoadedData={() => setCameraReady(true)} aria-label="Live card camera preview" />}
            <div className="scanner-frame" aria-hidden="true"><i/><i/><i/><i/></div>
            <div className="scanner-hint">{cameraError ? <><Camera size={15}/> Camera unavailable</> : cameraStarting || !cameraReady ? <><LoaderCircle className="spin" size={13}/> Starting camera…</> : "Place the full card inside the frame"}</div>
            {cameraError && <button className="fallback-photo" onClick={() => fileInput.current?.click()}><Upload size={17}/><b>Choose a card photo</b><span>JPEG, PNG, or WebP</span></button>}
          </div>
          {cameraError && <p className="camera-error">{cameraError}</p>}
          <div className="scanner-controls"><button className="shutter-button" aria-label="Capture card" disabled={cameraStarting || !cameraReady || Boolean(cameraError)} onClick={() => void captureCard()}><span/></button><button className="scan-gallery-button" onClick={() => fileInput.current?.click()}><Upload size={16}/><span>Choose photo</span></button></div>
          {scanSuccess && <div className="scan-success"><Check size={16}/><span>{scanSuccess} <b>Scan the next card when you’re ready.</b></span></div>}
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void scan(file); }}/>
        </>}
        {!cameraActive && scanBusy && <div className="scan-processing" role="status"><LoaderCircle className="spin" size={25}/><b>Looking for your card…</b><span>Matching the name, set, and card number.</span></div>}
        {!cameraActive && !scanBusy && scanError && !scanUnmatched && candidates.length === 0 && <div className="scan-empty-match"><span className="scan-placeholder-mark">!</span><b>Could not identify this card</b><span>{scanError}</span><button className="primary-button" onClick={resetScanner}><Camera size={15}/> Try again</button></div>}
        {!cameraActive && !scanBusy && scanUnmatched && <div className="scan-empty-match"><span className="scan-placeholder-mark">?</span><b>No exact match found</b><span>{scanError || "Try a clearer photo with the full card number visible."}</span><button className="primary-button" onClick={resetScanner}><Camera size={15}/> Scan again</button></div>}
        {!cameraActive && !scanBusy && candidates.length > 0 && selected && <div className="scan-review">
          <div className="match-card-preview">{selected.imageUrl ? <img src={selected.imageUrl} alt={`${selected.name} card`} /> : <div className="match-card-placeholder">{imageBusy ? <LoaderCircle className="spin" size={24}/> : <Sparkles size={24}/>}<span>{imageBusy ? "Loading artwork" : selected.game}</span></div>}<div><div className="scan-match-badge"><Check size={12}/> MATCH FOUND</div><h3>{selected.name}</h3><p>{selected.set} · {selected.cardNumber}</p><strong>{priceBusy ? <><LoaderCircle className="spin" size={13}/> Checking market price…</> : marketPrice == null ? "Market estimate unavailable" : `${currency(marketPrice)} market estimate`}</strong></div></div>
          {candidates.length > 1 && <div className="scan-alternates"><div className="scan-alternates-heading">{candidates.length} possible matches <span>Tap to change</span></div><div className="scan-candidates">{candidates.map((candidate) => <button className={`candidate-option ${selected === candidate ? "chosen" : ""}`} key={`${candidate.game}-${candidate.set}-${candidate.cardNumber}`} onClick={() => void chooseCandidate(candidate)} disabled={priceBusy || saveBusy}><span><b>{candidate.name}</b><small>{candidate.set} · {candidate.cardNumber} · {candidate.game}</small></span><span>{selected === candidate ? "Selected" : `${Math.round((candidate.confidence || 0) * 100)}%`}</span></button>)}</div></div>}
          {scanError && <p className="scan-error">{scanError}</p>}
          <form className="scan-save-form" onSubmit={addScannedCard}><div className="form-grid"><label>Condition<select name="condition" defaultValue="Near Mint"><option>Near Mint</option><option>Lightly Played</option><option>Moderately Played</option><option>Heavily Played</option><option>Damaged</option></select></label><label>Quantity<input name="quantity" type="number" min="1" max="99" defaultValue="1"/></label></div>
            {showScanDetails && <div className="form-grid scan-extra-fields"><label>Grade<input name="grade" defaultValue="Ungraded"/></label><label>Purchase price<input name="purchasePrice" type="number" min="0" step=".01" placeholder="Optional"/></label></div>}
            <button className="scan-details-toggle" type="button" onClick={() => setShowScanDetails(!showScanDetails)}>{showScanDetails ? "Hide extra details" : "Add grade or purchase price"}<ChevronDown size={14}/></button>
            <button className="primary-button modal-submit" disabled={priceBusy || saveBusy}>{saveBusy ? <><LoaderCircle className="spin" size={15}/> Adding card…</> : <>Add to collection <ArrowRight size={15}/></>}</button>
          </form>
          <button className="scan-again-button" onClick={resetScanner}><Camera size={14}/> Scan another card</button>
        </div>}
        <div className="modal-footnote"><Sparkles size={13}/> Prices are estimates and may not match recent sale prices.</div>
      </div>}      {modal === "cart" && <><div className="modal-icon"><ShoppingBag size={19}/></div><div className="section-kicker">YOUR BAG</div><h2>{cartRows.length ? "Ready when you are." : "Your cart is empty."}</h2>{cartRows.length ? <><div className="cart-items">{cartRows.map(({ line, listing }) => <div className="cart-item" key={listing.id}><div className="mini-card-art teal">✳</div><div className="cart-item-title"><b>{listing.card.name}</b><span>{listing.card.set_name} · {currency(salePrice(listing,line.quantity))} each</span><div className="quantity-stepper"><button onClick={() => setCartQuantity(listing.id,line.quantity-1)}>−</button><span>{line.quantity}</span><button onClick={() => setCartQuantity(listing.id,line.quantity+1)} disabled={line.quantity >= listing.quantity}>+</button></div></div><strong>{currency(salePrice(listing,line.quantity)*line.quantity)}</strong></div>)}</div><div className="cart-total"><span>Subtotal</span><b>{currency(cartTotal)}</b></div><form className="checkout-form" onSubmit={checkout}><label>Your name<input required name="name" defaultValue={user?.email?.split("@")[0] || ""}/></label><label>Contact email<input required type="email" name="email" defaultValue={user?.email || ""}/></label><label>Shipping address<textarea required name="address" minLength={5} rows={2}/></label><button className="primary-button modal-submit" disabled={formBusy}>{formBusy ? "Placing order…" : "Place order"} {formBusy ? <LoaderCircle className="spin" size={15}/> : <ArrowRight size={15}/>}</button><p className="checkout-note">This creates a pending order. The store will contact you to arrange payment and delivery.</p></form></> : <p className="empty-copy">Browse the marketplace and add a card you love.</p>}</>}
      {modal === "listing" && listingItem && <><div className="modal-icon"><Tag size={19}/></div><div className="section-kicker">SINGLE-STORE LISTING</div><h2>Set your asking price.</h2><p>Buyers see your asking price, not the private market estimate. Set an optional quantity and date rule for your discount.</p><form className="checkout-form" onSubmit={publishListing}><div className="selected-card-note"><b>{listingItem.card.name}</b><span>{listingItem.card.set_name} · {listingItem.quantity} in portfolio</span><strong>Private market estimate: {currency(Number(listingItem.card.market_value) || 0)}</strong></div><label>Asking price<input required name="askingPrice" type="number" min=".01" step=".01" defaultValue={listingItem.card.market_value || ""}/></label><div className="form-grid"><label>Discount %<input name="discountPercent" type="number" min="0" max="100" defaultValue="0"/></label><label>Minimum quantity<input name="discountMinQuantity" type="number" min="1" defaultValue="1"/></label><label>Starts at<input name="discountStartsAt" type="datetime-local"/></label><label>Ends at<input name="discountEndsAt" type="datetime-local"/></label></div><button className="primary-button modal-submit" disabled={formBusy}>{formBusy ? "Publishing…" : "Publish listing"} {formBusy ? <LoaderCircle className="spin" size={15}/> : <ArrowRight size={15}/>}</button></form></>}
      {modal === "edit" && editingItem && <><div className="modal-icon"><Tag size={19}/></div><div className="section-kicker">PRIVATE PORTFOLIO</div><h2>Edit your card.</h2><p>{editingItem.card.name} · {editingItem.card.set_name}</p><form className="checkout-form" onSubmit={saveCollectionEdit}><div className="form-grid"><label>Quantity<input name="quantity" type="number" min="1" max="99" defaultValue={editingItem.quantity}/></label><label>Grade<input name="grade" defaultValue={editingItem.grade}/></label><label>Condition<select name="condition" defaultValue={editingItem.condition}><option>Near Mint</option><option>Lightly Played</option><option>Moderately Played</option><option>Heavily Played</option><option>Damaged</option></select></label><label>Purchase price<input name="purchasePrice" type="number" min="0" step=".01" defaultValue={editingItem.purchase_price ?? ""}/></label></div><button className="primary-button modal-submit" disabled={formBusy}>{formBusy ? "Saving…" : "Save changes"} {formBusy ? <LoaderCircle className="spin" size={15}/> : <Check size={15}/>}</button></form></>}
    </div></div>}
  </main>;
}

function Stat({ title, value, icon, tone, note, positive }: { title: string; value: string; icon: React.ReactNode; tone: string; note: string; positive?: boolean }) {
  return <div className="stat-card"><div className="stat-top"><span>{title}</span><span className={`stat-icon ${tone}-icon`}>{icon}</span></div><div className={`stat-number ${positive === undefined ? "" : positive ? "positive" : "negative"}`}>{value}</div><div className="stat-note">{note}</div></div>;
}

function PortfolioGrid({ items, isOwner, onEdit, onList, onRemove }: { items: PortfolioItem[]; isOwner: boolean; onEdit: (item: PortfolioItem) => void; onList: (item: PortfolioItem) => void; onRemove: (item: PortfolioItem) => void }) {
  if (!items.length) return <div className="empty-state"><div className="empty-icon"><Tag size={23}/></div><h3>Your collection starts here.</h3><p>Scan or add a card to create your private portfolio.</p></div>;
  return <div className="card-grid">{items.map((item, index) => { const current = Number(item.card.market_value) || 0; const cost = Number(item.purchase_price) || 0; return <article className="trading-card" key={item.id} style={{ animationDelay: `${index*35}ms` }}><CardArt card={item.card}/><div className="card-info"><div className="card-title-line"><h3>{item.card.name}</h3><span className="card-condition">{item.grade}</span></div><div className="card-setline">{item.card.set_name} · {item.card.card_number} · Qty {item.quantity}</div><div className="card-pricing"><div><span className="card-price">{item.card.market_value == null ? "—" : currency(current)}</span><span className="market-caption">{item.card.market_value == null ? "NO PRICE AVAILABLE" : "PRIVATE MARKET VALUE"}</span></div><span className={`trend ${cost && current < cost ? "down" : ""}`}>{item.card.market_value == null ? "No estimate" : cost ? `${current >= cost ? "+" : "−"}${currency(Math.abs(current-cost))}` : "Add cost"}</span></div><div className="item-actions"><button onClick={() => onEdit(item)}>Edit</button>{isOwner && <button onClick={() => onList(item)}>List in store</button>}<button className="remove-link" onClick={() => onRemove(item)}>Remove</button></div></div></article>; })}</div>;
}

function CatalogGrid({ cards, collection, addingId, onAdd }: { cards: Card[]; collection: PortfolioItem[]; addingId: string; onAdd: (card: Card) => void }) {
  if (!cards.length) return <div className="empty-state"><div className="empty-icon"><BookOpen size={22}/></div><h3>No catalog cards found.</h3><p>The shared digital catalog fills as cards are identified and added. Try another name or scan a card to add its match.</p></div>;
  return <div className="card-grid catalog-grid">{cards.map((card, index) => {
    const owned = collection.filter((item) => item.card.id === card.id).reduce((sum, item) => sum + item.quantity, 0);
    return <article className="trading-card digital-card" key={card.id} style={{ animationDelay: `${index * 25}ms` }}>
      <div className="digital-card-media"><CardArt card={card}/><span className="digital-card-stamp">DIGITAL CARD</span></div>
      <div className="card-info"><div className="card-title-line"><h3>{card.name}</h3><span className="card-condition">{card.game}</span></div>
        <div className="card-setline">{card.set_name} · {card.card_number}{card.rarity ? ` · ${card.rarity}` : ""}</div>
        <div className="card-pricing"><div><span className="card-price">{card.market_value == null ? "—" : currency(Number(card.market_value))}</span><span className="market-caption">{card.market_value == null ? "NO PRICE AVAILABLE" : "MARKET ESTIMATE"}</span></div>{owned > 0 && <span className="owned-card-count">{owned} owned</span>}</div>
        <button className="buy-button catalog-add-button" onClick={() => onAdd(card)} disabled={addingId === card.id}>{addingId === card.id ? "Adding…" : owned ? "Add another copy" : "Add to collection"}<Plus size={14}/></button>
      </div>
    </article>;
  })}</div>;
}

function CardArt({ card }: { card: Card }) {
  const [imageFailed, setImageFailed] = useState(false);
  const color = ["orange","yellow","purple","navy","pink","blue","violet","teal"][card.name.length % 8];
  const imageUrl = imageFailed ? null : card.image_url;
  const hasImage = Boolean(imageUrl);
  return <div className={`card-art ${hasImage ? "has-card-image" : `card-placeholder ${color}`}`}>
    {imageUrl ? <img src={imageUrl} alt={`${card.name} card`} loading="lazy" onError={() => setImageFailed(true)}/> : <div className="missing-card-art"><span className="missing-card-symbol">✳</span><span className="missing-card-game">{card.game}</span><span className="missing-card-name">{card.name}</span><span className="missing-card-label">IMAGE UNAVAILABLE</span></div>}
    <span className="art-bottom"><span>{card.rarity || card.game}</span><span>{card.card_number}</span></span>
  </div>;
}

function MarketGrid({ listings, cart, onAdd }: { listings: Listing[]; cart: CartLine[]; onAdd: (listing: Listing) => void }) {
  if (!listings.length) return <div className="empty-state"><div className="empty-icon"><ShoppingBag size={23}/></div><h3>No listings yet.</h3><p>The store owner is getting the shelves ready. Check back soon.</p></div>;
  return <div className="card-grid">{listings.map((listing,index) => { const discounted=activeDiscount(listing); const inCart=cart.some((item)=>item.listingId===listing.id); return <article className="trading-card" key={listing.id} style={{animationDelay:`${index*35}ms`}}><CardArt card={listing.card}/><div className="card-info"><div className="card-title-line"><h3>{listing.card.name}</h3><span className="card-condition">{listing.card.game}</span></div><div className="card-setline">{listing.card.set_name} · {listing.card.card_number} · {listing.quantity} available</div><div className="card-pricing"><div>{discounted && <span className="old-price">{currency(listing.asking_price)}</span>}<span className="card-price">{currency(salePrice(listing))}</span><span className="market-caption">STORE ASKING PRICE</span></div>{discounted && <span className="sale-pill">−{listing.discount_percent}%</span>}</div><button className="buy-button" onClick={()=>onAdd(listing)}>{inCart ? "Add another" : "Add to cart"}<ShoppingBag size={14}/></button></div></article>; })}</div>;
}

function OrderList({ orders, isOwner, onAction }: { orders: Order[]; isOwner: boolean; onAction: (order: Order, action: "complete"|"cancel") => void }) {
  if (!orders.length) return <div className="empty-state compact-empty"><div className="empty-icon"><PackageCheck size={21}/></div><h3>No orders yet.</h3><p>Your orders will show up here.</p></div>;
  return <div className="order-list">{orders.map((order)=> <article className="order-row" key={order.id}><div className="order-main"><div className="order-title"><b>Order #{order.id.slice(0,8)}</b><span className={`order-status ${order.status}`}>{order.status}</span></div><p>{order.items?.map((item)=>`${item.quantity} × ${item.card_name_snapshot}`).join(" · ")}</p><small>{isOwner ? `${order.buyer_name} · ${order.buyer_email}` : new Date(order.created_at).toLocaleDateString()} {order.shipping_address && isOwner ? `· ${order.shipping_address}` : ""}</small></div><div className="order-price"><b>{currency(order.subtotal)}</b>{order.status === "pending" && <div>{isOwner && <button onClick={()=>onAction(order,"complete")}>Mark fulfilled</button>}<button className="remove-link" onClick={()=>onAction(order,"cancel")}>Cancel</button></div>}</div></article>)}</div>;
}

function ListingManager({ listings, onChange }: { listings: Listing[]; onChange: (listing: Listing, updates: Record<string, unknown>) => void }) {
  if (!listings.length) return <div className="empty-state compact-empty"><div className="empty-icon"><Tag size={21}/></div><h3>The store is empty.</h3><p>Add your cards to your collection, then list them here.</p></div>;
  return <div className="order-list">{listings.map((listing)=> <article className="order-row" key={listing.id}><div className="order-main"><div className="order-title"><b>{listing.card.name}</b><span className={`order-status ${listing.status}`}>{listing.status}</span></div><p>{listing.card.set_name} · {listing.card.card_number} · {listing.quantity} available</p><small>Market estimate is private from buyers: {currency(Number(listing.card.market_value)||0)}{listing.discount_percent > 0 ? ` · ${listing.discount_percent}% off when buying ${listing.discount_min_quantity}+` : ""}</small></div><div className="order-price"><b>{currency(salePrice(listing))}</b>{listing.status !== "sold" && <div><button onClick={()=>onChange(listing,{status:listing.status==="active"?"withdrawn":"active"})}>{listing.status==="active"?"Withdraw":"Relist"}</button></div>}</div></article>)}</div>;
}

function AccountSkeleton() {
  return <section className="account-skeleton" aria-busy="true" aria-label="Loading your account">
    <span className="sr-only">Loading your collection…</span>
    <div className="skeleton-stats">{["first", "second", "third", "fourth"].map((key) => <div className="skeleton-block skeleton-stat" key={key}><i/><b/><small/></div>)}</div>
    <div className="skeleton-dashboard"><div className="skeleton-block skeleton-chart"><i/><b/><span/><span/><span/></div><div className="skeleton-block skeleton-insight"><i/><b/><b/><small/></div></div>
    <div className="skeleton-section-heading"><i/><b/></div>
    <CardSkeleton count={4} label="Loading collection cards" />
  </section>;
}

function CardSkeleton({ count, label }: { count: number; label: string }) {
  return <div className="card-grid skeleton-grid" role="status" aria-label={label}>
    {Array.from({ length: count }, (_, index) => `skeleton-${index}`).map((key) => <div className="skeleton-block skeleton-card" key={key} aria-hidden="true"><i/><b/><small/><span/></div>)}
  </div>;
}
