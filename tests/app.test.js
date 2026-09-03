/* Arena Lite — JSDOM test suite.
   Loads the real browser scripts (markdown/store/providers) into a JSDOM window and
   exercises them with a stubbed fetch(), so the app shell is covered without a device.

   Run:  cd tests && npm ci && npm test   */

"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/* ------------------------------ harness ------------------------------ */
let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  \u2717 ${name}`);
    console.log(`      ${err && err.message ? err.message : err}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "expected truthy value"); }
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || "mismatch"} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function includes(haystack, needle, msg) {
  if (!String(haystack).includes(needle)) {
    throw new Error(`${msg || "missing substring"} — ${JSON.stringify(needle)} not in ${JSON.stringify(String(haystack).slice(0, 200))}`);
  }
}

/* ------------------------------ fixtures ------------------------------ */
/** A streaming SSE body that yields each chunk on successive reads. */
function sseResponse(chunks) {
  let i = 0;
  return {
    ok: true, status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (i >= chunks.length) return Promise.resolve({ done: true, value: undefined });
            return Promise.resolve({ done: false, value: new TextEncoder().encode(chunks[i++]) });
          },
        };
      },
    },
  };
}

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data, text: async () => JSON.stringify(data) };
}

function errorResponse(status, body) {
  return { ok: false, status, text: async () => body, json: async () => JSON.parse(body) };
}

function httpErr(status, detail) {
  return Object.assign(new Error(`HTTP ${status}${detail ? ": " + detail : ""}`), { status });
}

/** Drives a provider stream and records both the request and the tokens. */
async function record(provider, opts) {
  const calls = [];
  const win = DOM.window;
  const prevFetch = win.fetch;
  win.fetch = (url, init) => { calls.push({ url, init }); return FETCH_RESULT(); };
  try {
    const tokens = [];
    const out = await provider.stream({
      ...opts,
      onToken: (piece) => tokens.push(piece),
    });
    return { out, calls, tokens };
  } finally {
    win.fetch = prevFetch;
  }
}

let FETCH_RESULT = () => sseResponse([]);

/* ------------------------------ environment ------------------------------ */
const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://arena.example/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});
const win = DOM.window;
if (!win.TextEncoder) win.TextEncoder = TextEncoder;
if (!win.TextDecoder) win.TextDecoder = TextDecoder;

win.eval(read("arena-app/js/markdown.js"));
win.eval(read("arena-app/js/store.js"));
win.eval(read("arena-app/js/providers.js"));

const P = win.Providers;
const Store = win.Store;
const Markdown = win.Markdown;

