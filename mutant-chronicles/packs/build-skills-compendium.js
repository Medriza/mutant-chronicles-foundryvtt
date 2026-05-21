/**
 * MC3 Skills Compendium Builder
 *
 * Run this once as a Foundry Script Macro to populate the mc3-skills compendium
 * with all 29 MC3 skills, pre-configured with their correct attribute, isAdvanced
 * flag, and parentSkill value.
 *
 * HOW TO RUN:
 *   1. In Foundry, open the Macro Directory (hotbar icon or Compendium tab).
 *   2. Create a new macro, set type to "Script".
 *   3. Paste the entire contents of this file into the macro editor.
 *   4. Click Execute.
 *   5. You should see a confirmation notification: "Created 29 skills..."
 *
 * SAFE TO RE-RUN: The script checks for existing entries first and skips
 * any skill that is already in the compendium, so running it twice won't
 * create duplicates.
 */

const PACK_ID = "mutant-chronicles.mc3-skills";

// All 29 skills with their confirmed attribute assignments, advanced status,
// and parent skill (empty string = not an advanced skill).
const SKILLS = [
  // ── AGILITY ────────────────────────────────────────────────────────────────
  { name: "Acrobatics",     attribute: "agility",       isAdvanced: false, parentSkill: "" },
  { name: "Close Combat",   attribute: "agility",       isAdvanced: false, parentSkill: "" },
  { name: "Unarmed Combat", attribute: "agility",       isAdvanced: true,  parentSkill: "Close Combat" },
  { name: "Stealth",        attribute: "agility",       isAdvanced: false, parentSkill: "" },

  // ── AWARENESS ──────────────────────────────────────────────────────────────
  { name: "Observation",    attribute: "awareness",     isAdvanced: false, parentSkill: "" },
  { name: "Insight",        attribute: "awareness",     isAdvanced: true,  parentSkill: "Observation" },
  { name: "Thievery",       attribute: "awareness",     isAdvanced: false, parentSkill: "" },

  // ── COORDINATION ───────────────────────────────────────────────────────────
  { name: "Ranged Weapons", attribute: "coordination",  isAdvanced: false, parentSkill: "" },
  { name: "Heavy Weapons",  attribute: "coordination",  isAdvanced: true,  parentSkill: "Ranged Weapons" },
  { name: "Gunnery",        attribute: "coordination",  isAdvanced: true,  parentSkill: "Ranged Weapons" },
  { name: "Pilot",          attribute: "coordination",  isAdvanced: false, parentSkill: "" },
  { name: "Space",          attribute: "coordination",  isAdvanced: true,  parentSkill: "Pilot" },

  // ── INTELLIGENCE ───────────────────────────────────────────────────────────
  { name: "Education",      attribute: "intelligence",  isAdvanced: false, parentSkill: "" },
  { name: "Linguistics",    attribute: "intelligence",  isAdvanced: true,  parentSkill: "Education" },
  { name: "Science",        attribute: "intelligence",  isAdvanced: true,  parentSkill: "Education" },
  { name: "Mechanics",      attribute: "intelligence",  isAdvanced: false, parentSkill: "" },
  { name: "Survival",       attribute: "intelligence",  isAdvanced: false, parentSkill: "" },
  { name: "Vacuum",         attribute: "intelligence",  isAdvanced: true,  parentSkill: "Survival" },
  { name: "Treatment",      attribute: "intelligence",  isAdvanced: false, parentSkill: "" },
  { name: "Medicine",       attribute: "intelligence",  isAdvanced: true,  parentSkill: "Treatment" },
  { name: "Psychotherapy",  attribute: "intelligence",  isAdvanced: true,  parentSkill: "Treatment" },

  // ── MENTAL STRENGTH ────────────────────────────────────────────────────────
  { name: "Willpower",      attribute: "mentalStrength",isAdvanced: false, parentSkill: "" },
  { name: "Mysticism",      attribute: "mentalStrength",isAdvanced: true,  parentSkill: "Willpower" },

  // ── PERSONALITY ────────────────────────────────────────────────────────────
  { name: "Animal Handling",attribute: "personality",  isAdvanced: false, parentSkill: "" },
  { name: "Lifestyle",      attribute: "personality",  isAdvanced: false, parentSkill: "" },
  { name: "Persuade",       attribute: "personality",  isAdvanced: false, parentSkill: "" },
  { name: "Command",        attribute: "personality",  isAdvanced: true,  parentSkill: "Persuade" },

  // ── PHYSIQUE ───────────────────────────────────────────────────────────────
  { name: "Resistance",     attribute: "physique",      isAdvanced: false, parentSkill: "" },

  // ── STRENGTH ───────────────────────────────────────────────────────────────
  { name: "Athletics",      attribute: "strength",      isAdvanced: false, parentSkill: "" },
];

// ── Main ─────────────────────────────────────────────────────────────────────

const pack = game.packs.get(PACK_ID);
if (!pack) {
  ui.notifications.error(`Compendium "${PACK_ID}" not found. Check that system.json declares it and Foundry has been restarted.`);
  return;
}

// Load existing entries so we can skip any that are already present.
await pack.getDocuments();
const existingNames = new Set(pack.contents.map(i => i.name));

const toCreate = SKILLS
  .filter(s => !existingNames.has(s.name))
  .map(s => ({
    name: s.name,
    type: "skill",
    system: {
      attribute:   s.attribute,
      expertise:   0,
      focus:       0,
      isSignature: false,
      isAdvanced:  s.isAdvanced,
      parentSkill: s.parentSkill,
    }
  }));

if (toCreate.length === 0) {
  ui.notifications.info("MC3 Skills compendium is already complete — nothing to create.");
  return;
}

await Item.createDocuments(toCreate, { pack: PACK_ID });
ui.notifications.info(`MC3 Skills | Created ${toCreate.length} skill(s) in the compendium.`);
