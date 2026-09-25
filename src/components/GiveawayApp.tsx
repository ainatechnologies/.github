"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchesKeyword, type ChatMessage } from "@/lib/youtube";

type Phase =
  | "setup"
  | "connected"
  | "open"
  | "closed"
  | "drawing"
  | "winner";

type DurationMode = 60 | 180 | 300 | 600 | "manual";

type Entrant = {
  channelId: string;
  displayName: string;
  profileImageUrl: string;
  message: string;
  timestamp: string;
};

type StreamInfo = {
  videoId: string;
  liveChatId: string;
  title: string;
  channelTitle: string;
  channelId: string;
  thumbnail: string;
};

type Audit = {
  startedAt: string;
  closedAt: string;
  keyword: string;
  eligibleCount: number;
  winnerName: string;
  winnerChannelId: string;
  drawnAt: string;
};

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

const API_KEY_STORAGE = "yt_giveaway_api_key";

export default function GiveawayApp() {
  const [presenterMode, setPresenterMode] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("BUILD50");
  const [durationMode, setDurationMode] = useState<DurationMode>(300);
  const [phase, setPhase] = useState<Phase>("setup");
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [entrants, setEntrants] = useState<Entrant[]>([]);
  const [frozenEntrants, setFrozenEntrants] = useState<Entrant[]>([]);
  const [previousWinners, setPreviousWinners] = useState<Entrant[]>([]);
  const [winner, setWinner] = useState<Entrant | null>(null);
  const [shuffleName, setShuffleName] = useState<string | null>(null);
  const [audit, setAudit] = useState<Audit | null>(null);

  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [claimStartedAt, setClaimStartedAt] = useState<number | null>(null);
  const [claimEnded, setClaimEnded] = useState(false);

  const entrantsMapRef = useRef<Map<string, Entrant>>(new Map());
  const pageTokenRef = useRef("");
  const pollingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keywordRef = useRef(keyword);
  const startedAtRef = useRef<string | null>(null);
  const phaseRef = useRef<Phase>(phase);
  const apiKeyRef = useRef(apiKey);

  keywordRef.current = keyword;
  startedAtRef.current = startedAt;
  phaseRef.current = phase;
  apiKeyRef.current = apiKey;

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(API_KEY_STORAGE);
      if (saved) setApiKey(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      if (apiKey.trim()) sessionStorage.setItem(API_KEY_STORAGE, apiKey.trim());
      else sessionStorage.removeItem(API_KEY_STORAGE);
    } catch {
      /* ignore */
    }
  }, [apiKey]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  function youtubeHeaders(extra?: HeadersInit): HeadersInit {
    const headers: Record<string, string> = {};
    if (extra) {
      const h = new Headers(extra);
      h.forEach((v, k) => {
        headers[k] = v;
      });
    }
    const key = apiKeyRef.current.trim();
    if (key) headers["x-youtube-api-key"] = key;
    return headers;
  }

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const processMessages = useCallback((messages: ChatMessage[]) => {
    const start = startedAtRef.current;
    if (!start) return;
    const kw = keywordRef.current;
    const startMs = new Date(start).getTime();
    let added = false;

    for (const msg of messages) {
      if (msg.isChatOwner) continue;
      const publishedMs = new Date(msg.publishedAt).getTime();
      if (Number.isNaN(publishedMs) || publishedMs < startMs) continue;
      if (!matchesKeyword(msg.messageText, kw)) continue;
      if (entrantsMapRef.current.has(msg.authorChannelId)) continue;

      const entrant: Entrant = {
        channelId: msg.authorChannelId,
        displayName: msg.displayName,
        profileImageUrl: msg.profileImageUrl,
        message: msg.messageText,
        timestamp: msg.publishedAt,
      };
      entrantsMapRef.current.set(msg.authorChannelId, entrant);
      added = true;
    }

    if (added) {
      setEntrants(Array.from(entrantsMapRef.current.values()).reverse());
    }
  }, []);

  const pollOnce = useCallback(
    async (liveChatId: string) => {
      if (!pollingRef.current) return;

      try {
        const params = new URLSearchParams({ liveChatId });
        if (pageTokenRef.current) params.set("pageToken", pageTokenRef.current);

        const res = await fetch(`/api/youtube/chat?${params.toString()}`, {
          headers: youtubeHeaders(),
        });
        const data = await res.json();

        if (!res.ok) {
          if (data.error === "STREAM_ENDED" || data.error === "CHAT_DISABLED") {
            setError(data.message || "Live chat ended.");
            stopPolling();
            if (phaseRef.current === "open") {
              setPhase("closed");
              setClosedAt(new Date().toISOString());
              setFrozenEntrants(Array.from(entrantsMapRef.current.values()));
              setEndsAt(null);
            }
            return;
          }
          setError(data.message || "Temporary chat API error. Retrying…");
        } else {
          if (data.offlineAt) {
            setError("The livestream appears to have ended.");
            stopPolling();
            if (phaseRef.current === "open") {
              setPhase("closed");
              setClosedAt(new Date().toISOString());
              setFrozenEntrants(Array.from(entrantsMapRef.current.values()));
              setEndsAt(null);
            }
            return;
          }

          setError(null);
          if (data.nextPageToken) pageTokenRef.current = data.nextPageToken;
          if (phaseRef.current === "open") {
            processMessages(data.messages || []);
          }

          const interval = Math.max(1500, Number(data.pollingIntervalMillis) || 5000);
          if (pollingRef.current) {
            pollTimerRef.current = setTimeout(() => pollOnce(liveChatId), interval);
          }
          return;
        }
      } catch {
        setError("Temporary network error while polling chat. Retrying…");
      }

      if (pollingRef.current) {
        pollTimerRef.current = setTimeout(() => pollOnce(liveChatId), 5000);
      }
    },
    [processMessages, stopPolling]
  );

  const startPolling = useCallback(
    (liveChatId: string) => {
      stopPolling();
      pollingRef.current = true;
      void pollOnce(liveChatId);
    },
    [pollOnce, stopPolling]
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Auto-close when countdown hits zero
  useEffect(() => {
    if (phase !== "open" || endsAt === null) return;
    if (now >= endsAt) {
      stopPolling();
      setPhase("closed");
      setClosedAt(new Date().toISOString());
      setFrozenEntrants(Array.from(entrantsMapRef.current.values()));
      setEndsAt(null);
    }
  }, [phase, endsAt, now, stopPolling]);

  // Claim countdown end
  useEffect(() => {
    if (!claimStartedAt) return;
    if (now - claimStartedAt >= 120_000) setClaimEnded(true);
  }, [claimStartedAt, now]);

  const remainingMs = endsAt ? endsAt - now : 0;
  const claimRemainingMs = claimStartedAt
    ? Math.max(0, 120_000 - (now - claimStartedAt))
    : 120_000;

  const eligiblePool = useMemo(() => {
    const excluded = new Set(previousWinners.map((w) => w.channelId));
    if (winner) excluded.add(winner.channelId);
    const source = frozenEntrants.length ? frozenEntrants : entrants;
    return source.filter((e) => !excluded.has(e.channelId));
  }, [frozenEntrants, entrants, previousWinners, winner]);

  async function connectStream() {
    if (!apiKey.trim()) {
      setError("Paste your YouTube API key in the field above first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/youtube/connect", {
        method: "POST",
        headers: youtubeHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Failed to connect to stream.");
        return;
      }
      setStream(data);
      setPhase("connected");
      pageTokenRef.current = "";
    } catch {
      setError("Could not connect. Check your network and try again.");
    } finally {
      setBusy(false);
    }
  }

  function startGiveaway() {
    if (!stream) return;
    const startIso = new Date().toISOString();
    entrantsMapRef.current = new Map();
    setEntrants([]);
    setFrozenEntrants([]);
    setPreviousWinners([]);
    setWinner(null);
    setShuffleName(null);
    setAudit(null);
    setClaimStartedAt(null);
    setClaimEnded(false);
    setStartedAt(startIso);
    setClosedAt(null);
    setError(null);
    pageTokenRef.current = "";

    if (durationMode === "manual") {
      setEndsAt(null);
    } else {
      setEndsAt(Date.now() + durationMode * 1000);
    }

    setPhase("open");
    startPolling(stream.liveChatId);
  }

  function closeEntries() {
    stopPolling();
    setPhase("closed");
    setClosedAt(new Date().toISOString());
    setFrozenEntrants(Array.from(entrantsMapRef.current.values()));
    setEndsAt(null);
  }

  async function pickWinner(excludeCurrent = false) {
    const excluded = new Set(previousWinners.map((w) => w.channelId));
    if (excludeCurrent && winner) {
      excluded.add(winner.channelId);
    }

    const pool = (frozenEntrants.length ? frozenEntrants : entrants).filter(
      (e) => !excluded.has(e.channelId)
    );

    if (pool.length === 0) {
      setError(
        excludeCurrent
          ? "No remaining eligible entrants for a redraw."
          : "Zero eligible entrants. Cannot pick a winner."
      );
      return;
    }

    setError(null);
    setPhase("drawing");
    setClaimStartedAt(null);
    setClaimEnded(false);

    let selectedIndex = 0;
    let drawnAt = new Date().toISOString();
    try {
      const res = await fetch("/api/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: pool.length }),
      });
      const data = await res.json();
      if (res.ok && typeof data.index === "number") {
        selectedIndex = data.index;
        drawnAt = data.drawnAt || drawnAt;
      } else {
        // Fallback: Web Crypto if draw API fails
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        selectedIndex = buf[0] % pool.length;
      }
    } catch {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      selectedIndex = buf[0] % pool.length;
    }

    const selected = pool[selectedIndex];

    // Suspense animation — does NOT determine the winner
    const names = pool.map((e) => e.displayName);
    const shuffleDuration = 2800;
    const start = Date.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const elapsed = Date.now() - start;
        if (elapsed >= shuffleDuration) {
          setShuffleName(null);
          resolve();
          return;
        }
        setShuffleName(names[Math.floor(Math.random() * names.length)] || selected.displayName);
        const delay = elapsed < 1200 ? 60 : elapsed < 2000 ? 110 : 180;
        setTimeout(tick, delay);
      };
      tick();
    });

    if (excludeCurrent && winner) {
      setPreviousWinners((prev) => [...prev, winner]);
    }

    setWinner(selected);
    setPhase("winner");
    setAudit({
      startedAt: startedAt || "",
      closedAt: closedAt || new Date().toISOString(),
      keyword,
      eligibleCount: pool.length + (excludeCurrent && winner ? 1 : 0),
      winnerName: selected.displayName,
      winnerChannelId: selected.channelId,
      drawnAt,
    });
  }

  function redraw() {
    void pickWinner(true);
  }

  function resetGiveaway() {
    if (!confirm("Reset the giveaway? All entrants and winners will be cleared.")) {
      return;
    }
    stopPolling();
    entrantsMapRef.current = new Map();
    setEntrants([]);
    setFrozenEntrants([]);
    setPreviousWinners([]);
    setWinner(null);
    setShuffleName(null);
    setAudit(null);
    setStartedAt(null);
    setClosedAt(null);
    setEndsAt(null);
    setClaimStartedAt(null);
    setClaimEnded(false);
    setError(null);
    pageTokenRef.current = "";
    setPhase(stream ? "connected" : "setup");
  }

  function enterPresenter() {
    setPresenterMode(true);
    const el = document.documentElement;
    if (el.requestFullscreen) {
      void el.requestFullscreen().catch(() => undefined);
    }
  }

  function exitPresenter() {
    setPresenterMode(false);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }

  useEffect(() => {
    function onFsChange() {
      if (!document.fullscreenElement) setPresenterMode(false);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const statusLabel =
    phase === "open"
      ? "ENTRIES OPEN"
      : phase === "closed"
        ? "ENTRIES CLOSED"
        : phase === "drawing"
          ? "DRAWING…"
          : phase === "winner"
            ? "WINNER SELECTED"
            : phase === "connected"
              ? "READY"
              : "SETUP";

  const displayEntrants =
    phase === "open" ? entrants : frozenEntrants.length ? frozenEntrants : entrants;

  return (
    <div className="min-h-screen w-full">
      <div className={`mx-auto px-4 py-6 sm:px-8 ${presenterMode ? "max-w-6xl" : "max-w-7xl"}`}>
        {/* Header */}
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs tracking-[0.25em] text-cyan-400/80 uppercase">
              YouTube Live Comment Picker
            </p>
            <h1 className="mt-1 text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">
              LIVE GIVEAWAY
            </h1>
            {stream && (
              <p className="mt-2 max-w-xl truncate text-sm text-zinc-400">
                {stream.title}
                {stream.channelTitle ? ` · ${stream.channelTitle}` : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={presenterMode ? exitPresenter : enterPresenter}
              className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
            >
              {presenterMode ? "Exit Presenter" : "Presenter Mode"}
            </button>
            {!presenterMode && (
              <button
                type="button"
                onClick={resetGiveaway}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-400 transition hover:border-red-400/40 hover:text-red-300"
              >
                Reset
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className={`grid gap-6 ${presenterMode ? "" : "lg:grid-cols-[360px_1fr]"}`}>
          {/* Controls */}
          {!presenterMode && (
            <aside className="space-y-4">
              <section className="rounded-2xl border border-cyan-400/20 bg-[#111114]/90 p-5">
                <h2 className="mb-1 text-xs font-semibold tracking-[0.2em] text-cyan-400/80 uppercase">
                  YouTube API Key
                </h2>
                <p className="mb-3 text-xs text-zinc-500">
                  Paste your key here. It stays in this browser session only and is sent to
                  your local server — never shown on the presenter screen.
                </p>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIza…"
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/50"
                />
                {apiKey.trim() ? (
                  <p className="mt-2 text-xs text-emerald-400/90">Key saved for this session</p>
                ) : (
                  <p className="mt-2 text-xs text-amber-300/80">
                    Required before connecting to a stream
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-white/10 bg-[#111114]/90 p-5">
                <h2 className="mb-3 text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase">
                  YouTube Livestream
                </h2>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                  disabled={phase === "open" || phase === "drawing"}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/50"
                />
                <button
                  type="button"
                  onClick={connectStream}
                  disabled={busy || !url.trim() || !apiKey.trim() || phase === "open" || phase === "drawing"}
                  className="mt-3 w-full rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Connecting…" : "Connect to Stream"}
                </button>
                {stream && (
                  <p className="mt-3 text-xs text-emerald-400/90">
                    Connected · chat ready
                  </p>
                )}
              </section>

              <section className="rounded-2xl border border-white/10 bg-[#111114]/90 p-5">
                <h2 className="mb-3 text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase">
                  Keyword
                </h2>
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  disabled={phase === "open" || phase === "drawing" || phase === "winner"}
                  className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-sm tracking-wide text-cyan-300 outline-none focus:border-cyan-400/50"
                />
              </section>

              <section className="rounded-2xl border border-white/10 bg-[#111114]/90 p-5">
                <h2 className="mb-3 text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase">
                  Duration
                </h2>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      [60, "1 min"],
                      [180, "3 min"],
                      [300, "5 min"],
                      [600, "10 min"],
                      ["manual", "Manual"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={String(value)}
                      type="button"
                      disabled={phase === "open" || phase === "drawing"}
                      onClick={() => setDurationMode(value)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        durationMode === value
                          ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200"
                          : "border-white/10 text-zinc-400 hover:border-white/20"
                      } disabled:opacity-40`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <section className="space-y-2 rounded-2xl border border-white/10 bg-[#111114]/90 p-5">
                {(phase === "setup" || phase === "connected") && (
                  <button
                    type="button"
                    onClick={startGiveaway}
                    disabled={!stream || !keyword.trim()}
                    className="w-full rounded-xl bg-cyan-400 px-4 py-3 text-sm font-bold tracking-wide text-zinc-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Start Giveaway
                  </button>
                )}
                {phase === "open" && (
                  <button
                    type="button"
                    onClick={closeEntries}
                    className="w-full rounded-xl border border-amber-400/40 bg-amber-400/15 px-4 py-3 text-sm font-bold tracking-wide text-amber-200 transition hover:bg-amber-400/25"
                  >
                    Close Entries
                  </button>
                )}
                {(phase === "closed" || (phase === "winner" && !winner)) && (
                  <button
                    type="button"
                    onClick={() => void pickWinner(false)}
                    className="w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-bold tracking-wide text-zinc-950 transition hover:bg-emerald-300"
                  >
                    Pick Winner
                  </button>
                )}
                {phase === "winner" && winner && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setClaimStartedAt(Date.now());
                        setClaimEnded(false);
                      }}
                      className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-200 hover:bg-white/10"
                    >
                      Start 2-min Claim Timer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setClaimStartedAt(null);
                        alert(`${winner.displayName} marked as responded. Congrats!`);
                      }}
                      className="w-full rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-zinc-950 hover:bg-emerald-300"
                    >
                      Winner Responded
                    </button>
                    <button
                      type="button"
                      onClick={redraw}
                      disabled={eligiblePool.length === 0}
                      className="w-full rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-white/5 disabled:opacity-40"
                    >
                      Redraw
                    </button>
                  </>
                )}
              </section>

              {audit && (
                <section className="rounded-2xl border border-white/10 bg-[#111114]/90 p-5">
                  <h2 className="mb-3 text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase">
                    Audit
                  </h2>
                  <dl className="space-y-2 font-mono text-[11px] text-zinc-400">
                    <div className="flex justify-between gap-2">
                      <dt>Start</dt>
                      <dd className="text-zinc-200">{formatTime(audit.startedAt)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Close</dt>
                      <dd className="text-zinc-200">{formatTime(audit.closedAt)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Keyword</dt>
                      <dd className="text-cyan-300">{audit.keyword}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Eligible</dt>
                      <dd className="text-zinc-200">{audit.eligibleCount}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Winner</dt>
                      <dd className="truncate text-zinc-200">{audit.winnerName}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Channel</dt>
                      <dd className="truncate text-zinc-500">{audit.winnerChannelId}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Drawn</dt>
                      <dd className="text-zinc-200">{formatTime(audit.drawnAt)}</dd>
                    </div>
                  </dl>
                </section>
              )}

              {previousWinners.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-[#111114]/90 p-5">
                  <h2 className="mb-3 text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase">
                    Previous winners
                  </h2>
                  <ul className="space-y-2 text-sm text-zinc-400">
                    {previousWinners.map((w) => (
                      <li key={w.channelId} className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={w.profileImageUrl}
                          alt=""
                          className="h-6 w-6 rounded-full opacity-60"
                        />
                        <span className="line-through">{w.displayName}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          )}

          {/* Live screen */}
          <main className="min-h-[70vh]">
            {(phase === "drawing" || (phase === "winner" && winner)) && (
              <div className="flex min-h-[70vh] flex-col items-center justify-center rounded-3xl border border-white/10 bg-[#0c0c0e]/80 px-6 py-16 text-center animate-pulse-glow">
                {phase === "drawing" && (
                  <div>
                    <p className="font-mono text-sm tracking-[0.3em] text-cyan-400/80 uppercase">
                      Selecting
                    </p>
                    <p className="mt-8 animate-shuffle text-4xl font-bold text-zinc-100 sm:text-6xl">
                      {shuffleName || "…"}
                    </p>
                  </div>
                )}
                {phase === "winner" && winner && (
                  <div className="animate-winner-reveal">
                    <p className="text-2xl font-semibold tracking-[0.2em] text-cyan-300 sm:text-3xl">
                      🎉 WINNER 🎉
                    </p>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={winner.profileImageUrl || "/globe.svg"}
                      alt={winner.displayName}
                      className="mx-auto mt-8 h-36 w-36 rounded-full border-4 border-cyan-400/60 object-cover shadow-[0_0_60px_rgba(34,211,238,0.35)] sm:h-44 sm:w-44"
                    />
                    <h2 className="mt-8 text-4xl font-bold tracking-tight text-white sm:text-6xl">
                      {winner.displayName}
                    </h2>
                    <p className="mt-6 text-lg text-zinc-300 sm:text-xl">
                      You won 1 month of ChatGPT Plus or Cursor Pro
                    </p>
                    <p className="mt-3 text-base text-zinc-400">
                      Please type <span className="font-mono text-cyan-300">HERE</span> in
                      chat within 2 minutes to claim
                    </p>

                    {claimStartedAt ? (
                      <div className="mt-8">
                        <p className="font-mono text-xs tracking-[0.25em] text-zinc-500 uppercase">
                          Claim window
                        </p>
                        <p
                          className={`mt-2 font-mono text-5xl font-bold ${
                            claimEnded ? "text-red-400" : "text-amber-300"
                          }`}
                        >
                          {claimEnded ? "00:00" : formatCountdown(claimRemainingMs)}
                        </p>
                        {claimEnded && (
                          <p className="mt-2 text-sm text-red-300">
                            Claim window expired — redraw if needed
                          </p>
                        )}
                      </div>
                    ) : presenterMode ? (
                      <p className="mt-8 text-sm text-zinc-500">
                        Host: start claim timer from controls
                      </p>
                    ) : null}

                    {presenterMode && (
                      <div className="mt-10 flex flex-wrap justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setClaimStartedAt(Date.now());
                            setClaimEnded(false);
                          }}
                          className="rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-zinc-200"
                        >
                          Start Claim Timer
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            alert(`${winner.displayName} marked as responded. Congrats!`)
                          }
                          className="rounded-xl bg-emerald-400 px-5 py-2.5 text-sm font-bold text-zinc-950"
                        >
                          Winner Responded
                        </button>
                        <button
                          type="button"
                          onClick={redraw}
                          className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-medium text-zinc-300"
                        >
                          Redraw
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {phase !== "drawing" && !(phase === "winner" && winner) && (
              <div className="rounded-3xl border border-white/10 bg-[#0c0c0e]/80 p-6 sm:p-10">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        phase === "open"
                          ? "animate-status-dot bg-emerald-400"
                          : "bg-zinc-500"
                      }`}
                    />
                    <span
                      className={`text-lg font-semibold tracking-[0.15em] sm:text-2xl ${
                        phase === "open" ? "text-emerald-300" : "text-zinc-300"
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xs tracking-[0.2em] text-zinc-500 uppercase">
                      Keyword
                    </p>
                    <p className="font-mono text-2xl font-bold text-cyan-300 sm:text-3xl">
                      {keyword || "—"}
                    </p>
                  </div>
                </div>

                <div className="mt-10 grid gap-8 sm:grid-cols-2">
                  <div>
                    <p className="font-mono text-xs tracking-[0.2em] text-zinc-500 uppercase">
                      Countdown
                    </p>
                    <p className="mt-2 font-mono text-6xl font-bold tracking-tight text-white sm:text-7xl">
                      {phase === "open"
                        ? durationMode === "manual" || endsAt === null
                          ? "∞"
                          : formatCountdown(remainingMs)
                        : phase === "closed"
                          ? "00:00"
                          : "--:--"}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-xs tracking-[0.2em] text-zinc-500 uppercase">
                      Eligible entries
                    </p>
                    <p className="mt-2 font-mono text-6xl font-bold tracking-tight text-cyan-300 sm:text-7xl">
                      {displayEntrants.length}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {displayEntrants.length === 1 ? "ENTRY" : "ENTRIES"}
                    </p>
                  </div>
                </div>

                <div className="mt-10">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase">
                      Live entrants
                    </h3>
                    <span className="font-mono text-xs text-zinc-600">
                      unique by channel · owners excluded
                    </span>
                  </div>
                  <div className="scrollbar-thin max-h-[420px] space-y-2 overflow-y-auto pr-1">
                    {displayEntrants.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-zinc-500">
                        {phase === "open"
                          ? `Waiting for chatters to type exactly “${keyword}”…`
                          : phase === "connected"
                            ? "Press Start Giveaway to begin accepting entries."
                            : "No entrants yet."}
                      </div>
                    ) : (
                      displayEntrants.map((e) => (
                        <div
                          key={e.channelId}
                          className="animate-entrant-in flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={e.profileImageUrl || "/globe.svg"}
                            alt=""
                            className="h-10 w-10 rounded-full object-cover"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-zinc-100">
                              {e.displayName}
                            </p>
                            <p className="font-mono text-[11px] text-zinc-500">
                              {formatTime(e.timestamp)}
                            </p>
                          </div>
                          <span className="hidden font-mono text-[10px] text-zinc-600 sm:inline">
                            {e.message}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {phase === "closed" && (
                  <div className="mt-8 flex justify-center">
                    <button
                      type="button"
                      onClick={() => void pickWinner(false)}
                      className="rounded-2xl bg-emerald-400 px-10 py-4 text-lg font-bold tracking-wide text-zinc-950 transition hover:bg-emerald-300"
                    >
                      Pick Winner
                    </button>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>

        {!presenterMode && (
          <p className="mt-8 text-center font-mono text-[11px] text-zinc-600">
            API key stays server-side · entries accepted only after Start · crypto.randomInt
            draw
          </p>
        )}
      </div>
    </div>
  );
}
