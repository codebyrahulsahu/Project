# Arena Lite — mobile-first AI model battle app

Arena-style app (LMArena / Arena.ai jaisa) jo **phone pe first-class** chalta hai —
pure HTML + CSS + vanilla JS, koi build tool nahi, koi backend nahi. PWA hai, toh
phone ki home screen pe install ho jata hai.

## Features

- ⚔️ **Battle** — 2 anonymous models side-by-side answer dete hain, vote karo, phir names reveal hote hain
- 👀 **Side by side** — dono models khud choose karo
- 💬 **Direct chat** — ek model se seedha baat
- 🤖 **Agent** — ek model + tools: web search, page read, JS sandbox, calculator, write file.
  Har tool call phone pe live timeline mein dikhta hai (tap karke input/output dekho), files ka
  Copy/Download card banta hai
- 🏆 **Leaderboard** — aapke votes se Elo rating (device pe hi store hoti hai)
- 🕘 **History** — pichli battles drawer mein (left edge se swipe karke bhi khulta hai)
- 🔌 **Providers** — Demo (bina key ke UI try karo), OpenRouter, ya koi bhi OpenAI-compatible API
  (OpenAI, Groq, Together, Ollama, LM Studio…) — key browser ke `localStorage` mein rehti hai,
  request seedha provider ko jaati hai, beech mein koi server nahi
- 📱 **PWA** — offline shell, install prompt, standalone mode

## Mobile-specific cheezein jo isme dhyan se ki gayi hain

| Problem (typical web app on phone) | Yahan solution |
|---|---|
| Notch / home-indicator ke neeche UI chhup jaata hai | `viewport-fit=cover` + `env(safe-area-inset-*)` har fixed bar mein |
| Keyboard khulne pe input chhup jaata hai | `interactive-widget=resizes-content` (Android) + `visualViewport` se composer lift (iOS) |
| `100vh` mobile URL bar ke saath galat hota hai | `100dvh` |
| Input pe tap karte hi iOS zoom kar deta hai | saare inputs `font-size:16px` |
| Buttons bahut chhote | har tap target ≥ 44px |
| Do models phone ki width mein nahi aate | swipeable panes (`scroll-snap`) + sticky A/B tabs; desktop pe 2-column grid |
| Enter dabate hi galti se send | touch devices pe Enter = newline, send button se bhejo; desktop pe Enter = send |
| Landscape mein jagah kam | compact nav, hero glow off |
| Hover states touch pe atak jaate hain | `@media (hover:hover)` guard |

## Agent mode kaise kaam karta hai

- Model ko OpenAI-style **function calling** (`tools` / `tool_calls`) di jaati hai; loop max 8 rounds
- Tools browser mein hi chalte hain — koi server nahi:
  - `web_search` → DuckDuckGo Instant Answer + Wikipedia search (dono CORS-open, bina key)
  - `fetch_page` → `r.jina.ai` reader (page → markdown)
  - `run_js` → Web Worker sandbox, 5s timeout, DOM/network access nahi
  - `calculator` → whitelist-checked expression (sirf numbers, operators, `Math.*`)
  - `write_file` → session memory mein; UI mein card se copy/download
  - `get_time` → device ka time/timezone
- Tool-calling ke liye model ko function calling support karna chahiye (GPT-4o-mini, Claude via
  OpenRouter, Gemini, Llama-3.x-70B, Qwen-2.5 sab karte hain)
- Demo provider mein loop **simulate** hota hai — calculator/run_js/write_file asli chalte hain,
  web tools network hone pe asli, warna canned

## Chalao

```bash
cd arena-app
python3 -m http.server 8000
# phone pe: same Wi-Fi pe apne laptop ka IP kholo → http://192.168.x.x:8000
```

`file://` se mat kholo — service worker aur fetch dono ko http chahiye.

Deploy: poora `arena-app/` folder kisi bhi static host (GitHub Pages, Netlify, Vercel,
Cloudflare Pages) pe daal do. HTTPS pe PWA install prompt aur mic-jaisi cheezein kaam karti hain.

## Asli models connect karna

1. **Settings** tab → Provider **OpenRouter** chuno
2. https://openrouter.ai/keys se key lao, paste karo
3. Model pool mein jo IDs chahiye add/remove karo (e.g. `openai/gpt-4o-mini`, `anthropic/claude-3.5-haiku`)
4. Battle tab pe wapas → ask karo

Koi aur OpenAI-compatible endpoint ho toh **OpenAI-compatible** chunke Base URL bhar do
(e.g. Groq: `https://api.groq.com/openai/v1`, local Ollama: `http://localhost:11434/v1`).

> Note: browser se direct call ho rahi hai, toh provider ko CORS allow karna chahiye.
> OpenRouter, OpenAI, Groq karte hain. Ollama ke liye `OLLAMA_ORIGINS=*` set karo.

## Folder structure

```
arena-app/
├── index.html            → poora app (Battle / Leaderboard / Settings views + composer + sheets)
├── css/style.css         → design tokens, mobile-first layout, desktop breakpoints
├── js/markdown.js        → chhota safe markdown renderer (HTML-escaped, streaming-friendly)
├── js/providers.js       → Demo provider + OpenAI-compatible SSE streaming client
├── js/store.js           → localStorage: settings, history, Elo ratings
├── js/agent.js           → Agent loop: tool registry, OpenAI tool_calls streaming, Worker sandbox
├── js/app.js             → UI logic: navigation, drawer, battle flow, vote, panes swipe, keyboard handling
├── sw.js                 → service worker (app shell cache, API calls kabhi cache nahi)
├── manifest.webmanifest  → PWA manifest
└── icons/                → SVG + PNG (192/512/maskable)
```

## Customize

- **Naye provider**: `js/providers.js` ke `PROVIDERS` object mein entry add karo — bas `stream()` implement karna hai
- **Colors / spacing**: `css/style.css` ke `:root` tokens
- **Elo K-factor**: `js/store.js` mein `K`
- **Suggestion chips**: `index.html` mein `.suggestions`

## Limitations

- Sab kuch local hai — koi account, koi sync, koi shared leaderboard nahi
- Multi-turn conversation nahi (har battle/agent run ek prompt)
- Agent ka web search free public endpoints pe hai — rate-limit ya block ho sakte hain; tab model apni knowledge se jawab deta hai aur bata deta hai
- Demo mode canned answers deta hai, sirf UI feel ke liye
