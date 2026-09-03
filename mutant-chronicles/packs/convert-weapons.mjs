/**
 * convert-weapons.mjs — turns Weapons.txt into the WEAPONS array inside
 * build-weapons-compendium.js.
 *
 * Usage (from anywhere):
 *   node mutant-chronicles/packs/convert-weapons.mjs "C:\path\to\Weapons.txt"
 *
 * Weapons.txt format: one weapon per line, "Key: value" pairs separated by "; ".
 * Description must be the LAST field (it may itself contain semicolons).
 * Lines whose Code is "CODE" are treated as blank templates and skipped.
 *
 * Fields used: Type, Entry, Code, Name, Manufacturer, Corp, Restriction, Cost,
 *              Range, Damage, Mode, Encumbrance, Size, Reliability, Qualities,
 *              Page (optional), Blurb (optional), Description (ignored — the
 *              public repo only gets manufacturer + page ref + short blurb).
 */

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Config you may want to extend ────────────────────────────────────────────

/** Weapon Types that use the Heavy Weapons skill. Everything else is `ranged`
 *  unless listed in MELEE_TYPES. Add categories here as you enter them. */
const HEAVY_TYPES = new Set(["Machine Gun", "Rocket Launcher", "Flamethrower", "Grenade Launcher"]);
const MELEE_TYPES = new Set(["Melee", "Blade", "Blunt", "Chainsaw"]);
const UNARMED_TYPES = new Set(["Unarmed"]);

const RANGE_MAP = { R: "Reach", C: "Close", M: "Medium", L: "Long", E: "Extreme" };

// ── Parsing ──────────────────────────────────────────────────────────────────

const KNOWN_KEYS = [
  "Type", "Entry", "Code", "Name", "Manufacturer", "Corp", "Restriction", "Cost",
  "Range", "Damage", "Mode", "Encumbrance", "Size", "Reliability", "Qualities",
  "Page", "Blurb", "Description"
];

/** Parse one line into an object. Splits only on "; Key:" for known keys, so a
 *  semicolon inside a value (e.g. in a Description) is left alone. */
function parseLine(line) {
  const out = {};
  // Build a regex that finds "Key: " at the start or after "; " for known keys only.
  const keyAlt = KNOWN_KEYS.join("|");
  const re = new RegExp(`(?:^|; )(${keyAlt}): `, "g");
  const hits = [...line.matchAll(re)];
  hits.forEach((hit, i) => {
    const start = hit.index + hit[0].length;
    const end   = i + 1 < hits.length ? hits[i + 1].index : line.length;
    out[hit[1]] = line.slice(start, end).trim();
  });
  return out;
}

