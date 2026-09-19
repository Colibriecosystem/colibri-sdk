#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Do the hand-written clients cover the schema?
//
// docs/openapi.yaml is a COPY of the terminal's src/ScalpTerminal.LocalApi/openapi.yaml, which is
// the source of truth. The terminal's own gate guarantees the schema matches the terminal. Nothing
// guaranteed that THESE clients match the schema — so an author could read `getWorkspace` on
// sdk.colibritech.xyz, open the JS SDK, and find no such method. This closes that.
//
// It scrapes the clients rather than reading a manifest they declare, deliberately: a manifest is
// another thing that can drift from the methods beside it. A path literal is in the call that
// actually issues the request.
//
//   node tools/check-clients.mjs            report, exit 1 on a gap
//   node tools/check-clients.mjs --list     also print what each client covers
//   node tools/check-clients.mjs --write-baseline   record today's gaps after filling some
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const listOnly = process.argv.includes("--list");

// ── what the schema publishes ────────────────────────────────────────────────
function schemaOperations() {
  const text = readFileSync(join(root, "docs/openapi.yaml"), "utf8");
  const ops = [];
  let path = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const p = /^ {2}(\/[^\s:]*):\s*$/.exec(line);
    if (p) {
      path = p[1];
      continue;
    }
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m && path) ops.push(`${m[1].toUpperCase()} ${path}`);
  }
  if (ops.length === 0) throw new Error("No operations scraped from docs/openapi.yaml — did its shape change?");
  return ops;
}

// A client writes `/connections/${id}/orders`; the schema writes `/connections/{id}/orders`. Fold
// every interpolation to a single placeholder so the two are comparable, then match positionally.
function normalise(p) {
  // Fold every BALANCED brace group to a single placeholder, counting depth rather than matching
  // `\{[^}]*\}`. C# interpolations nest — `$"…/book{(depth is null ? "" : $"?depth={depth}")}"` —
  // and a non-recursive fold stops at the inner `}`, leaving debris that never matches anything.
  // JS writes `${x}`; the "$" belongs to the interpolation, not to the path, so drop it before the
  // scan or every JS path keeps a stray "$" and matches nothing.
  const src = p.replace(/\$\{/g, "{");

  let out = "";
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "{") {
      if (depth === 0) out += "{}";
      depth++;
      continue;
    }
    if (c === "}") {
      if (depth > 0) depth--;
      continue;
    }
    if (depth === 0) out += c;
  }

  // Only now split on "?": a conditional query lives INSIDE an interpolation, so splitting earlier
  // would truncate the path at a question mark that is not a query separator.
  out = out.split("?")[0].replace(/\/+$/, "");

  // A placeholder GLUED to the last segment came from a query being appended, not another path
  // segment. A real parameter segment always has a "/" in front of it — that is the tell.
  return out.replace(/(?<=[^/])\{\}$/, "");
}

const templates = schemaOperations().map((op) => {
  const [method, path] = op.split(" ");
  return { op, method, key: `${method} ${normalise(path)}` };
});

// ── what each client calls ───────────────────────────────────────────────────
// Each entry says how that language spells a request. Anything not matched here is simply not
// counted, which is why the report prints per-client totals: a scrape that silently stops matching
// shows up as a cliff, not as a pass.
const clients = [
  {
    name: "js",
    files: ["js/src/client.ts", "js/src/socket.ts"],
    // this.req<T>("GET", "/path") | this.req("GET", `/path/${x}`)
    // The two delimiters are matched SEPARATELY: a template literal legitimately contains double
    // quotes inside its interpolations — `/app/panels${qs ? "?" + qs : ""}` — so a character class
    // of [`"] truncates the path at the first one and reports a gap that is not there.
    pattern: /\breq(?:<[^>]*>)?\(\s*"(GET|POST|PUT|PATCH|DELETE)"\s*,\s*(?:"([^"]+)"|`([^`]+)`)/g,
  },
  {
    name: "python",
    files: ["python/colibri/client.py", "python/colibri/socket.py"],
    // self._req("GET", "/path")  |  self._req("GET", f"/path/{x}")
    pattern: /_req\(\s*"(GET|POST|PUT|PATCH|DELETE)"\s*,\s*f?"([^"]+)"/g,
  },
  {
    name: "dotnet",
    files: ["dotnet/Colibri.Sdk/ColibriClient.cs"],
    // SendAsync<T>(HttpMethod.Post, $"/path", …)
    pattern: /SendAsync(?:<[^>]*>)?\(\s*HttpMethod\.(Get|Post|Put|Patch|Delete)\s*,\s*\$?"([^"]+)"/g,
  },
  {
    name: "dotnet",
    files: ["dotnet/Colibri.Sdk/ColibriClient.cs"],
    // GetAsync<T>("/path", ct) — the verb lives in the helper's NAME here, not an argument.
    pattern: /GetAsync(?:<[^>]*>)?\(\s*\$?"([^"]+)"/g,
    method: "GET",
  },
];

