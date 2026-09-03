/* Local persistence: settings, battle history, Elo leaderboard. All in localStorage. */
(function (global) {
  "use strict";

  const KEYS = {
    settings: "arena_lite_settings",
    history: "arena_lite_history",
    ratings: "arena_lite_ratings",
  };

  function read(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota / private mode — ignore */ }
  }

  /* ---------------- settings ---------------- */
  const DEFAULT_SETTINGS = {
    provider: "demo",
    apiKey: "",
    baseUrl: "",
    models: {},        // provider → [model ids]
    systemPrompt: "",
    mode: "battle",    // battle | side | single
    pickA: "", pickB: "",
  };
  function getSettings() { return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }; }
  function setSettings(patch) { const s = { ...getSettings(), ...patch }; write(KEYS.settings, s); return s; }

  function modelsFor(provider) {
    const s = getSettings();
    const list = s.models[provider];
    if (Array.isArray(list) && list.length) return list;
    return (global.Providers[provider] && global.Providers[provider].defaultModels) || [];
  }
  function setModelsFor(provider, list) {
    const s = getSettings();
    s.models = { ...s.models, [provider]: list };
    write(KEYS.settings, s);
  }

  /* ---------------- history ---------------- */
  const MAX_HISTORY = 50;
  function getHistory() { return read(KEYS.history, []); }
  function saveBattle(b) {
    const list = getHistory().filter(x => x.id !== b.id);
    list.unshift(b);
    write(KEYS.history, list.slice(0, MAX_HISTORY));
  }
  function getBattle(id) { return getHistory().find(x => x.id === id) || null; }
  function clearHistory() { write(KEYS.history, []); }

  /* ---------------- Elo ratings ---------------- */
  const K = 32;
  function getRatings() { return read(KEYS.ratings, {}); }
  function ensure(r, m) { if (!r[m]) r[m] = { elo: 1000, wins: 0, losses: 0, ties: 0, games: 0 }; return r[m]; }

  /** vote: 'a' | 'b' | 'tie' | 'bad' */
  function recordVote(modelA, modelB, vote) {
    const r = getRatings();
    const A = ensure(r, modelA), B = ensure(r, modelB);
    const expA = 1 / (1 + Math.pow(10, (B.elo - A.elo) / 400));
    const expB = 1 - expA;
    let sA = 0.5, sB = 0.5;
    if (vote === "a") { sA = 1; sB = 0; A.wins++; B.losses++; }
    else if (vote === "b") { sA = 0; sB = 1; B.wins++; A.losses++; }
    else { A.ties++; B.ties++; }
    A.elo = Math.round(A.elo + K * (sA - expA));
    B.elo = Math.round(B.elo + K * (sB - expB));
    A.games++; B.games++;
    write(KEYS.ratings, r);
    return r;
  }
  function leaderboard() {
    return Object.entries(getRatings())
      .map(([model, s]) => ({ model, ...s }))
      .sort((x, y) => y.elo - x.elo || y.games - x.games);
  }
  function resetAll() { Object.values(KEYS).forEach(k => localStorage.removeItem(k)); }

  global.Store = {
    getSettings, setSettings, modelsFor, setModelsFor,
    getHistory, saveBattle, getBattle, clearHistory,
    recordVote, leaderboard, resetAll,
  };
})(window);
