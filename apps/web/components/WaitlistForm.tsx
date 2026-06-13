"use client";

// Launch-waitlist / newsletter signup ("M'avertir du lancement").
// Single opt-in: POSTs the email to the API, which stores it directly. On
// success we swap the form for a thank-you message. Mirrors the form markup
// previously inlined in Download.tsx so the visual layout is unchanged.

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type State = "idle" | "loading" | "success" | "error";

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "loading") return;
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`${API_URL}/newsletter/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, source: "landing" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          message?: string | string[];
        };
        const msg = Array.isArray(body.message)
          ? body.message.join(", ")
          : body.message;
        throw new Error(msg || "Une erreur est survenue. Réessaie.");
      }
      setState("success");
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Impossible de t'inscrire pour le moment. Réessaie.",
      );
    }
  }

  if (state === "success") {
    return (
      <div className="mx-auto mt-10 max-w-md rounded-2xl border border-white/15 bg-white/10 px-6 py-5 text-center backdrop-blur">
        <p className="font-serif text-lg font-bold text-white">
          Merci&nbsp;! 🎉
        </p>
        <p className="mt-1 text-sm text-white/70">
          On te préviendra dès le lancement de NigerConnect.
        </p>
      </div>
    );
  }

  return (
    <>
      <form
        onSubmit={onSubmit}
        className="mx-auto mt-10 flex max-w-md flex-col gap-2 sm:flex-row"
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state === "loading"}
          placeholder="ton@email.com"
          aria-label="Adresse email"
          className="flex-1 rounded-full border border-white/15 bg-white/10 px-5 py-3.5 text-sm text-white placeholder-white/40 outline-none transition focus:border-brand-orange focus:bg-white/15 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={state === "loading"}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-70"
        >
          {state === "loading" ? "Inscription…" : "M'avertir du lancement"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-xs text-red-300">
          {error}
        </p>
      ) : (
        <p className="mt-3 text-xs text-white/50">
          Pas de spam. Tu recevras un seul email : celui du lancement.
        </p>
      )}
    </>
  );
}
