"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { z } from "zod";

const credentialsSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(8).max(128), displayName: z.string().trim().min(2).max(60).optional() });

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const authError = new URLSearchParams(window.location.search).get("authError");
    if (authError) setMessage(authError);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage("");
    if (!supabase) { setMessage("Supabase is not configured. Add its URL and anon key to .env.local, then restart the server."); return; }
    const parsed = credentialsSchema.safeParse({ email, password, ...(mode === "signup" ? { displayName } : {}) });
    if (!parsed.success) { setMessage(parsed.error.issues[0]?.message || "Check your account details."); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: parsed.data.email, password: parsed.data.password, options: { data: { display_name: parsed.data.displayName }, emailRedirectTo: `${window.location.origin}/auth/callback` } });
        if (error) throw error;
        if (!data.session) { setMessage("Check your email to confirm your account, then sign in."); return; }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
        if (error) throw error;
      }
      const requested = new URLSearchParams(window.location.search).get("next");
      router.replace(requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Authentication failed."); }
    finally { setBusy(false); }
  }

  return <main className="auth-screen"><div className="auth-card"><Link className="brand auth-brand" href="/"><span className="brand-icon">c.</span><span>cardhaus<span className="brand-dot">.</span></span></Link><div className="auth-icon"><LockKeyhole size={18}/></div><div className="section-kicker">YOUR COLLECTION, YOUR SPACE</div><h1>{mode === "signin" ? "Welcome back." : "Join the collectors."}</h1><p>{mode === "signin" ? "Sign in to see your collection and shop the market." : "Create an account to track cards and find your next favorite."}</p><form onSubmit={submit} className="auth-form">{mode === "signup" && <label>Name<input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name"/></label>}<label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"/></label><label>Password<input required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"}/></label>{message && <div className="auth-message">{message}</div>}<button className="primary-button auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}<ArrowRight size={15}/></button></form><div className="auth-switch">{mode === "signin" ? "New to Cardhaus?" : "Already have an account?"}<button onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>{mode === "signin" ? "Create account" : "Sign in"}</button></div><div className="auth-private"><LockKeyhole size={12}/> Your collection is private to your account.</div></div><div className="auth-side-note">A good day to<br/><em>collect something.</em><span>Find your people. Keep what you love.</span></div></main>;
}
