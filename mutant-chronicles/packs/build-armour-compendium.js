/**
 * MC3 Armour Compendium Builder
 *
 * Run this once as a Foundry Script Macro to populate the mc3-armour compendium.
 * Safe to re-run — skips entries already present (matched by name).
 *
 * DATA NOTES
 *   soak is per hit location. Use the `soak()` helper for the common cases:
 *     soak(2)                 → 2 on every location
 *     soak({ torso: 3, head: 1 })  → listed locations only, 0 elsewhere
 *   Location keys: head, leftArm, rightArm, torso, leftLeg, rightLeg
 *   reliability: "—" | "0".."5" | "C"   ← a STRING, not a number
 *   description: one-line paraphrase + core-book page ref only (public repo).
 */

const PACK_ID = "mutant-chronicles.mc3-armour";

const LOCATIONS = ["head", "leftArm", "rightArm", "torso", "leftLeg", "rightLeg"];

/** Build a full six-location soak object from a number or a partial object. */
function soak(spec) {
  const out = {};
  for (const loc of LOCATIONS) {
    out[loc] = typeof spec === "number" ? spec : (spec[loc] ?? 0);
  }
  return out;
}

const DEFAULTS = {
  worn: false, soak: soak(0), faction: "", enc: 0, reliability: "—",
  restriction: 0, cost: 0, description: ""
};

const ARMOUR = [
  // { name: "Ballistic Nylon Clothing", soak: soak({ torso: 1, leftArm: 1, rightArm: 1 }),
  //   enc: 1, reliability: "1", restriction: 1, cost: 30, description: "Core p.XXX" },
];

// ── Main ─────────────────────────────────────────────────────────────────────

const pack = game.packs.get(PACK_ID);
if (!pack) {
  ui.notifications.error(`Compendium "${PACK_ID}" not found. Check that system.json declares it and Foundry has been restarted.`);
  return;
}

await pack.getDocuments();
const existingNames = new Set(pack.contents.map(i => i.name));

const toCreate = ARMOUR
  .filter(a => !existingNames.has(a.name))
  .map(({ name, ...fields }) => ({
    name,
    type: "armour",
    system: { ...DEFAULTS, ...fields }
  }));

if (toCreate.length === 0) {
  ui.notifications.info("MC3 Armour compendium is already complete — nothing to create.");
  return;
}

await Item.createDocuments(toCreate, { pack: PACK_ID });
ui.notifications.info(`MC3 Armour | Created ${toCreate.length} armour item(s) in the compendium.`);
