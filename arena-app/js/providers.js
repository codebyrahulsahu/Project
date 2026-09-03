/* Providers — every provider exposes:
     listModels({ apiKey, baseUrl, signal }) → Promise<string[]>   (model discovery)
     stream({ model, messages, signal, onToken }) → Promise<{text, ms}>
   - demo:        canned, streamed locally (no network, no key)
   - openai-compatible (OpenRouter / Groq / OpenAI / Together / Ollama / LM Studio …):
                  POST {baseUrl}/chat/completions with stream:true, parses SSE.
   - gemini:      Google Generative Language API
                  POST {baseUrl}/models/{model}:streamGenerateContent?alt=sse&key=…
   Errors are raw here; run them through Providers.friendlyError() before showing a human. */
(function (global) {
  "use strict";

  /* ------------------------------ DEMO ------------------------------ */
  const DEMO_MODELS = ["demo/nova-1", "demo/atlas-7b", "demo/quill-mini", "demo/orbit-pro"];

  const DEMO_ANSWERS = [
    (q) => `Here's a quick take on **"${q.slice(0, 60)}${q.length > 60 ? "…" : ""}"**:

1. **Start simple.** Break the question into the smallest piece you can answer confidently.
2. **Check your assumptions.** Most confusion hides in the words we skip over.
3. **Try it.** A tiny experiment beats a long debate.

> Tip: if you can explain it to a friend in two sentences, you actually understand it.

Want me to go deeper on any of these?`,

    (q) => `Great question. Let me answer it in three parts.

### What it is
In plain terms, ${q.toLowerCase().replace(/[?.!]+$/, "")} comes down to a few core ideas that build on each other.

### Why it matters
It shows up everywhere once you notice it — from everyday decisions to how software and science actually work.

### A tiny example
\`\`\`python
def explain(topic):
    return f"{topic} is easier than it looks."

print(explain("This"))
\`\`\`

That's the essence. Ask a follow-up if you'd like a specific angle.`,

    (q) => `Short version: **yes, and it depends on context.**

| Aspect | Takeaway |
|---|---|
| Difficulty | Easier than it sounds |
| Time to learn | An afternoon for basics |
| Common mistake | Overthinking step one |

If you tell me what you'll use this for, I can tailor the answer to "${q.slice(0, 40)}${q.length > 40 ? "…" : ""}".`,

    (q) => `Let me think about this step by step.

- First, the question *"${q.slice(0, 50)}${q.length > 50 ? "…" : ""}"* has a factual part and a judgement part.
- The factual part is usually settled: look it up, verify with two sources.
- The judgement part is where people differ — and where a clear framework helps.

**My recommendation:** pick the option that is easiest to undo. You'll learn more from a reversible mistake than from a perfect plan.

_Shall I write this up as a checklist?_`,
  ];

  function sleep(ms, signal) {
    return new Promise((res, rej) => {
      const t = setTimeout(res, ms);
      if (signal) signal.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
  }

  async function demoStream({ model, messages, signal, onToken }) {
    const q = (messages.filter(m => m.role === "user").pop() || {}).content || "";
    // pick an answer deterministically per model so A/B differ
    const idx = Math.abs(hash(model + q)) % DEMO_ANSWERS.length;
    const text = DEMO_ANSWERS[idx](q);
    const started = performance.now();
    const speed = 12 + (Math.abs(hash(model)) % 20); // ms per chunk, varies per model
    await sleep(300 + (Math.abs(hash(model)) % 600), signal);
    let acc = "";
    const words = text.split(/(\s+)/);
    for (const w of words) {
      if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
      acc += w;
      onToken(w, acc);
      await sleep(speed, signal);
    }
    return { text: acc, ms: Math.round(performance.now() - started) };
  }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  /* --------------------------- SHARED HELPERS --------------------------- */

  /** Throw `HTTP <status>: <body snippet>` so friendlyError() can classify it. */
  async function httpError(res) {
    let detail = "";
    try { detail = ((await res.text()) || "").replace(/\s+/g, " ").trim().slice(0, 300); } catch { /* ignore */ }
    const err = new Error(`HTTP ${res.status}${detail ? ": " + detail : ""}`);
    err.status = res.status;
    throw err;
  }

  /** Walk a streaming SSE response, handing each parsed JSON frame to onData. */
  async function streamSSE(res, onData) {
    if (!res.body) throw new Error("Streaming not supported by this browser/provider.");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") return;
        let json;
        try { json = JSON.parse(payload); } catch { continue; } // partial JSON line — wait for more
        if (json.error) throw new Error(json.error.message || "Provider error");
        onData(json);
      }
    }
  }

  function firstLine(s, max) {
    const one = String(s || "").split("\n")[0].trim();
    return one.length > (max || 120) ? one.slice(0, max || 120) + "…" : one;
  }

  /* ---------------------- OPENAI-COMPATIBLE (SSE) ---------------------- */
  async function openaiStream({ baseUrl, apiKey, model, messages, signal, onToken, extraHeaders }) {
    const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const started = performance.now();
    const headers = { "Content-Type": "application/json", ...(extraHeaders || {}) };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(url, {
      method: "POST", headers, signal,
      body: JSON.stringify({ model, messages, stream: true }),
    });
    if (!res.ok) await httpError(res);

    let acc = "";
    await streamSSE(res, (json) => {
      const delta = json.choices && json.choices[0] && json.choices[0].delta;
      const piece = (delta && delta.content) || "";
      if (piece) { acc += piece; onToken(piece, acc); }
    });
    return { text: acc, ms: Math.round(performance.now() - started) };
  }

  /** GET {baseUrl}/models → ["id", …] (OpenAI, Groq, OpenRouter, Together, Ollama …). */
  async function openaiListModels({ baseUrl, apiKey, signal }) {
    const url = baseUrl.replace(/\/+$/, "") + "/models";
    const headers = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers, signal });
    if (!res.ok) await httpError(res);
    const json = await res.json();
    const ids = (Array.isArray(json) ? json : (json.data || []))
      .map(m => (typeof m === "string" ? m : (m.id || m.name || m.model)))
      .filter(Boolean)
      .map(String);
    if (!ids.length) throw new Error("This provider returned no models.");
    return [...new Set(ids)].sort();
  }

  /* ------------------------------- GEMINI ------------------------------- */
  /* Google's native API: not OpenAI-shaped, so it gets its own transport.
     - list:   GET  {base}/models?key=…
     - stream: POST {base}/models/{model}:streamGenerateContent?alt=sse&key=…     */
  const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

  function geminiModelId(model) {
    return String(model || "").trim().replace(/^models\//, "");
  }

  async function geminiStream({ baseUrl, apiKey, model, messages, signal, onToken }) {
    const base = (baseUrl || GEMINI_BASE).replace(/\/+$/, "");
    const id = geminiModelId(model);
    const url = `${base}/models/${encodeURIComponent(id)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey || "")}`;
    const started = performance.now();

    const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n").trim();
    const contents = messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.content || "") }],
      }));

    const body = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify(body),
    });
    if (!res.ok) await httpError(res);

    let acc = "";
    await streamSSE(res, (json) => {
      const cands = json.candidates || [];
      const parts = (cands[0] && cands[0].content && cands[0].content.parts) || [];
      const piece = parts.map(p => p.text || "").join("");
      if (piece) { acc += piece; onToken(piece, acc); }
    });
    return { text: acc, ms: Math.round(performance.now() - started) };
  }

  async function geminiListModels({ baseUrl, apiKey, signal }) {
    const base = (baseUrl || GEMINI_BASE).replace(/\/+$/, "");
    const url = `${base}/models?key=${encodeURIComponent(apiKey || "")}`;
    const res = await fetch(url, { signal });
    if (!res.ok) await httpError(res);
    const json = await res.json();
    const ids = (json.models || [])
      // only models that can actually answer a chat turn
      .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map(m => geminiModelId(m.name))
      .filter(Boolean);
    if (!ids.length) throw new Error("This provider returned no models.");
    return [...new Set(ids)].sort();
  }

  /* ------------------------ FRIENDLIER ERROR MESSAGES ------------------------ */
  /* Raw provider errors are noisy ("HTTP 401: {"error":{"message":"Incorrect API key…"}}").
     Turn the common ones into something a person can act on. */
  function friendlyError(err, provider) {
    if (!err) return "Something went wrong. Please try again.";
    if (err.name === "AbortError") return "Stopped.";

    const raw = String(err.message || err);
    const lower = raw.toLowerCase();

    // fetch() rejects with a TypeError for DNS/offline/CORS failures — no status to read.
    if (err.name === "TypeError" || /failed to fetch|networkerror|network request failed|load failed/i.test(raw)) {
      return "Can't reach the provider. Check your connection — some providers also block browser requests (CORS).";
    }

    const m = raw.match(/^HTTP\s+(\d{3})(?::\s*([\s\S]*))?$/);
    if (m) {
      const code = Number(m[1]);
      const detail = (m[2] || "").trim();

      // A bad key sometimes arrives as a 400 rather than a 401 (Gemini does this).
      if (/api key not valid|api_key_invalid|invalid api key|permission_denied|consumer _invalid/i.test(detail)) {
        return `Your ${labelFor(provider)} key was rejected. Check it in Settings.`;
      }
      if (code === 401 || code === 403) {
        return `Your ${labelFor(provider)} key was rejected (${code}). Check it in Settings.`;
      }
      if (code === 429) {
        return `Rate limited (429) by ${labelFor(provider)}. Free tiers are capped — wait a moment and retry.`;
      }
      if (code === 404) {
        return `Model not found (404) on ${labelFor(provider)}. Tap “Discover models” to refresh the list.`;
      }
      if (code === 400) {
        return `Bad request (400) from ${labelFor(provider)}. ${firstLine(detail) || "Check the model name in Settings."}`;
      }
      if (code >= 500) {
        return `${labelFor(provider)} is having trouble (${code}). Try again in a moment.`;
      }
      return `Request failed (${code}). ${firstLine(detail)}`.trim();
    }

    return firstLine(raw, 200);
  }

  function labelFor(provider) {
    const p = typeof provider === "string" ? PROVIDERS[provider] : provider;
    return (p && p.label) || "the provider";
  }

  /* ------------------------------ REGISTRY ------------------------------ */
  const PROVIDERS = {
    demo: {
      label: "Demo",
      needsKey: false,
      defaultModels: DEMO_MODELS,
      stream: demoStream,
      note: "Streams canned answers so you can feel the UI without a key.",
      listModels: async () => DEMO_MODELS.slice(),
    },

    /* Free key → https://console.groq.com/keys — OpenAI-compatible, very fast. */
    groq: {
      label: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      needsKey: true,
      freeTier: true,
      keyUrl: "https://console.groq.com/keys",
      note: "Free key at console.groq.com — no card, generous rate limits.",
      defaultModels: [
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "openai/gpt-oss-120b",
        "qwen/qwen3-32b",
        "moonshotai/kimi-k2-instruct",
      ],
      stream: (o) => openaiStream({ ...o, baseUrl: o.baseUrl || "https://api.groq.com/openai/v1" }),
      listModels: (o) => openaiListModels({ ...o, baseUrl: o.baseUrl || "https://api.groq.com/openai/v1" }),
    },

    /* Free key → https://aistudio.google.com/apikey */
    gemini: {
      label: "Gemini",
      baseUrl: GEMINI_BASE,
      needsKey: true,
      freeTier: true,
      keyUrl: "https://aistudio.google.com/apikey",
      note: "Free key at aistudio.google.com — Google's own API.",
      defaultModels: [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
      ],
      stream: (o) => geminiStream({ ...o, baseUrl: o.baseUrl || GEMINI_BASE }),
      listModels: (o) => geminiListModels({ ...o, baseUrl: o.baseUrl || GEMINI_BASE }),
    },

    openrouter: {
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      needsKey: true,
      keyUrl: "https://openrouter.ai/keys",
      note: "One key for hundreds of models; some are free.",
      defaultModels: [
        "openai/gpt-4o-mini",
        "anthropic/claude-3.5-haiku",
        "google/gemini-2.0-flash-001",
        "meta-llama/llama-3.3-70b-instruct",
        "qwen/qwen-2.5-72b-instruct",
      ],
      stream: (o) => openaiStream({
        ...o,
        baseUrl: "https://openrouter.ai/api/v1",
        extraHeaders: { "HTTP-Referer": location.origin, "X-Title": "Arena Lite" },
      }),
      listModels: (o) => openaiListModels({ ...o, baseUrl: "https://openrouter.ai/api/v1" }),
    },

    openai: {
      label: "OpenAI-compatible",
      baseUrl: "https://api.openai.com/v1",
      needsKey: true,
      allowBaseUrl: true,
      keyUrl: "https://platform.openai.com/api-keys",
      note: "Point the base URL at any OpenAI-compatible server (Ollama, LM Studio, Together…).",
      defaultModels: ["gpt-4o-mini", "gpt-4o"],
      stream: (o) => openaiStream(o),
      listModels: (o) => openaiListModels(o),
    },
  };

  global.Providers = PROVIDERS;
  global.Providers.friendlyError = friendlyError;
})(window);
