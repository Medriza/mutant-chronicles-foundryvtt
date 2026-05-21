/**
 * Pre-load all Handlebars partials for the MC3 system.
 * Called once inside the 'init' hook in mutant-chronicles.js.
 *
 * Foundry's loadTemplates fetches each file over the network and registers
 * it as a Handlebars partial under the key you supply. Using a short key
 * (the path with the system prefix and file extension stripped) lets the
 * master template use clean {{> actor/character/tabs/tab-stats }} includes
 * rather than verbose full paths.
 *
 * Key derivation example:
 *   'systems/mutant-chronicles/templates/actor/character/tabs/tab-stats.hbs'
 *   → key: 'actor/character/tabs/tab-stats'
 *   → in a template: {{> actor/character/tabs/tab-stats}}
 */
export async function preloadHandlebarsTemplates() {
  const partials = [
    // PC sheet — tab partials
    "systems/mutant-chronicles/templates/actor/character/tabs/tab-stats.hbs",
    "systems/mutant-chronicles/templates/actor/character/tabs/tab-skills.hbs",
    "systems/mutant-chronicles/templates/actor/character/tabs/tab-talents.hbs",
    "systems/mutant-chronicles/templates/actor/character/tabs/tab-gear.hbs",
    "systems/mutant-chronicles/templates/actor/character/tabs/tab-bio.hbs",
    "systems/mutant-chronicles/templates/actor/character/tabs/tab-spells.hbs",
    "systems/mutant-chronicles/templates/actor/character/tabs/tab-lifepath.hbs",
  ];

  // Strip 'systems/mutant-chronicles/templates/' prefix (first 3 path segments)
  // and '.hbs' extension to produce a short partial key.
  const paths = {};
  for (const path of partials) {
    const [key] = path.split("/").slice(3).join("/").split(".");
    paths[key] = path;
  }

  await foundry.applications.handlebars.loadTemplates(paths);

  // Dice templates are used via renderTemplate(), not as partials, so they
  // don't need short keys — just preload the full paths so there is no
  // network delay when the first dialog or chat card fires.
  // NOTE: roll-chat.hbs is added here in Lesson 6.5 once the file exists.
  await foundry.applications.handlebars.loadTemplates([
    "systems/mutant-chronicles/templates/dice/roll-dialog.hbs",
    "systems/mutant-chronicles/templates/dice/roll-chat.hbs",
    "systems/mutant-chronicles/templates/item/skill-sheet.hbs",
    "systems/mutant-chronicles/templates/item/item-sheet.hbs",
  ]);
}
