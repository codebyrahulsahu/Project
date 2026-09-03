/* Agent mode — a real tool-calling loop that runs in the browser.
   Tools available to the model:
     web_search   → DuckDuckGo Instant Answer + Wikipedia search (CORS-friendly, no key)
     fetch_page   → r.jina.ai reader (page → markdown, CORS-friendly, no key)
     run_js       → sandboxed JavaScript in a Web Worker (with timeout)
     calculator   → safe arithmetic via the same worker
     write_file   → virtual files kept in memory for the session (rendered as a card)
     get_time     → current date/time in the user's timezone
   With OpenAI-compatible providers we use native function calling (tools + tool_calls).
   With the Demo provider the loop is simulated so the UI can be felt without a key. */
(function (global) {
  "use strict";

  /* ------------------------------------------------------------------ tools */
  const TOOLS = {
    web_search: {
      description: "Search the web for current facts. Returns a list of results with title, url, snippet.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Search query" } }, required: ["query"] },
      async run({ query }, ctx) {
        const out = [];
        // 1) DuckDuckGo instant answers
        try {
          const r = await fetchJSON(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, ctx.signal);
          if (r.AbstractText) out.push({ title: r.Heading || query, url: r.AbstractURL, snippet: r.AbstractText.slice(0, 400) });
          (r.RelatedTopics || []).slice(0, 4).forEach(t => {
            if (t.Text && t.FirstURL) out.push({ title: t.Text.split(" - ")[0].slice(0, 80), url: t.FirstURL, snippet: t.Text.slice(0, 300) });
          });
        } catch (e) { /* fall through */ }
        // 2) Wikipedia search (always CORS-enabled with origin=*)
        try {
          const r = await fetchJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&origin=*`, ctx.signal);
          (r.query && r.query.search || []).forEach(s => out.push({
            title: s.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
            snippet: stripTags(s.snippet).slice(0, 300),
          }));
        } catch (e) { /* fall through */ }
        if (!out.length) return { results: [], note: "No results (network blocked or nothing found). Answer from your own knowledge and say so." };
        return { results: dedupe(out).slice(0, 8) };
      },
    },

    fetch_page: {
      description: "Fetch a web page and return its main text as markdown (truncated). Use after web_search to read a source.",
      parameters: { type: "object", properties: { url: { type: "string", description: "Full http(s) URL" } }, required: ["url"] },
      async run({ url }, ctx) {
        if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) URLs are allowed");
        const res = await fetch(`https://r.jina.ai/${url}`, { signal: ctx.signal, headers: { "Accept": "text/plain", "X-Return-Format": "markdown" } });
        if (!res.ok) throw new Error(`Reader HTTP ${res.status}`);
        const text = await res.text();
        return { url, content: text.slice(0, 6000), truncated: text.length > 6000 };
      },
    },

    run_js: {
      description: "Run JavaScript in a sandbox (no DOM, no network) and return console output and the final value. Use for calculations, data processing, testing snippets.",
      parameters: { type: "object", properties: { code: { type: "string", description: "JavaScript source. Use console.log for output; the last expression's value is also returned." } }, required: ["code"] },
      run: ({ code }, ctx) => runInWorker(code, ctx.signal),
    },

    calculator: {
      description: "Evaluate a math expression exactly (supports + - * / % ** parentheses and Math.* functions).",
      parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
      async run({ expression }, ctx) {
        const expr = normalizeMath(expression);
        // whitelist: every identifier must be Math.<something> or a bare Math constant/function name
        const idents = expr.match(/[A-Za-z_][\w.]*/g) || [];
        const bad = idents.filter(id => !/^Math\.[A-Za-z0-9_]+$/.test(id) && !(id in Math) && !/^e$/i.test(id));
        if (bad.length) throw new Error(`Unsupported token(s): ${bad.join(", ")} — only numbers, + - * / % ^ ( ) and Math.* are allowed`);
        if (!/^[\d\s+\-*/%().,eE^A-Za-z_]+$/.test(expr)) throw new Error("Expression contains unsupported characters");
        const safe = expr.replace(/\^/g, "**").replace(/(Math\.)?\b(sqrt|abs|floor|ceil|round|pow|min|max|log|log2|log10|sin|cos|tan|PI|E)\b/g, "Math.$2");
        const r = await runInWorker(`"use strict"; return (${safe});`, ctx.signal);
        if (r.error) throw new Error(r.error);
        return { expression: expr, result: r.result };
      },
    },

    write_file: {
      description: "Create or overwrite a file (kept in the session). Use for code, documents, data the user asked you to produce.",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      async run({ path, content }, ctx) {
        ctx.files.set(path, content);
        return { path, bytes: content.length, ok: true };
      },
    },

    get_time: {
      description: "Get the current date and time in the user's timezone.",
      parameters: { type: "object", properties: {} },
      async run() {
        const d = new Date();
        return { iso: d.toISOString(), local: d.toString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
      },
    },
  };

  function toolSpecs() {
    return Object.entries(TOOLS).map(([name, t]) => ({ type: "function", function: { name, description: t.description, parameters: t.parameters } }));
  }

  /* ------------------------------------------------------------ helpers */
  async function fetchJSON(url, signal) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  function normalizeMath(input) {
    let e = String(input || "").trim();
    e = e.replace(/[₹$€,]/g, "").replace(/[x×]/gi, "*").replace(/÷/g, "/").replace(/\s+/g, " ");
    // "18% of 48750" → (18/100)*48750
    e = e.replace(/(\d+(?:\.\d+)?)\s*%\s*(?:of|ka|ki|ke)\s*(\d+(?:\.\d+)?)/gi, "($1/100)*$2");
    // "15%" followed by an operator/paren/end → percent; "17 % 5" (operand on both sides) stays modulo
    e = e.replace(/(\d+(?:\.\d+)?)\s*%(?!\s*[\d(A-Za-z])/g, "($1/100)");
    return e;
  }
  function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }
  function dedupe(list) { const seen = new Set(); return list.filter(x => x.url && !seen.has(x.url) && seen.add(x.url)); }

  // Sandboxed JS execution in a Worker built from a Blob, hard 5s timeout.
  function runInWorker(code, signal, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const src = `
        self.onmessage = (e) => {
          const logs = [];
          const fmt = (a) => a.map(x => { try { return typeof x === "string" ? x : JSON.stringify(x); } catch { return String(x); } }).join(" ");
          const console = { log: (...a) => logs.push(fmt(a)), error: (...a) => logs.push("ERR " + fmt(a)), warn: (...a) => logs.push("WARN " + fmt(a)), info: (...a) => logs.push(fmt(a)) };
          try {
            // wrap so both "return x" and a bare last expression work
            let fn;
            try { fn = new Function("console", e.data); }
            catch { fn = new Function("console", "return eval(" + JSON.stringify(e.data) + ")"); }
            let result = fn(console);
            if (result && typeof result.then === "function") {
              result.then(r => self.postMessage({ logs, result: safe(r) }), err => self.postMessage({ logs, error: String(err && err.message || err) }));
              return;
            }
            self.postMessage({ logs, result: safe(result) });
          } catch (err) { self.postMessage({ logs, error: String(err && err.message || err) }); }
          function safe(v) { if (v === undefined) return undefined; try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); } }
        };`;
      const url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
      const w = new Worker(url);
      const done = (fn, v) => { clearTimeout(t); w.terminate(); URL.revokeObjectURL(url); fn(v); };
      const t = setTimeout(() => done(reject, new Error(`Timed out after ${timeoutMs / 1000}s`)), timeoutMs);
      if (signal) signal.addEventListener("abort", () => done(reject, new DOMException("Aborted", "AbortError")), { once: true });
      w.onmessage = e => done(resolve, { logs: e.data.logs, result: e.data.result, error: e.data.error });
      w.onerror = e => done(reject, new Error(e.message || "Worker error"));
      w.postMessage(code);
    });
  }

  const SYSTEM = `You are Arena Lite's agent. You can call tools to search the web, read pages, run JavaScript, do exact math, and write files.
Rules:
- Use tools when they make the answer more accurate (facts, numbers, code). Don't call tools for trivial chit-chat.
- Prefer web_search → fetch_page for current events; cite sources as markdown links.
- Use run_js or calculator for any non-trivial arithmetic instead of guessing.
- When the user asks you to create code or a document, use write_file, then summarise.
- After you have what you need, write a clear final answer in markdown. Keep it concise — the user is on a phone.`;

  /* ------------------------------------------------------------ the loop */
  /** opts: { provider, settings, model, prompt, history, signal, onEvent }
      events: {type:'step', text} | {type:'tool_call', id, name, args} | {type:'tool_result', id, name, result, ms, error}
              | {type:'token', text, acc} | {type:'done', text, files, steps} */
  async function run(opts) {
    const { provider, settings, model, prompt, signal, onEvent } = opts;
    const ctx = { signal, files: new Map() };
    const steps = [];

    if (provider.needsKey === false && !provider.baseUrl) {
      return demoRun(opts, ctx, steps);
    }

    const messages = [{ role: "system", content: SYSTEM + (settings.systemPrompt ? "\n\nUser's extra instructions:\n" + settings.systemPrompt : "") }];
    (opts.history || []).forEach(m => messages.push(m));
    messages.push({ role: "user", content: prompt });

    const MAX_ITER = 8;
    for (let iter = 0; iter < MAX_ITER; iter++) {
      onEvent({ type: "step", text: iter === 0 ? "Thinking…" : "Continuing…" });
      const turn = await chatWithTools({ provider, settings, model, messages, signal, onToken: (piece, acc) => onEvent({ type: "token", text: piece, acc }) });

      if (!turn.tool_calls.length) {
        return finish(turn.content, ctx, steps, onEvent);
      }

      messages.push({ role: "assistant", content: turn.content || null, tool_calls: turn.tool_calls });
      for (const call of turn.tool_calls) {
        const name = call.function.name;
        let args = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = { _raw: call.function.arguments }; }
        onEvent({ type: "tool_call", id: call.id, name, args });
        const started = performance.now();
        let result, error = null;
        try {
          if (!TOOLS[name]) throw new Error(`Unknown tool: ${name}`);
          result = await TOOLS[name].run(args, ctx);
        } catch (e) {
          if (e && e.name === "AbortError") throw e;
          error = String(e && e.message || e);
          result = { error };
        }
        const ms = Math.round(performance.now() - started);
        steps.push({ name, args, result, ms, error });
        onEvent({ type: "tool_result", id: call.id, name, result, ms, error });
        messages.push({ role: "tool", tool_call_id: call.id, name, content: JSON.stringify(result).slice(0, 12000) });
      }
    }
    onEvent({ type: "step", text: "Reached tool-call limit; writing final answer…" });
    const last = await chatWithTools({ provider, settings, model, messages, signal, onToken: (piece, acc) => onEvent({ type: "token", text: piece, acc }), noTools: true });
    return finish(last.content, ctx, steps, onEvent);
  }

  function finish(text, ctx, steps, onEvent) {
    const files = Object.fromEntries(ctx.files);
    onEvent({ type: "done", text, files, steps });
    return { text, files, steps };
  }

  /* OpenAI-compatible streaming with tool_calls delta accumulation */
  async function chatWithTools({ provider, settings, model, messages, signal, onToken, noTools }) {
    const baseUrl = (settings.baseUrl || provider.baseUrl).replace(/\/+$/, "");
    const headers = { "Content-Type": "application/json", ...(provider.extraHeaders || {}) };
    if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;
    const body = { model, messages, stream: true };
    if (!noTools) { body.tools = toolSpecs(); body.tool_choice = "auto"; }

    const res = await fetch(baseUrl + "/chat/completions", { method: "POST", headers, signal, body: JSON.stringify(body) });
    if (!res.ok) {
      let detail = ""; try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      throw new Error(`HTTP ${res.status}${detail ? ": " + detail : ""}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", content = "";
    const calls = []; // index → {id, function:{name, arguments}}

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") break;
        let json; try { json = JSON.parse(data); } catch { continue; }
        if (json.error) throw new Error(json.error.message || "Provider error");
        const delta = json.choices && json.choices[0] && json.choices[0].delta;
        if (!delta) continue;
        if (delta.content) { content += delta.content; onToken(delta.content, content); }
        (delta.tool_calls || []).forEach(tc => {
          const i = tc.index != null ? tc.index : calls.length;
          if (!calls[i]) calls[i] = { id: tc.id || `call_${i}`, type: "function", function: { name: "", arguments: "" } };
          if (tc.id) calls[i].id = tc.id;
          if (tc.function && tc.function.name) calls[i].function.name += tc.function.name;
          if (tc.function && tc.function.arguments) calls[i].function.arguments += tc.function.arguments;
        });
      }
    }
    return { content, tool_calls: calls.filter(Boolean) };
  }

  /* pull a calculable expression out of a natural-language prompt (demo mode only) */
  function extractExpression(q) {
    const pct = q.match(/(\d+(?:\.\d+)?)\s*%\s*(?:gst\s*)?(?:of|on|ka|ki|ke|par|pe)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)/i);
    if (pct) return `(${pct[1]}/100)*${pct[2].replace(/,/g, "")}`;
    const rev = q.match(/([\d,]+(?:\.\d+)?)\s*(?:ka|ki|ke|of)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (rev) return `(${rev[2]}/100)*${rev[1].replace(/,/g, "")}`;
    const m = q.replace(/[₹$,]/g, "").match(/\d+(?:\.\d+)?(?:\s*[+\-*/x×÷^%]\s*\d+(?:\.\d+)?)+/i);
    return m ? m[0].replace(/[x×]/gi, "*").replace(/÷/g, "/") : "2+2";
  }

  /* ------------------------------------------------------------ demo run */
  async function demoRun({ prompt, signal, onEvent }, ctx, steps) {
    const sleep = ms => new Promise((r, j) => { const t = setTimeout(r, ms); signal && signal.addEventListener("abort", () => { clearTimeout(t); j(new DOMException("Aborted", "AbortError")); }, { once: true }); });
    const q = prompt.trim();
    const wantsMath = /\d+\s*[\+\-\*\/x×÷%^]\s*\d+|calculate|compute|कितना|kitna|percent|%/i.test(q);
    const wantsCode = /code|function|script|program|write|बनाओ|banao|likho|likh/i.test(q);
    const plan = wantsMath ? ["calculator", "run_js"] : wantsCode ? ["run_js", "write_file"] : ["web_search", "fetch_page"];

    onEvent({ type: "step", text: "Planning…" });
    await sleep(500);

    for (const name of plan) {
      const id = "demo_" + name + "_" + Date.now();
      let args, result;
      if (name === "web_search") { args = { query: q.slice(0, 80) }; }
      if (name === "fetch_page") { args = { url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(q.split(/\s+/).slice(0, 3).join("_")) }; }
      if (name === "calculator") { args = { expression: extractExpression(q) }; }
      if (name === "run_js") { args = { code: wantsMath ? `const v = ${(steps[0] && steps[0].result && steps[0].result.expression) || "2+2"}; console.log("check:", v); v` : `function isPrime(n){ if(n<2) return false; for(let i=2;i*i<=n;i++) if(n%i===0) return false; return true; }\nconsole.log([2,3,4,5,97,100].map(isPrime)); "ok"` }; }
      if (name === "write_file") { args = { path: "solution.js", content: `// Generated by Arena Lite agent (demo)\n// Prompt: ${q.replace(/\n/g, " ").slice(0, 80)}\nfunction isPrime(n) {\n  if (n < 2) return false;\n  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;\n  return true;\n}\nmodule.exports = { isPrime };\n` }; }

      onEvent({ type: "tool_call", id, name, args });
      const started = performance.now();
      let error = null;
      try {
        // real tools where possible (calculator / run_js / write_file work offline)
        if (name === "web_search" || name === "fetch_page") {
          try { result = await Promise.race([TOOLS[name].run(args, ctx), sleep(4000).then(() => { throw new Error("timeout"); })]); }
          catch { result = name === "web_search"
            ? { results: [{ title: "Demo result — " + q.slice(0, 40), url: "https://example.com/demo", snippet: "Demo mode: network search is simulated. Connect a real provider in Settings for live results." }] }
            : { url: args.url, content: "# Demo page\n\nThis is simulated page content. In a real run the agent would read the source here.", truncated: false }; }
        } else {
          result = await TOOLS[name].run(args, ctx);
        }
      } catch (e) { if (e.name === "AbortError") throw e; error = String(e.message || e); result = { error }; }
      const ms = Math.round(performance.now() - started);
      steps.push({ name, args, result, ms, error });
      onEvent({ type: "tool_result", id, name, result, ms, error });
      await sleep(400);
    }

    onEvent({ type: "step", text: "Writing answer…" });
    const s0 = steps[0], s1 = steps[1];
    let text;
    if (wantsMath) {
      text = `**Result: \`${s0.result && s0.result.result}\`**\n\nI evaluated \`${s0.args.expression}\` with the calculator tool and double-checked it in the JS sandbox (${s1.result && s1.result.logs && s1.result.logs[0]}).`;
    } else if (wantsCode) {
      text = `I wrote and tested a solution:\n\n\`\`\`js\n${s1.args.content}\`\`\`\n\nSandbox check → \`${s0.result && s0.result.logs && s0.result.logs[0]}\`\n\nSaved as **solution.js** (see the file card below).`;
    } else {
      const r = s0.result && s0.result.results || [];
      text = `Here's what I found about **${q.slice(0, 60)}**:\n\n${r.slice(0, 3).map(x => `- [${x.title}](${x.url}) — ${x.snippet.slice(0, 140)}…`).join("\n") || "- (no results)"}\n\n_Demo mode: connect OpenRouter or any OpenAI-compatible provider in Settings and the agent will actually reason over these sources with a real model._`;
    }
    // stream the final text
    let acc = "";
    for (const w of text.split(/(\s+)/)) { acc += w; onEvent({ type: "token", text: w, acc }); await sleep(14); }
    return finish(acc, ctx, steps, onEvent);
  }

  global.Agent = { run, TOOLS, toolSpecs };
})(window);
