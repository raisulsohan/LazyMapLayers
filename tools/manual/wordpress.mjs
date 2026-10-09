// Turns the manual (docs/manual/*.md) into HTML for the documentation page on raisulsohan.com
// (WordPress): one page with every chapter and a table of contents, ready to paste into a
// "Custom HTML" block. Pictures load from GitHub through jsDelivr at a fixed commit or tag, so the
// page never shows a picture from a newer version than its text.
//
//   node tools/manual/wordpress.mjs [--ref v1.0.0]     (default: the current commit, which must be pushed)
//
// Writes .cache/manual/wordpress/lazymaplayers-documentation.html. Only the Markdown the manual
// uses is understood: headings, paragraphs, lists, tables, pictures, quotes, code, bold, italics, links.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { root } from "./session.mjs";

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const ref = arg("--ref") ?? execFileSync("git", ["-c", "safe.directory=*", "rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const repo = "raisulsohan/LazyMapLayers";
// --local points the pictures at the files on disk, to check the page before anything is pushed.
const local = process.argv.includes("--local");
const media = (file) => (local ? `../../../docs/manual/${file}` : `https://cdn.jsdelivr.net/gh/${repo}@${ref}/docs/manual/${file}`);
const githubFile = (file) => `https://github.com/${repo}/blob/${ref}/${file}`;
const dir = path.join(root, "docs", "manual");

const chapters = fs.readdirSync(dir).filter((f) => /^\d\d-.*\.md$/.test(f) || f === "recipes.md").sort();
const anchorOf = (file) => "lml-" + file.replace(/\.md$/, "");

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function link(href) {
  if (/^https?:/.test(href)) return href;
  const [file, hash] = href.split("#");
  if (/^\d\d-.*\.md$|^recipes\.md$/.test(file) && chapters.includes(file)) return `#${hash ? `${anchorOf(file)}-${hash}` : anchorOf(file)}`;
  if (file === "README.md" || file === "") return `#lml-contents`;
  // Anything else in the repository opens on GitHub.
  return githubFile(path.posix.normalize(`docs/manual/${file}`)) + (hash ? `#${hash}` : "");
}

function inline(text) {
  const codes = [];
  let out = escape(text).replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`);
  out = out
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img src="${media(src)}" alt="${alt}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${link(href)}">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>");
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

const slug = (text) => text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

function convert(markdown, file) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const html = [];
  let i = 0;
  const base = anchorOf(file);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      const level = m[1].length;
      const id = level === 1 ? base : `${base}-${slug(m[2])}`;
      html.push(`<h${level + 1} id="${id}">${inline(m[2])}</h${level + 1}>`);
      i++;
    } else if (line.startsWith("```")) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      i++;
      html.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
    } else if ((m = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/))) {
      html.push(`<figure><img src="${media(m[2])}" alt="${escape(m[1])}" loading="lazy"><figcaption>${inline(m[1])}</figcaption></figure>`);
      i++;
    } else if (line.startsWith("|")) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith("|"); i++) rows.push(lines[i].replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      const [head, , ...body] = rows;
      html.push(`<div class="lml-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    } else if (line.startsWith(">")) {
      const quote = [];
      for (; i < lines.length && lines[i].startsWith(">"); i++) quote.push(lines[i].replace(/^>\s?/, ""));
      html.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
    } else if (/^(\s*)([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      // A numbered list broken by a picture goes on counting where it stopped.
      const start = ordered ? Number(line.match(/^\s*(\d+)\./)[1]) : 1;
      const items = [];
      for (; i < lines.length; i++) {
        const l = lines[i];
        if (/^([-*]|\d+\.)\s/.test(l)) items.push(l.replace(/^([-*]|\d+\.)\s+/, ""));
        else if (/^\s+\S/.test(l) && items.length) items[items.length - 1] += " " + l.trim();
        else break;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}${start > 1 ? ` start="${start}"` : ""}>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</${tag}>`);
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() && !/^(#|\||>|```|!\[|([-*]|\d+\.)\s)/.test(lines[i]); i++) para.push(lines[i].trim());
      html.push(`<p>${inline(para.join(" "))}</p>`);
    }
  }
  return html.join("\n");
}

const STYLE = `
.lml-doc{--lml-accent:#ff6a2b;--lml-line:rgba(127,127,127,.25);line-height:1.65;max-width:900px;margin:0 auto}
.lml-doc h2{margin:2.6em 0 .6em;padding-top:.4em;border-top:1px solid var(--lml-line)}
.lml-doc h3{margin:1.8em 0 .5em}
.lml-doc figure{margin:1.4em 0;text-align:center}
.lml-doc figure img{max-width:100%;height:auto;border-radius:8px;box-shadow:0 2px 14px rgba(0,0,0,.25)}
.lml-doc figcaption{font-size:.88em;opacity:.75;margin-top:.5em}
.lml-doc .lml-table{overflow-x:auto;margin:1.2em 0}
.lml-doc table{border-collapse:collapse;width:100%;font-size:.95em}
.lml-doc th,.lml-doc td{border:1px solid var(--lml-line);padding:.45em .7em;text-align:left;vertical-align:top}
.lml-doc th{background:rgba(127,127,127,.1)}
.lml-doc code{background:rgba(127,127,127,.15);padding:.1em .35em;border-radius:4px;font-size:.92em}
.lml-doc pre{background:rgba(127,127,127,.12);padding:1em;border-radius:8px;overflow-x:auto}
.lml-doc pre code{background:none;padding:0}
.lml-doc blockquote{border-left:4px solid var(--lml-accent);margin:1.2em 0;padding:.4em 1em;background:rgba(255,106,43,.07)}
.lml-doc nav.lml-toc{border:1px solid var(--lml-line);border-radius:10px;padding:1em 1.4em;margin:1.5em 0}
.lml-doc nav.lml-toc ol{columns:2;column-gap:2em;margin:0;padding-left:1.4em}
@media (max-width:700px){.lml-doc nav.lml-toc ol{columns:1}}
`;

const titles = chapters.map((file) => (fs.readFileSync(path.join(dir, file), "utf8").match(/^#\s+(.*)$/m) ?? [, file])[1]);
const toc = `<nav class="lml-toc" id="lml-contents"><strong>Contents</strong><ol>${chapters.map((f, n) => `<li><a href="#${anchorOf(f)}">${inline(titles[n].replace(/^\d+\.\s*/, ""))}</a></li>`).join("")}</ol></nav>`;
const intro = `<p>The complete manual of <a href="https://github.com/${repo}">LazyMapLayers</a>, the free map design and map animation panel for After Effects: every option, one chapter at a time, with the panel as you will see it and the result in After Effects. The same manual is <a href="https://github.com/${repo}/tree/main/docs/manual">on GitHub</a>.</p>`;
const body = chapters.map((f) => `<section>\n${convert(fs.readFileSync(path.join(dir, f), "utf8"), f)}\n</section>`).join("\n");
const out = path.join(root, ".cache", "manual", "wordpress");
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, "lazymaplayers-documentation.html");
fs.writeFileSync(file, `<!-- LazyMapLayers manual, built from docs/manual at ${ref} by tools/manual/wordpress.mjs. Paste into a Custom HTML block. -->\n<style>${STYLE}</style>\n<div class="lml-doc">\n${intro}\n${toc}\n${body}\n</div>\n`);
console.log(`${path.relative(root, file)}: ${chapters.length} chapters, pictures at ${repo}@${ref}`);