async function main() {
  console.log("\nArena Lite — app tests\n");

  /* ============ A. provider registry ============ */
  console.log("providers");

  await check("demo provider needs no key and ships 4 canned models", () => {
    eq(P.demo.needsKey, false, "demo needsKey");
    eq(P.demo.defaultModels.length, 4, "demo model count");
    eq(typeof P.demo.stream, "function", "demo stream");
  });

  await check("Groq is OpenAI-compatible at api.groq.com/openai/v1 and needs a key", () => {
    eq(P.groq.baseUrl, "https://api.groq.com/openai/v1", "groq baseUrl");
    eq(P.groq.needsKey, true, "groq needsKey");
    assert(P.groq.defaultModels.length > 0, "groq has default models");
  });

  await check("Gemini targets the Google Generative Language API and needs a key", () => {
    eq(P.gemini.baseUrl, "https://generativelanguage.googleapis.com/v1beta", "gemini baseUrl");
    eq(P.gemini.needsKey, true, "gemini needsKey");
    assert(P.gemini.defaultModels.every(m => m.startsWith("gemini")), "gemini defaults look like gemini ids");
  });

  await check("every provider exposes label, defaults, stream() and listModels()", () => {
    const ids = Object.keys(P).filter(k => typeof P[k] === "object");
    eq(ids.length, 5, "provider count");
    for (const id of ids) {
      const p = P[id];
      assert(p.label, `${id} has a label`);
      eq(typeof p.stream, "function", `${id}.stream`);
      eq(typeof p.listModels, "function", `${id}.listModels`);
      assert(Array.isArray(p.defaultModels) && p.defaultModels.length, `${id} has defaultModels`);
    }
  });

  await check("Groq and Gemini advertise a free-key signup URL", () => {
    includes(P.groq.keyUrl, "console.groq.com", "groq keyUrl");
    includes(P.gemini.keyUrl, "aistudio.google.com", "gemini keyUrl");
    eq(P.groq.freeTier, true, "groq freeTier");
    eq(P.gemini.freeTier, true, "gemini freeTier");
  });

  /* ============ B. OpenAI-compatible streaming ============ */
  console.log("\nopenai-compatible streaming");

  await check("streams SSE deltas into the accumulated text", async () => {
    FETCH_RESULT = () => sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const { out, tokens } = await record(P.groq, { model: "llama-3.1-8b-instant", messages: [{ role: "user", content: "hi" }] });
    eq(out.text, "Hello world", "streamed text");
    eq(tokens.join(""), "Hello world", "token callbacks");
    assert(typeof out.ms === "number", "reports elapsed ms");
  });

  await check("POSTs to /chat/completions with a bearer key and stream:true", async () => {
    FETCH_RESULT = () => sseResponse(["data: [DONE]\n\n"]);
    const { calls } = await record(P.groq, {
      apiKey: "gsk_test", model: "llama-3.1-8b-instant", messages: [{ role: "user", content: "hi" }],
    });
    eq(calls.length, 1, "one request");
    eq(calls[0].url, "https://api.groq.com/openai/v1/chat/completions", "endpoint");
    eq(calls[0].init.method, "POST", "method");
    eq(calls[0].init.headers.Authorization, "Bearer gsk_test", "auth header");
    const body = JSON.parse(calls[0].init.body);
    eq(body.stream, true, "stream flag");
    eq(body.model, "llama-3.1-8b-instant", "model in body");
  });

  await check("stops at [DONE] and ignores anything after it", async () => {
    FETCH_RESULT = () => sseResponse([
      'data: {"choices":[{"delta":{"content":"keep"}}]}\n\n',
      "data: [DONE]\n\n",
      'data: {"choices":[{"delta":{"content":"drop"}}]}\n\n',
    ]);
    const { out } = await record(P.groq, { model: "m", messages: [{ role: "user", content: "hi" }] });
    eq(out.text, "keep", "text stops at [DONE]");
  });

  await check("surfaces HTTP failures with the status code", async () => {
    FETCH_RESULT = () => errorResponse(401, '{"error":{"message":"Invalid API Key"}}');
    let threw = null;
    try {
      await record(P.groq, { model: "m", messages: [{ role: "user", content: "hi" }] });
    } catch (err) { threw = err; }
    assert(threw, "expected the stream to reject");
    includes(threw.message, "HTTP 401", "error message");
    eq(threw.status, 401, "status attached");
  });

  /* ============ C. Gemini ============ */
  console.log("\ngemini");

  await check("calls :streamGenerateContent?alt=sse with the key in the query string", async () => {
    FETCH_RESULT = () => sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n']);
    const { calls } = await record(P.gemini, { apiKey: "gk_test", model: "gemini-2.5-flash", messages: [{ role: "user", content: "yo" }] });
    eq(calls.length, 1, "one request");
    eq(
      calls[0].url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=gk_test",
      "gemini endpoint"
    );
    eq(calls[0].init.headers.Authorization, undefined, "no bearer header for Gemini");
  });

  await check("maps system / user / assistant into Gemini contents + systemInstruction", async () => {
    FETCH_RESULT = () => sseResponse(['data: {"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}\n\n']);
    const { calls } = await record(P.gemini, {
      apiKey: "gk", model: "gemini-2.5-flash",
      messages: [
        { role: "system", content: "be terse" },
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "q2" },
      ],
    });
    const body = JSON.parse(calls[0].init.body);
    eq(body.systemInstruction.parts[0].text, "be terse", "systemInstruction");
    eq(JSON.stringify(body.contents.map(c => c.role)), JSON.stringify(["user", "model", "user"]), "role mapping");
    eq(body.contents[0].parts[0].text, "q1", "first user turn");
  });

  await check("concatenates every candidate part into the streamed text", async () => {
    FETCH_RESULT = () => sseResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"A"},{"text":"B"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"C"}]}}]}\n\n',
    ]);
    const { out } = await record(P.gemini, { apiKey: "gk", model: "gemini-2.5-flash", messages: [{ role: "user", content: "hi" }] });
    eq(out.text, "ABC", "gemini text");
  });

  /* ============ D. model discovery ============ */
  console.log("\nmodel discovery");

  await check("Groq discovery parses data[].id and sorts the result", async () => {
    const calls = [];
    win.fetch = (url) => { calls.push(url); return Promise.resolve(jsonResponse({ data: [{ id: "zeta" }, { id: "alpha" }, { id: "mid" }] })); };
    const models = await P.groq.listModels({ apiKey: "gsk_test" });
    eq(calls[0], "https://api.groq.com/openai/v1/models", "models endpoint");
    eq(JSON.stringify(models), JSON.stringify(["alpha", "mid", "zeta"]), "sorted ids");
  });

  await check("OpenAI-compatible discovery also handles a bare array response", async () => {
    win.fetch = () => Promise.resolve(jsonResponse([{ id: "gpt-4o-mini" }, { id: "gpt-4o" }]));
    const models = await P.openai.listModels({ apiKey: "sk", baseUrl: "https://api.openai.com/v1" });
    eq(JSON.stringify(models), JSON.stringify(["gpt-4o", "gpt-4o-mini"]), "array response ids");
  });

  await check("Gemini discovery strips the models/ prefix", async () => {
    win.fetch = () => Promise.resolve(jsonResponse({
      models: [{ name: "models/gemini-2.5-flash" }, { name: "models/gemini-2.0-flash" }],
    }));
    const models = await P.gemini.listModels({ apiKey: "gk" });
    eq(JSON.stringify(models), JSON.stringify(["gemini-2.0-flash", "gemini-2.5-flash"]), "stripped + sorted");
  });

  await check("Gemini discovery drops models that cannot generateContent", async () => {
    win.fetch = () => Promise.resolve(jsonResponse({
      models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      ],
    }));
    const models = await P.gemini.listModels({ apiKey: "gk" });
    eq(JSON.stringify(models), JSON.stringify(["gemini-2.5-flash"]), "chat-capable only");
  });

  /* ============ E. friendly errors ============ */
  console.log("\nfriendly errors");

  await check("401 becomes 'key was rejected'", () => {
    const msg = P.friendlyError(httpErr(401, '{"error":{"message":"Incorrect API key provided"}}'), P.groq);
    includes(msg, "rejected", "friendly 401");
    includes(msg, "Groq", "names the provider");
    assert(!msg.includes("Incorrect API key provided"), "raw provider noise dropped");
  });

  await check("429 mentions the free-tier rate cap", () => {
    includes(P.friendlyError(httpErr(429, "rate limit"), P.gemini), "Rate limited", "friendly 429");
  });

  await check("network / CORS failure reads as 'cannot reach the provider'", () => {
    const err = new TypeError("Failed to fetch");
    includes(P.friendlyError(err, P.groq), "Can't reach the provider", "friendly network error");
  });

  await check("404 points at model discovery", () => {
    includes(P.friendlyError(httpErr(404, "model not found"), P.groq), "Model not found", "friendly 404");
    includes(P.friendlyError(httpErr(404, "model not found"), P.groq), "Discover models", "suggests discovery");
  });

  await check("5xx reads as a provider outage", () => {
    includes(P.friendlyError(httpErr(503, ""), P.gemini), "having trouble", "friendly 503");
  });

  await check("a retired model (400 'decommissioned') reads as 'no longer available'", () => {
    const msg = P.friendlyError(httpErr(400, '{"error":{"message":"The model llama-3.3-70b-versatile has been decommissioned"}}'), P.groq);
    includes(msg, "no longer available", "retired wording");
    includes(msg, "Discover models", "suggests discovery");
  });

  /* ============ E2. retired-model detection ============ */
  console.log("\nretired models");

  await check("isDeadModelError spots 404s and decommissioned models", () => {
    eq(P.isDeadModelError(httpErr(404, "model not found")), true, "404 is a dead model");
    eq(P.isDeadModelError(httpErr(400, '{"error":{"message":"The model `x` has been decommissioned"}}')), true, "decommissioned 400");
    eq(P.isDeadModelError(httpErr(400, "Unknown model: foo")), true, "unknown model 400");
    eq(P.isDeadModelError(httpErr(401, "Incorrect API key provided")), false, "bad key is not a dead model");
    eq(P.isDeadModelError(httpErr(429, "rate limit")), false, "rate limit is not a dead model");
    eq(P.isDeadModelError(new TypeError("Failed to fetch")), false, "network error is not a dead model");
    eq(P.isDeadModelError(null), false, "null is safe");
  });

  await check("default model lists avoid IDs the providers already retired", () => {
    const retired = {
      groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],       // shut down 2026-08-16
      gemini: ["gemini-2.0-flash", "gemini-2.5-flash-lite"],           // retired 2026-06-01 / 2025-11-18
      openai: ["gpt-4o", "gpt-4o-mini"],                               // retired 2026-02-13
      openrouter: ["anthropic/claude-3.5-haiku", "google/gemini-2.0-flash-001"],
    };
    for (const [provider, ids] of Object.entries(retired)) {
      for (const id of ids) {
        assert(!P[provider].defaultModels.includes(id), `${provider} defaults still list retired ${id}`);
      }
    }
  });

  /* ============ F. store ============ */
  console.log("\nstore");

  await check("modelsFor falls back to provider defaults, setModelsFor persists", () => {
    Store.resetAll();
    eq(Store.modelsFor("groq").length, P.groq.defaultModels.length, "falls back to defaults");
    Store.setModelsFor("groq", ["m1", "m2"]);
    eq(Store.modelsFor("groq").join(","), "m1,m2", "persisted override");
  });

  await check("a vote raises the winner's Elo and lowers the loser's", () => {
    Store.resetAll();
    Store.recordVote("alpha", "beta", "a");
    const rows = Store.leaderboard();
    const alpha = rows.find(r => r.model === "alpha");
    const beta = rows.find(r => r.model === "beta");
    eq(alpha.wins, 1, "alpha win recorded");
    eq(beta.losses, 1, "beta loss recorded");
    assert(alpha.elo > 1000, `winner Elo should rise, got ${alpha.elo}`);
    assert(beta.elo < 1000, `loser Elo should drop, got ${beta.elo}`);
    eq(rows[0].model, "alpha", "leaderboard sorted by Elo");
  });

  /* ============ G. markdown ============ */
  console.log("\nmarkdown");

  await check("renders bold/code and escapes raw HTML", () => {
    const html = Markdown.render("**bold** and `<script>alert(1)</script>`");
    includes(html, "<strong>bold</strong>", "bold rendered");
    includes(html, "<code>", "code span rendered");
    assert(!html.includes("<script>"), "raw script tag must not survive");
    includes(Markdown.esc("<b>"), "&lt;b&gt;", "esc escapes angle brackets");
  });

  /* ============ H. static wiring ============ */
  console.log("\nwiring");

  await check("index.html exposes every provider plus discovery; sw.js ships the v4 cache", () => {
    const appDom = new JSDOM(read("arena-app/index.html"));
    const doc = appDom.window.document;
    const ids = Object.keys(P).filter(k => typeof P[k] === "object");
    for (const id of ids) {
      assert(doc.querySelector(`#providerSeg .seg-btn[data-provider="${id}"]`), `missing seg button for ${id}`);
    }
    assert(doc.getElementById("discoverBtn"), "discover button present");
    assert(doc.getElementById("providerHint"), "provider hint present");
    includes(read("arena-app/sw.js"), "arena-lite-v4", "service worker cache bumped");
  });

  await check("app.js drops retired models and auto-discovers after a key save", () => {
    const app = read("arena-app/js/app.js");
    includes(app, "isDeadModelError", "detects retired-model errors");
    includes(app, "dropDeadModel", "removes the dead model from the list");
    includes(app, "discoverModels({ silent: true })", "refreshes the live list quietly");
  });

  /* ------------------------------ summary ------------------------------ */
  const total = passed + failures.length;
  console.log(`\n${passed}/${total} checks passed${failures.length ? `, ${failures.length} failed` : ""}\n`);
  if (failures.length) process.exit(1);
}

main().catch(err => {
  console.error("\nTest run crashed:\n", err);
  process.exit(1);
});
