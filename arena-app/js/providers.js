/* Providers — every provider exposes:
     stream({ model, messages, signal, onToken }) → Promise<{text, ms}>
   - demo:        canned, streamed locally (no network, no key)
   - openai-compatible (OpenAI / OpenRouter / Groq / Together / Ollama / LM Studio …):
                  POST {baseUrl}/chat/completions with stream:true, parses SSE. */
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
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      throw new Error(`HTTP ${res.status}${detail ? ": " + detail : ""}`);
    }
    if (!res.body) throw new Error("Streaming not supported by this browser/provider.");

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", acc = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") { return { text: acc, ms: Math.round(performance.now() - started) }; }
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message || "Provider error");
          const delta = json.choices && json.choices[0] && json.choices[0].delta;
          const piece = (delta && delta.content) || "";
          if (piece) { acc += piece; onToken(piece, acc); }
        } catch (e) {
          if (e instanceof SyntaxError) continue; // partial JSON line — ignore
          throw e;
        }
      }
    }
    return { text: acc, ms: Math.round(performance.now() - started) };
  }

  /* ------------------------------ REGISTRY ------------------------------ */
  const PROVIDERS = {
    demo: {
      label: "Demo",
      defaultModels: DEMO_MODELS,
      needsKey: false,
      stream: demoStream,
    },
    openrouter: {
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      needsKey: true,
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
    },
    openai: {
      label: "OpenAI-compatible",
      baseUrl: "https://api.openai.com/v1",
      needsKey: true,
      defaultModels: ["gpt-4o-mini", "gpt-4o"],
      stream: (o) => openaiStream(o),
    },
  };

  global.Providers = PROVIDERS;
})(window);