/** "1+%4" / "1+&4" / "2+§3" / "1+4DSD" → { flat: 1, dice: 4 }; "As Grenade" → zeros. */
function parseDamage(text) {
  const m = text.match(/^(\d+)\s*\+\s*(?:[%&§]\s*(\d+)|(\d+)\s*(?:DSD|CD)?)$/i);
  if (!m) return { flat: 0, dice: 0 };
  return { flat: Number(m[1]), dice: Number(m[2] ?? m[3]) };
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

function weaponTypeFor(type) {
  if (HEAVY_TYPES.has(type))   return "heavy";
  if (MELEE_TYPES.has(type))   return "melee";
  if (UNARMED_TYPES.has(type)) return "unarmed";
  return "ranged";
}

function buildEntry(r) {
  const dmg = parseDamage(r.Damage ?? "");
  const [part, of] = (r.Entry ?? "1/1").split("/").map(Number);

  const descBits = [];
  if (r.Manufacturer) descBits.push(r.Manufacturer);
  if (r.Page)         descBits.push(`Core p.${r.Page}`);
  const description = [descBits.join(" — "), r.Blurb ?? ""].filter(Boolean).join(". ").replace(/\.\.$/, ".");

  const entry = {
    name:         r.Name,
    folder:       r.Type,
    weaponType:   weaponTypeFor(r.Type),
    range:        RANGE_MAP[r.Range] ?? r.Range ?? "—",
    damageFlat:   dmg.flat,
    damageDice:   dmg.dice,
    mode:         r.Mode || "—",
    enc:          toInt(r.Encumbrance),
    size:         r.Size || "—",
    reliability:  String(r.Reliability || "—"),
    qualities:    r.Qualities ?? "",
    restriction:  toInt(r.Restriction),
    cost:         toInt(r.Cost),
    manufacturer: r.Manufacturer ?? "",
    faction:      r.Corp ?? "",
    description
  };
  if (of > 1) entry.linked = { code: r.Code, part, of };
  return entry;
}

// ── Emit ─────────────────────────────────────────────────────────────────────

function emit(entries) {
  const lines = ["const WEAPONS = ["];
  let lastFolder = null;
  for (const e of entries) {
    if (e.folder !== lastFolder) {
      lines.push(`  // ── ${e.folder.toUpperCase()} ${"─".repeat(Math.max(4, 70 - e.folder.length))}`);
      lastFolder = e.folder;
    }
    lines.push("  " + JSON.stringify(e) + ",");
  }
  lines.push("];");
  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

const src = process.argv[2];
if (!src) {
  console.error('Usage: node convert-weapons.mjs "<path to Weapons.txt>"');
  process.exit(1);
}

const rows = fs.readFileSync(src, "utf8")
  .split(/\r?\n/)
  .filter(l => l.trim())
  .map(parseLine)
  .filter(r => r.Code && r.Code !== "CODE");

const problems = [];
for (const r of rows) {
  if (!r.Name) problems.push(`Missing Name on line with Code "${r.Code}"`);
  if (r.Damage && !/^As /i.test(r.Damage) && parseDamage(r.Damage).flat === 0 && parseDamage(r.Damage).dice === 0)
    problems.push(`${r.Name}: could not parse Damage "${r.Damage}"`);
  if (r.Range && !RANGE_MAP[r.Range]) problems.push(`${r.Name}: unknown Range "${r.Range}"`);
}
if (problems.length) console.warn("Warnings:\n  " + problems.join("\n  "));

// Sanity check multi-part weapons: every 1/N should have parts 2..N present.
const byCode = new Map();
for (const r of rows) (byCode.get(r.Code) ?? byCode.set(r.Code, []).get(r.Code)).push(r.Entry);
for (const [code, parts] of byCode) {
  const of = Number(parts[0].split("/")[1]);
  if (parts.length !== of) console.warn(`Warning: ${code} declares ${of} parts but ${parts.length} found`);
}

const entries = rows.map(buildEntry);

// Part 2+ of a multi-part weapon gets its parent's name appended, so it's
// obvious in the compendium and on the Gear tab what it belongs to.
const primaryName = new Map(rows.filter(r => (r.Entry ?? "1/1").startsWith("1/")).map(r => [r.Code, r.Name]));
for (const e of entries) {
  if (e.linked && e.linked.part > 1) e.name = `${e.name} (${primaryName.get(e.linked.code) ?? e.linked.code})`;
}

const here   = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "build-weapons-compendium.js");
const macro  = fs.readFileSync(target, "utf8");
const START  = "// ── DATA START";
const END    = "// ── DATA END";
const s = macro.indexOf(START), e = macro.indexOf(END);
if (s < 0 || e < 0) { console.error("Markers not found in build-weapons-compendium.js"); process.exit(1); }
const startLineEnd = macro.indexOf("\n", s) + 1;
const updated = macro.slice(0, startLineEnd) + emit(entries) + "\n" + macro.slice(e);
fs.writeFileSync(target, updated, "utf8");

console.log(`Wrote ${entries.length} weapons (${byCode.size} codes, ${new Set(entries.map(x => x.folder)).size} folders) into build-weapons-compendium.js`);
