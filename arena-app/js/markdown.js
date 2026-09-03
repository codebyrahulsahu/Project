/* Tiny, safe markdown → HTML renderer (no dependencies).
   Supports: headings, bold/italic, inline code, fenced code, lists, blockquotes,
   links, hr, simple tables, paragraphs. Everything is HTML-escaped first. */
(function (global) {
  "use strict";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  }

  function inline(text) {
    let s = esc(text);
    // code spans first so we don't format inside them
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_\w])_(?!\s)(.+?)(?<!\s)_(?!\w)/g, "$1<em>$2</em>");
    s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
    return s;
  }

  function render(md) {
    const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;

    const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
    const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

    while (i < lines.length) {
      let line = lines[i];

      if (!line.trim()) { i++; continue; }

      // fenced code
      const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
      if (fence) {
        const lang = fence[1];
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; // skip closing fence (or EOF)
        out.push(`<pre><code${lang ? ` class="lang-${esc(lang)}"` : ""}>${esc(buf.join("\n"))}</code></pre>`);
        continue;
      }

      // heading
      const h = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (h) { const lvl = Math.min(h[1].length, 3); out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue; }

      // hr
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

      // blockquote
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        out.push(`<blockquote>${render(buf.join("\n"))}</blockquote>`);
        continue;
      }

      // table
      if (isTableRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
        const cells = l => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && isTableRow(lines[i])) { rows.push(cells(lines[i])); i++; }
        out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${
          rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        continue;
      }

      // lists (ul / ol), with simple nesting by indentation of 2+ spaces
      const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (li) {
        const ordered = /\d/.test(li[2]);
        const items = [];
        const baseIndent = li[1].length;
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (m && m[1].length === baseIndent && (/\d/.test(m[2]) === ordered)) {
            items.push({ text: m[3], sub: [] });
            i++;
          } else if (m && m[1].length > baseIndent && items.length) {
            items[items.length - 1].sub.push(lines[i]);
            i++;
          } else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length && !m) {
            // continuation line
            items[items.length - 1].text += " " + lines[i].trim();
            i++;
          } else break;
        }
        const tag = ordered ? "ol" : "ul";
        out.push(`<${tag}>${items.map(it => `<li>${inline(it.text)}${it.sub.length ? render(it.sub.join("\n")) : ""}</li>`).join("")}</${tag}>`);
        continue;
      }

      // paragraph — gather until blank line or block start
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() &&
        !/^\s*```/.test(lines[i]) && !/^\s{0,3}#{1,6}\s/.test(lines[i]) &&
        !/^\s*>/.test(lines[i]) && !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) &&
        !(isTableRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1]))) {
        buf.push(lines[i]); i++;
      }
      out.push(`<p>${inline(buf.join("\n")).replace(/\n/g, "<br>")}</p>`);
    }
    return out.join("");
  }

  global.Markdown = { render, esc };
})(window);
