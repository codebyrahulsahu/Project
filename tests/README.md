# Arena Lite — app tests

A small, dependency-light suite that loads the real browser scripts into
[JSDOM](https://github.com/jsdom/jsdom) and exercises them with a stubbed `fetch()`.

There is no bundler, no transpiler and no device required — `app.test.js` reads
`../arena-app/js/*.js` straight off disk and evaluates them inside a JSDOM window.

## Run

```bash
cd tests
npm ci
npm test
```

Expect `25/25 checks passed`. A non-zero exit code fails the build.

## What is covered

| Area | Checks |
|---|---|
| Provider registry | demo / Groq / Gemini / OpenRouter / OpenAI-compatible shape, base URLs, free-key hints |
| OpenAI-compatible streaming | SSE delta accumulation, bearer auth, `[DONE]` termination, HTTP errors |
| Gemini streaming | `:streamGenerateContent?alt=sse` URL, `systemInstruction` + role mapping, multi-part text |
| Model discovery | Groq/OpenAI `/models` parsing, Gemini `models/` prefix stripping, chat-capability filtering |
| Friendly errors | 401/403, 429, 404, 5xx and offline/CORS failures rewritten for humans |
| Store | model pool persistence, Elo movement after a vote |
| Markdown | bold/code rendering, HTML escaping |
| Wiring | `index.html` exposes every provider + the discovery button; `sw.js` cache version |

## Layout

- `app.test.js` — the whole suite: harness, fixtures and 25 checks.
- `package.json` / `package-lock.json` — pins `jsdom` so CI and local runs agree.

## CI

`.github/workflows/android-apk.yml` runs this suite in the `tests/` directory
**before** the Gradle build, so a broken app shell never burns APK build minutes.
The workflow also triggers on `tests/**` changes.

## Adding a check

Copy an existing `check("…", async () => { … })` block. Helpers available:

```js
assert(cond, msg)        // truthiness
eq(actual, expected, msg) // strict equality
includes(haystack, needle, msg)  // substring

sseResponse([...chunks])          // streaming SSE body
jsonResponse(data, { ok, status }) // JSON body
errorResponse(status, body)        // non-ok body
httpErr(status, detail)            // Error shaped like a failed HTTP call
record(provider, opts)             // run a stream, capture the request + tokens
```
