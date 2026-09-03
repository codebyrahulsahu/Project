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
  const agentPanel = $("agentPanel"), agentModelEl = $("agentModel"), agentStatus = $("agentStatus");
  const agentSteps = $("agentSteps"), agentOut = $("agentOut"), agentFiles = $("agentFiles"), agentSuggestions = $("agentSuggestions");
  const voteRow = $("voteRow"), reveal = $("reveal"), revealA = $("revealA"), revealB = $("revealB"), againBtn = $("againBtn");

  const lbList = $("lbList"), lbEmpty = $("lbEmpty");

  const providerSeg = $("providerSeg"), baseUrlField = $("baseUrlField"), baseUrl = $("baseUrl");
  const apiKeyField = $("apiKeyField"), apiKey = $("apiKey"), toggleKey = $("toggleKey"), demoNote = $("demoNote");
  const providerHint = $("providerHint");
  const modelList = $("modelList"), newModel = $("newModel"), addModelBtn = $("addModelBtn"), discoverBtn = $("discoverBtn");
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
  const MODE_LABEL = { battle: "Battle", side: "Side by side", single: "Direct chat", agent: "Agent" };
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
    modeLabel.textContent = MODE_LABEL[settings.mode] || "Battle";
    const isAgent = settings.mode === "agent";
    agentSuggestions.hidden = !isAgent;
    suggestions.hidden = isAgent;
    promptInput.placeholder = isAgent ? "Ask the agent to search, calculate, code…" : "Ask anything…";
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
  document.querySelectorAll(".suggestion").forEach(b => b.addEventListener("click", () => startBattle(b.textContent)));

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

  /* ================= TOOL CAPABILITY ================= */
  /* Providers reject tool calls on models that don't support them, and the rejected
     model is remembered per device so Agent mode never picks it again. */
  function modelSupportsTools(model) {
    const noTools = settings.noTools || {};
    if ((noTools[settings.provider] || []).includes(model)) return false;
    return Providers.supportsTools(settings.provider, model) !== false;
  }
  function markNoTools(model) {
    const map = { ...(settings.noTools || {}) };
    const list = map[settings.provider] || [];
    if (!list.includes(model)) map[settings.provider] = [...list, model];
    settings = Store.setSettings({ noTools: map });
  }

  /* ================= BATTLE ================= */
  function pickModels() {
    const models = Store.modelsFor(settings.provider);
    if (!models.length) return null;
    if (settings.mode === "agent") {
      // Agent mode needs function calling — whisper/compound/plain chat models 400 on tools.
      const capable = models.filter(m => modelSupportsTools(m));
      const a = models.includes(settings.pickA) && modelSupportsTools(settings.pickA)
        ? settings.pickA
        : (capable[0] || models[0]);
      return [a, null];
    }
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
    resetAgentPanel();
    promptInput.value = ""; autosize(); sendBtn.disabled = true;
    promptInput.focus({ preventScroll: true });
  }
  newChatBtn.addEventListener("click", newBattle);
  againBtn.addEventListener("click", () => { newBattle(); window.scrollTo({ top: 0, behavior: "smooth" }); });

  function setPaneNames(revealNames) {
    const mode = (current && current.mode) || settings.mode;
    const agent = mode === "agent";
    const single = mode === "single" || agent;
    const sideOrRevealed = mode === "side" || revealNames;
    paneB.hidden = single;
    paneTabs.hidden = single;
    swipeHint.hidden = single;
    panes.hidden = agent;
    agentPanel.hidden = !agent;
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

    if (settings.mode === "agent") {
      if (!modelSupportsTools(modelA)) showToast(`${short(modelA)} may not support tools — Agent mode can fail`);
      return runAgent(text, modelA, provider);
    }

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
      if (Providers.isDeadModelError && Providers.isDeadModelError(err)) dropDeadModel(model);
      out.classList.add("error");
      out.textContent = "⚠️ " + Providers.friendlyError(err, provider);
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
    if (b.mode === "agent") {
      resetAgentPanel();
      agentModelEl.textContent = b.modelA;
      (b.steps || []).forEach(st => { addStep({ id: st.id || st.name + Math.random(), name: st.name, args: st.args }); finishStep(st.id || null, st, true); });
      agentOut.className = "agent-answer md"; renderNow(agentOut, b.textA || "");
      renderFiles(b.files || {});
      agentStatus.textContent = b.msA ? `${(b.msA / 1000).toFixed(1)}s` : "";
      reveal.hidden = true; voteRow.hidden = true;
      return;
    }
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

  /* ================= AGENT MODE ================= */
  const STEP_ICON = { web_search: "🔎", fetch_page: "📄", run_js: "⚙️", calculator: "🧮", write_file: "💾", get_time: "🕒", thought: "💭" };

  function resetAgentPanel() {
    agentSteps.innerHTML = ""; agentOut.innerHTML = ""; agentFiles.innerHTML = "";
    agentOut.className = "agent-answer md"; agentStatus.textContent = ""; agentStatus.classList.remove("busy");
    agentModelEl.textContent = "";
  }
  function argSummary(name, args) {
    if (!args) return "";
    if (name === "web_search") return args.query || "";
    if (name === "fetch_page") return args.url || "";
    if (name === "calculator") return args.expression || "";
    if (name === "run_js") return (args.code || "").split("\n")[0].slice(0, 80);
    if (name === "write_file") return args.path || "";
    return Object.values(args).join(", ").slice(0, 80);
  }
  function addStep({ id, name, args }) {
    const li = document.createElement("li");
    li.className = "step running"; li.dataset.id = id;
    li.innerHTML = `
      <button class="step-head" type="button" aria-expanded="false">
        <span class="step-ic">${STEP_ICON[name] || "🔧"}</span>
        <span class="step-name">${Markdown.esc(name)}</span>
        <span class="step-arg">${Markdown.esc(argSummary(name, args))}</span>
        <span class="step-ms">…</span>
        <svg class="step-chev" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
      </button>
      <div class="step-body">
        <div class="lbl">Input</div><pre>${Markdown.esc(JSON.stringify(args, null, 2))}</pre>
        <div class="lbl">Output</div><pre class="step-out">running…</pre>
      </div>`;
    li.querySelector(".step-head").addEventListener("click", () => {
      const open = li.classList.toggle("open");
      li.querySelector(".step-head").setAttribute("aria-expanded", open);
    });
    agentSteps.appendChild(li);
    li.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return li;
  }
  function addThought(text) {
    const li = document.createElement("li");
    li.className = "step thought";
    li.innerHTML = `<div class="step-head"><span class="step-ic">${STEP_ICON.thought}</span><span class="step-arg">${Markdown.esc(text)}</span></div>`;
    agentSteps.appendChild(li);
  }
  function finishStep(id, { result, ms, error }, silent) {
    const li = id ? agentSteps.querySelector(`.step[data-id="${CSS.escape(id)}"]`) : agentSteps.lastElementChild;
    if (!li) return;
    li.classList.remove("running"); if (error) li.classList.add("error");
    li.querySelector(".step-ms").textContent = ms != null ? (ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : ms + "ms") : "";
    let out = ""; try { out = JSON.stringify(result, null, 2); } catch { out = String(result); }
    li.querySelector(".step-out").textContent = (out || "").slice(0, 4000);
    if (!silent && navigator.vibrate) navigator.vibrate(5);
  }
  function renderFiles(files) {
    agentFiles.innerHTML = "";
    Object.entries(files).forEach(([path, content]) => {
      const card = document.createElement("div");
      card.className = "file-card";
      card.innerHTML = `<div class="file-head"><span>💾</span><span class="file-name">${Markdown.esc(path)}</span>
        <button class="file-act" data-act="copy">Copy</button><button class="file-act" data-act="dl">Download</button></div>
        <pre>${Markdown.esc(content.slice(0, 6000))}</pre>`;
      card.querySelector('[data-act="copy"]').addEventListener("click", async () => { try { await navigator.clipboard.writeText(content); showToast("Copied"); } catch { showToast("Copy failed"); } });
      card.querySelector('[data-act="dl"]').addEventListener("click", () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([content], { type: "text/plain" })); a.download = path.split("/").pop(); a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
      agentFiles.appendChild(card);
    });
  }

  async function runAgent(text, model, provider, opts = {}) {
    hero.hidden = true; thread.hidden = false;
    userMsg.textContent = text;
    voteRow.hidden = true; reveal.hidden = true;
    setPaneNames(false);
    resetAgentPanel();
    agentModelEl.textContent = model;
    agentStatus.textContent = "Working…"; agentStatus.classList.add("busy");
    agentOut.classList.add("streaming");
    promptInput.value = ""; autosize(); promptInput.blur();
    window.scrollTo({ top: 0 });

    controller = new AbortController();
    streaming = true; setStreamingUI(true);
    const started = performance.now();
    current.steps = []; current.files = {};

    try {
      const r = await Agent.run({
        provider, settings, model, prompt: text, signal: controller.signal, noTools: !!opts.noTools,
        onEvent: ev => {
          if (ev.type === "step") addThought(ev.text);
          else if (ev.type === "tool_call") { addStep(ev); current.steps.push({ id: ev.id, name: ev.name, args: ev.args }); agentOut.innerHTML = ""; }
          else if (ev.type === "tool_result") { finishStep(ev.id, ev); const st = current.steps.find(x => x.id === ev.id); if (st) Object.assign(st, { result: ev.result, ms: ev.ms, error: ev.error }); }
          else if (ev.type === "token") { current.textA = ev.acc; scheduleRender(agentOut, ev.acc); }
        },
      });
      current.textA = r.text || ""; current.files = r.files || {};
      renderNow(agentOut, current.textA); renderFiles(current.files);
      current.msA = Math.round(performance.now() - started);
      agentStatus.textContent = `${(current.msA / 1000).toFixed(1)}s · ${current.steps.length} tool${current.steps.length === 1 ? "" : "s"}`;
    } catch (err) {
      if (err && err.name === "AbortError") { agentStatus.textContent = "stopped"; renderNow(agentOut, current.textA || "_Stopped._"); }
      else if (Providers.isToolUnsupportedError && Providers.isToolUnsupportedError(err) && !opts.noTools) {
        // The provider refuses tools for this model — remember it and answer as plain chat.
        markNoTools(model);
        showToast(`${short(model)} can't call tools — retrying without them`);
        return runAgent(text, model, provider, { noTools: true });
      }
      else {
        if (Providers.isDeadModelError && Providers.isDeadModelError(err)) dropDeadModel(model);
        agentOut.classList.add("error"); agentOut.textContent = "⚠️ " + Providers.friendlyError(err, provider); agentStatus.textContent = "error";
      }
    } finally {
      agentOut.classList.remove("streaming"); agentStatus.classList.remove("busy");
      agentSteps.querySelectorAll(".step.running").forEach(li => { li.classList.remove("running"); li.querySelector(".step-ms").textContent = "—"; });
      streaming = false; setStreamingUI(false); controller = null;
      // keep history light: trim big tool outputs
      const slim = { ...current, steps: current.steps.map(st => ({ ...st, result: truncateDeep(st.result) })) };
      Store.saveBattle(slim);
    }
  }
  function truncateDeep(v) { try { const s = JSON.stringify(v); return s.length > 2000 ? { _truncated: s.slice(0, 2000) + "…" } : v; } catch { return String(v).slice(0, 2000); } }

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
    baseUrlField.hidden = !p.allowBaseUrl;
    demoNote.hidden = !!p.needsKey;
    apiKey.value = settings.apiKey || "";
    baseUrl.value = settings.baseUrl || "";
    baseUrl.placeholder = p.baseUrl || "";
    systemPrompt.value = settings.systemPrompt || "";
    renderProviderHint(p);
    renderModelList();
  }
  function renderProviderHint(p) {
    if (!p.needsKey) { providerHint.hidden = true; providerHint.textContent = ""; return; }
    providerHint.hidden = false;
    if (p.freeTier && p.keyUrl) {
      providerHint.innerHTML = `${Markdown.esc(p.note || "")} <a href="${Markdown.esc(p.keyUrl)}" target="_blank" rel="noopener noreferrer">Get a free key ↗</a>`;
    } else {
      providerHint.textContent = p.note || "";
    }
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
  // Saving a key also pulls that provider's live model list, so the hardcoded defaults
  // (which go stale) get replaced by whatever the account can actually call.
  apiKey.addEventListener("change", async () => {
    const next = apiKey.value.trim();
    const changed = next !== (settings.apiKey || "");
    settings = Store.setSettings({ apiKey: next });
    if (!changed) return;
    showToast("Key saved on this device");
    if (!next) return;
    const ok = await discoverModels({ silent: true });
    if (!ok) showToast("Key saved, but the model list couldn't load — check the key, then tap “Discover models”");
  });
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

  /* Pull the live model list straight from the provider (Groq / Gemini / OpenRouter / OpenAI …).
     Model IDs get retired all the time, so this beats trusting any hardcoded default list. */
  let discovering = false;
  async function discoverModels({ silent = false } = {}) {
    const p = Providers[settings.provider];
    if (!p || typeof p.listModels !== "function") return false;
    if (p.needsKey && !settings.apiKey) return false;
    if (discovering) return false;
    discovering = true;

    const label = discoverBtn.textContent;
    discoverBtn.disabled = true;
    if (!silent) discoverBtn.textContent = "Fetching models…";
    try {
      const models = await p.listModels({ apiKey: settings.apiKey, baseUrl: settings.baseUrl || p.baseUrl });
      if (!models.length) throw new Error("This provider returned no models.");
      Store.setModelsFor(settings.provider, models);
      renderModelList();
      syncSheetPick();
      showToast(`Loaded ${models.length} models from ${p.label}`);
      return true;
    } catch (err) {
      showToast(Providers.friendlyError(err, p));
      return false;
    } finally {
      discovering = false;
      discoverBtn.disabled = false;
      if (!silent) discoverBtn.textContent = label;
    }
  }

  discoverBtn.addEventListener("click", async () => {
    const p = Providers[settings.provider];
    if (!p || typeof p.listModels !== "function") { showToast("This provider has no model list to fetch"); return; }
    if (p.needsKey && !settings.apiKey) { showToast("Add your API key first, then discover models"); apiKey.focus(); return; }
    await discoverModels();
  });

  /* A model ID that worked last month may be retired today. When that happens, drop it
     from the local list and pull the live one — otherwise every future battle fails too. */
  function dropDeadModel(model) {
    const list = Store.modelsFor(settings.provider).filter(m => m !== model);
    if (!list.length) { showToast("No models left — tap “Discover models” to reload the list"); return; }
    Store.setModelsFor(settings.provider, list);
    syncSheetPick();
    showToast(`“${short(model)}” is retired — removed. Refreshing model list…`);
    discoverModels({ silent: true });
  }
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
