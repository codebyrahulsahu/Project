(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ---------------- element refs ---------------- */
  const topbar = $("topbar");
  const menuBtn = $("menuBtn"), drawer = $("drawer"), scrim = $("scrim"), drawerClose = $("drawerClose");
  const drawerNew = $("drawerNew"), historyList = $("historyList"), historyEmpty = $("historyEmpty"), clearHistoryBtn = $("clearHistoryBtn");
  const modeBtn = $("modeBtn"), modeLabel = $("modeLabel"), modeSheet = $("modeSheet"), sheetPick = $("sheetPick");
  const pickA = $("pickA"), pickB = $("pickB"), pickBWrap = $("pickBWrap");
  const newChatBtn = $("newChatBtn");

  const battleView = $("battleView"), leaderboardView = $("leaderboardView"), settingsView = $("settingsView");
  const hero = $("hero"), suggestions = $("suggestions"), thread = $("thread"), userMsg = $("userMsg");
  const paneTabs = $("paneTabs"), panes = $("panes"), paneA = $("paneA"), paneB = $("paneB");
  const outA = $("outA"), outB = $("outB");
  const paneTitleA = $("paneTitleA"), paneTitleB = $("paneTitleB"), paneMetaA = $("paneMetaA"), paneMetaB = $("paneMetaB");
  const tabNameA = $("tabNameA"), tabNameB = $("tabNameB"), swipeHint = $("swipeHint");
  const voteRow = $("voteRow"), reveal = $("reveal"), revealA = $("revealA"), revealB = $("revealB"), againBtn = $("againBtn");

  const lbList = $("lbList"), lbEmpty = $("lbEmpty");

  const providerSeg = $("providerSeg"), baseUrlField = $("baseUrlField"), baseUrl = $("baseUrl");
  const apiKeyField = $("apiKeyField"), apiKey = $("apiKey"), toggleKey = $("toggleKey"), demoNote = $("demoNote");
  const modelList = $("modelList"), newModel = $("newModel"), addModelBtn = $("addModelBtn");
  const systemPrompt = $("systemPrompt"), resetAllBtn = $("resetAllBtn");

  const composer = $("composer"), promptInput = $("promptInput"), sendBtn = $("sendBtn"), composerNote = $("composerNote");
  const bottomNav = $("bottomNav"), toast = $("toast");

  /* ---------------- state ---------------- */
  let settings = Store.getSettings();
  let current = null;        // { id, prompt, modelA, modelB, textA, textB, msA, msB, vote, mode, ts }
  let controller = null;     // AbortController for in-flight streams
  let streaming = false;

  /* ================= NAVIGATION ================= */
  function showView(name) {
    battleView.hidden = name !== "battle";
    leaderboardView.hidden = name !== "leaderboard";
    settingsView.hidden = name !== "settings";
    document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === name));
    composer.hidden = name !== "battle";
    document.body.classList.toggle("no-composer", name !== "battle");
    if (name === "leaderboard") renderLeaderboard();
    if (name === "settings") renderSettings();
    window.scrollTo({ top: 0 });
    closeDrawer();
  }
  document.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));

  /* ================= DRAWER ================= */
  function openDrawer() {
    renderHistory();
    scrim.hidden = false; drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    scrim.hidden = true; drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
  menuBtn.addEventListener("click", openDrawer);
  drawerClose.addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);
  drawerNew.addEventListener("click", () => { newBattle(); closeDrawer(); showView("battle"); });
  clearHistoryBtn.addEventListener("click", () => { Store.clearHistory(); renderHistory(); showToast("History cleared"); });

  // Desktop: bottom nav is hidden, so mirror the nav inside the drawer
  (function mountDrawerNav() {
    const nav = document.createElement("div");
    nav.className = "drawer-nav";
    nav.innerHTML = bottomNav.innerHTML;
    drawer.insertBefore(nav, drawer.querySelector(".drawer-foot"));
    nav.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => showView(b.dataset.view)));
  })();

  // swipe from left edge to open drawer (phone)
  let edgeStart = null;
  document.addEventListener("touchstart", e => {
    const t = e.touches[0];
    edgeStart = (t.clientX < 24 && !drawer.classList.contains("open")) ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!edgeStart) return;
    const t = e.touches[0];
    if (t.clientX - edgeStart.x > 60 && Math.abs(t.clientY - edgeStart.y) < 40) { openDrawer(); edgeStart = null; }
  }, { passive: true });
  drawer.addEventListener("touchstart", e => { drawer._sx = e.touches[0].clientX; }, { passive: true });
  drawer.addEventListener("touchend", e => {
    if (drawer._sx != null && drawer._sx - e.changedTouches[0].clientX > 70) closeDrawer();
    drawer._sx = null;
  }, { passive: true });

  function renderHistory() {
    const list = Store.getHistory();
    historyEmpty.hidden = list.length > 0;
    historyList.innerHTML = list.map(b => `
      <button class="history-item ${current && current.id === b.id ? "active" : ""}" data-id="${b.id}">
        <span class="history-q">${Markdown.esc(b.prompt)}</span>
        <span class="history-m">${b.vote ? voteLabel(b) : "no vote"} · ${timeAgo(b.ts)}</span>
      </button>`).join("");
    historyList.querySelectorAll(".history-item").forEach(el => el.addEventListener("click", () => {
      loadBattle(Store.getBattle(el.dataset.id)); closeDrawer(); showView("battle");
    }));
  }
  function voteLabel(b) {
    if (b.vote === "a") return `👍 ${short(b.modelA)}`;
    if (b.vote === "b") return `👍 ${short(b.modelB)}`;
    if (b.vote === "tie") return "🤝 tie";
    if (b.vote === "bad") return "👎 both bad";
    return "";
  }
  function timeAgo(ts) {
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return "just now";
    if (d < 3600) return `${Math.floor(d / 60)}m ago`;
    if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
    return `${Math.floor(d / 86400)}d ago`;
  }
  function short(m) { return String(m || "").split("/").pop(); }

  /* ================= MODE SHEET ================= */
  const MODE_LABEL = { battle: "Battle", side: "Side by side", single: "Direct chat" };
  function openSheet() {
    modeSheet.hidden = false;
    modeSheet.querySelectorAll(".sheet-opt").forEach(o => o.classList.toggle("active", o.dataset.mode === settings.mode));
    fillPicks();
    syncSheetPick();
    document.body.style.overflow = "hidden";
  }
  function closeSheet() { modeSheet.hidden = true; document.body.style.overflow = ""; }
  function fillPicks() {
    const models = Store.modelsFor(settings.provider);
    const opts = models.map(m => `<option value="${Markdown.esc(m)}">${Markdown.esc(m)}</option>`).join("");
    pickA.innerHTML = opts; pickB.innerHTML = opts;
    pickA.value = models.includes(settings.pickA) ? settings.pickA : models[0] || "";
    pickB.value = models.includes(settings.pickB) ? settings.pickB : models[1] || models[0] || "";
  }
  function syncSheetPick() {
    sheetPick.hidden = settings.mode === "battle";
    pickBWrap.hidden = settings.mode !== "side";
    modeLabel.textContent = MODE_LABEL[settings.mode];
  }
  modeBtn.addEventListener("click", openSheet);
  modeSheet.querySelector("[data-close]").addEventListener("click", closeSheet);
  modeSheet.querySelectorAll(".sheet-opt").forEach(o => o.addEventListener("click", () => {
    settings = Store.setSettings({ mode: o.dataset.mode });
    modeSheet.querySelectorAll(".sheet-opt").forEach(x => x.classList.toggle("active", x === o));
    syncSheetPick();
    if (settings.mode === "battle") closeSheet();
  }));
  pickA.addEventListener("change", () => { settings = Store.setSettings({ pickA: pickA.value }); });
  pickB.addEventListener("change", () => { settings = Store.setSettings({ pickB: pickB.value }); });

  /* ================= COMPOSER ================= */
  function autosize() {
    promptInput.style.height = "auto";
    promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + "px";
    // keep body padding in sync so content is never hidden behind the composer
    document.documentElement.style.setProperty("--composer-h", composer.offsetHeight + "px");
  }
  promptInput.addEventListener("input", () => { autosize(); sendBtn.disabled = !promptInput.value.trim() && !streaming; });
  promptInput.addEventListener("keydown", e => {
    // desktop: Enter sends, Shift+Enter newline. Phone keyboards: Enter = newline, use the send button.
    const isTouch = matchMedia("(pointer:coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !isTouch) { e.preventDefault(); composer.requestSubmit(); }
  });
  composer.addEventListener("submit", e => {
    e.preventDefault();
    if (streaming) { stopStreaming(); return; }
    const text = promptInput.value.trim();
    if (!text) return;
    startBattle(text);
  });
  suggestions.querySelectorAll(".suggestion").forEach(b => b.addEventListener("click", () => startBattle(b.textContent)));

  // keyboard on mobile: visualViewport shrinks → mark body so CSS can tighten up
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const onVV = () => {
      const kbOffset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const kb = kbOffset > 120;
      document.body.classList.toggle("kb-open", kb);
      // Android (interactive-widget=resizes-content) → offset is 0 and layout already shrank.
      // iOS Safari keeps the layout viewport tall → lift the fixed composer above the keyboard.
      composer.style.transform = kb ? `translateY(-${kbOffset}px)` : "";
      autosize();
    };
    vv.addEventListener("resize", onVV);
    vv.addEventListener("scroll", onVV);
  }

  /* ================= BATTLE ================= */
  function pickModels() {
    const models = Store.modelsFor(settings.provider);
    if (!models.length) return null;
    if (settings.mode === "single") return [settings.pickA && models.includes(settings.pickA) ? settings.pickA : models[0], null];
    if (settings.mode === "side") {
      const a = models.includes(settings.pickA) ? settings.pickA : models[0];
      const b = models.includes(settings.pickB) ? settings.pickB : (models.find(m => m !== a) || a);
      return [a, b];
    }
    // battle: two random distinct models
    const pool = [...models];
    const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const b = pool.length ? pool[Math.floor(Math.random() * pool.length)] : a;
    return [a, b];
  }

  function newBattle() {
    stopStreaming();
    current = null;
    thread.hidden = true; hero.hidden = false;
    outA.innerHTML = ""; outB.innerHTML = "";
    outA.className = "pane-body md"; outB.className = "pane-body md";
    voteRow.hidden = true; reveal.hidden = true;
    promptInput.value = ""; autosize(); sendBtn.disabled = true;
    promptInput.focus({ preventScroll: true });
  }
  newChatBtn.addEventListener("click", newBattle);
  againBtn.addEventListener("click", () => { newBattle(); window.scrollTo({ top: 0, behavior: "smooth" }); });

  function setPaneNames(revealNames) {
    const mode = (current && current.mode) || settings.mode;
    const single = mode === "single";
    const sideOrRevealed = mode === "side" || revealNames;
    paneB.hidden = single;
    paneTabs.hidden = single;
    swipeHint.hidden = single;
    panes.classList.toggle("single", single);

    const nameA = sideOrRevealed || single ? current.modelA : "Model A";
    const nameB = sideOrRevealed ? current.modelB : "Model B";
    paneTitleA.textContent = nameA; paneTitleB.textContent = nameB;
    tabNameA.textContent = sideOrRevealed ? "· " + short(current.modelA) : "";
    tabNameB.textContent = sideOrRevealed ? "· " + short(current.modelB) : "";
  }

  async function startBattle(text) {
    const provider = Providers[settings.provider];
    if (provider.needsKey && !settings.apiKey) {
      showToast("Add an API key in Settings, or switch to Demo");
      showView("settings");
      return;
    }
    const picked = pickModels();
    if (!picked) { showToast("Add at least one model in Settings"); showView("settings"); return; }

    const [modelA, modelB] = picked;
    current = { id: String(Date.now()), prompt: text, modelA, modelB, textA: "", textB: "", msA: 0, msB: 0, vote: null, mode: settings.mode, ts: Date.now(), provider: settings.provider };

    // UI reset
    hero.hidden = true; thread.hidden = false;
    userMsg.textContent = text;
    outA.innerHTML = ""; outB.innerHTML = "";
    outA.className = "pane-body md streaming"; outB.className = "pane-body md streaming";
    paneMetaA.textContent = ""; paneMetaB.textContent = "";
    voteRow.hidden = true; reveal.hidden = true;
    setPaneNames(false);
    activatePane("a", false);
    promptInput.value = ""; autosize();
    promptInput.blur(); // hide phone keyboard so the answers are visible
    window.scrollTo({ top: 0 });

    // stream both concurrently
    controller = new AbortController();
    streaming = true; setStreamingUI(true);

    const messages = [];
    if (settings.systemPrompt.trim()) messages.push({ role: "system", content: settings.systemPrompt.trim() });
    messages.push({ role: "user", content: text });

    const run = (model, out, meta, key) => provider.stream({
      baseUrl: settings.baseUrl || provider.baseUrl, apiKey: settings.apiKey, model, messages,
      signal: controller.signal,
      onToken: (_piece, acc) => { current[key] = acc; scheduleRender(out, acc); },
    }).then(r => {
      current[key] = r.text; current[key === "textA" ? "msA" : "msB"] = r.ms;
      renderNow(out, r.text); out.classList.remove("streaming");
      meta.textContent = `${(r.ms / 1000).toFixed(1)}s · ${r.text.length} chars`;
    }).catch(err => {
      out.classList.remove("streaming");
      if (err && err.name === "AbortError") { renderNow(out, current[key] || "_Stopped._"); meta.textContent = "stopped"; return; }
      out.classList.add("error");
      out.textContent = "⚠️ " + (err && err.message ? err.message : "Request failed");
      meta.textContent = "error";
    });

    const jobs = [run(modelA, outA, paneMetaA, "textA")];
    if (modelB) jobs.push(run(modelB, outB, paneMetaB, "textB"));
    await Promise.allSettled(jobs);

    streaming = false; setStreamingUI(false); controller = null;
    if (modelB) voteRow.hidden = false;
    Store.saveBattle(current);
  }

  function stopStreaming() {
    if (controller) controller.abort();
  }
  function setStreamingUI(on) {
    sendBtn.classList.toggle("streaming", on);
    sendBtn.querySelector(".ic-send").hidden = on;
    sendBtn.querySelector(".ic-stop").hidden = !on;
    sendBtn.disabled = on ? false : !promptInput.value.trim();
    sendBtn.setAttribute("aria-label", on ? "Stop" : "Send");
    composerNote.textContent = on ? "Generating… tap ■ to stop" : "";
  }

  // throttle markdown re-render to one per animation frame per pane
  const pending = new Map();
  function scheduleRender(out, text) {
    pending.set(out, text);
    if (!scheduleRender._raf) {
      scheduleRender._raf = requestAnimationFrame(() => {
        scheduleRender._raf = null;
        pending.forEach((t, el) => renderNow(el, t));
        pending.clear();
      });
    }
  }
  function renderNow(out, text) { out.innerHTML = Markdown.render(text); }

  /* ---- vote ---- */
  voteRow.querySelectorAll(".vote-btn").forEach(b => b.addEventListener("click", () => {
    if (!current || current.vote) return;
    current.vote = b.dataset.vote;
    if (current.modelA !== current.modelB) Store.recordVote(current.modelA, current.modelB, current.vote);
    Store.saveBattle(current);
    showReveal();
    if (navigator.vibrate) navigator.vibrate(12);
  }));

  function showReveal() {
    voteRow.hidden = true;
    setPaneNames(true);
    revealA.textContent = current.modelA; revealB.textContent = current.modelB;
    revealA.classList.toggle("winner", current.vote === "a");
    revealB.classList.toggle("winner", current.vote === "b");
    reveal.hidden = false;
    reveal.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function loadBattle(b) {
    if (!b) return;
    stopStreaming();
    current = b;
    hero.hidden = true; thread.hidden = false;
    userMsg.textContent = b.prompt;
    setPaneNames(!!b.vote);
    outA.className = "pane-body md"; outB.className = "pane-body md";
    renderNow(outA, b.textA || ""); renderNow(outB, b.textB || "");
    paneMetaA.textContent = b.msA ? `${(b.msA / 1000).toFixed(1)}s` : ""; paneMetaB.textContent = b.msB ? `${(b.msB / 1000).toFixed(1)}s` : "";
    if (b.vote) { showReveal(); } else { reveal.hidden = true; voteRow.hidden = !b.modelB; }
    activatePane("a", false);
  }

  /* ---- phone pane tabs + swipe sync ---- */
  function activatePane(which, scroll = true) {
    panes.dataset.active = which;
    paneTabs.querySelectorAll(".pane-tab").forEach(t => {
      const on = t.dataset.pane === which;
      t.classList.toggle("active", on); t.setAttribute("aria-selected", on);
    });
    if (scroll) {
      const target = which === "a" ? paneA : paneB;
      panes.scrollTo({ left: target.offsetLeft - panes.offsetLeft - 16, behavior: "smooth" });
    }
  }
  paneTabs.querySelectorAll(".pane-tab").forEach(t => t.addEventListener("click", () => activatePane(t.dataset.pane)));
  let scrollT;
  panes.addEventListener("scroll", () => {
    clearTimeout(scrollT);
    scrollT = setTimeout(() => {
      const mid = panes.scrollLeft + panes.clientWidth / 2;
      const which = mid > paneB.offsetLeft - panes.offsetLeft ? "b" : "a";
      if (panes.dataset.active !== which) activatePane(which, false);
    }, 80);
  }, { passive: true });

  /* ================= LEADERBOARD ================= */
  function renderLeaderboard() {
    const rows = Store.leaderboard();
    lbEmpty.hidden = rows.length > 0;
    lbList.innerHTML = rows.map((r, i) => `
      <div class="lb-row">
        <span class="lb-rank ${i < 3 ? "top" : ""}">${i + 1}</span>
        <div style="min-width:0">
          <div class="lb-name">${Markdown.esc(r.model)}</div>
          <div class="lb-stats">${r.wins}W · ${r.losses}L · ${r.ties}T · ${r.games} battles</div>
        </div>
        <span class="lb-elo">${r.elo}</span>
      </div>`).join("");
  }

  /* ================= SETTINGS ================= */
  function renderSettings() {
    providerSeg.querySelectorAll(".seg-btn").forEach(b => {
      const on = b.dataset.provider === settings.provider;
      b.classList.toggle("active", on); b.setAttribute("aria-checked", on);
    });
    const p = Providers[settings.provider];
    apiKeyField.hidden = !p.needsKey;
    baseUrlField.hidden = settings.provider !== "openai";
    demoNote.hidden = settings.provider !== "demo";
    apiKey.value = settings.apiKey || "";
    baseUrl.value = settings.baseUrl || "";
    baseUrl.placeholder = p.baseUrl || "";
    systemPrompt.value = settings.systemPrompt || "";
    renderModelList();
  }
  function renderModelList() {
    const models = Store.modelsFor(settings.provider);
    modelList.innerHTML = models.map(m => `
      <span class="model-tag"><span>${Markdown.esc(m)}</span>
        <button aria-label="Remove ${Markdown.esc(m)}" data-m="${Markdown.esc(m)}">
          <svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button></span>`).join("");
    modelList.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      Store.setModelsFor(settings.provider, Store.modelsFor(settings.provider).filter(x => x !== b.dataset.m));
      renderModelList();
    }));
  }
  providerSeg.querySelectorAll(".seg-btn").forEach(b => b.addEventListener("click", () => {
    settings = Store.setSettings({ provider: b.dataset.provider });
    renderSettings();
  }));
  apiKey.addEventListener("change", () => { settings = Store.setSettings({ apiKey: apiKey.value.trim() }); showToast("Key saved on this device"); });
  baseUrl.addEventListener("change", () => { settings = Store.setSettings({ baseUrl: baseUrl.value.trim() }); });
  systemPrompt.addEventListener("change", () => { settings = Store.setSettings({ systemPrompt: systemPrompt.value }); });
  toggleKey.addEventListener("click", () => { apiKey.type = apiKey.type === "password" ? "text" : "password"; });
  function addModel() {
    const m = newModel.value.trim();
    if (!m) return;
    const list = Store.modelsFor(settings.provider);
    if (!list.includes(m)) Store.setModelsFor(settings.provider, [...list, m]);
    newModel.value = ""; renderModelList();
  }
  addModelBtn.addEventListener("click", addModel);
  newModel.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addModel(); } });
  resetAllBtn.addEventListener("click", () => {
    if (!confirm("Reset all settings, history and ratings on this device?")) return;
    Store.resetAll(); settings = Store.getSettings(); newBattle(); renderSettings(); showToast("Reset done");
  });

  /* ================= TOAST ================= */
  let toastT;
  function showToast(msg) {
    toast.textContent = msg; toast.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { toast.hidden = true; }, 2200);
  }

  /* ================= PWA ================= */
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  /* ================= INIT ================= */
  syncSheetPick();
  autosize();
  showView("battle");
  window.addEventListener("resize", autosize);
})();