const covered = new Map();   // client → Set of "METHOD /normalised"
for (const c of clients) {
  const set = covered.get(c.name) ?? new Set();
  for (const f of c.files) {
    let text;
    try {
      text = readFileSync(join(root, f), "utf8");
    } catch {
      continue; // a client may legitimately not have that file
    }
    for (const m of text.matchAll(c.pattern)) {
      const method = c.method ?? m[1].toUpperCase();
      const path = c.method ? m[1] : (m[2] ?? m[3]);
      if (!path.startsWith("/")) continue;
      set.add(`${method} ${normalise(path)}`);
    }
  }
  covered.set(c.name, set);
}

// ── report ───────────────────────────────────────────────────────────────────
// Operations no client is expected to expose, each for a stated reason.
const exempt = new Map([
  ["GET /stream", "a WebSocket upgrade — the socket module handles it, not the REST client"],
  ["GET /openapi.yaml", "the schema itself; a client does not consume its own contract at runtime"],
  ["GET /asyncapi.yaml", "the schema itself"],
]);

// A ratchet, not a wall. There are real gaps today — the workspace surface is not implemented in
// the terminal yet, and the closed-trade routes drifted in before anything compared these files —
// and blocking every PR on them would just get the check disabled. So: anything in the baseline is
// reported and tolerated; anything NEW fails. The baseline may only shrink, which is enforced from
// the other end too: an entry that is now covered must be deleted, or a later regression could hide
// behind it.
const baselinePath = join(root, "tools/client-gaps.json");
let baseline = {};
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch {
  baseline = {};
}

let failed = false;
const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));

const nextBaseline = {};

for (const [name, set] of covered) {
  const missing = templates.filter((t) => !set.has(t.key) && !exempt.has(t.op));
  const skipped = templates.filter((t) => !set.has(t.key) && exempt.has(t.op));
  const have = templates.length - missing.length - skipped.length;

  const known = new Set(baseline[name] ?? []);
  const fresh = missing.filter((t) => !known.has(t.op));
  const fixed = [...known].filter((op) => !missing.some((t) => t.op === op));

  nextBaseline[name] = missing.map((t) => t.op);
  if (fresh.length > 0 || fixed.length > 0) failed = true;

  const ok = fresh.length === 0 && fixed.length === 0;
  const note = missing.length > 0 ? `  (${missing.length} known gap${missing.length === 1 ? "" : "s"})` : "";
  console.log(
    `${ok ? "\x1b[32mOK  \x1b[0m" : "\x1b[31mGAP \x1b[0m"} ${pad(name, 8)} ${have}/${templates.length - skipped.length} operations${note}`,
  );

  if (listOnly) {
    for (const t of templates.filter((t) => set.has(t.key))) console.log(`         · ${t.op}`);
    for (const t of missing.filter((t) => known.has(t.op))) console.log(`     \x1b[90mknown  ${t.op}\x1b[0m`);
  }
  for (const t of fresh) console.log(`     \x1b[31mNEW GAP\x1b[0m ${t.op}`);
  for (const op of fixed) console.log(`     \x1b[33mcovered now — drop it from the baseline\x1b[0m ${op}`);
  for (const t of skipped) console.log(`     \x1b[90mskip   ${t.op} — ${exempt.get(t.op)}\x1b[0m`);
}

if (process.argv.includes("--write-baseline")) {
  writeFileSync(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`);
  console.log("\nBaseline written to tools/client-gaps.json");
  process.exit(0);
}

if (failed) {
  console.log("");
  console.log("A NEW GAP means the schema grew an operation no client exposes — an author reading");
  console.log("sdk.colibritech.xyz would find the docs and the SDK disagree. Add the method, or give");
  console.log("the operation a stated exemption in tools/check-clients.mjs.");
  console.log("");
  console.log("\"covered now\" means a known gap was filled: run --write-baseline and commit, so the");
  console.log("baseline can never hide a later regression behind a stale entry.");
}

process.exit(failed ? 1 : 0);
