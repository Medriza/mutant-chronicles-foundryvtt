/**
 * Mutant Chronicles 3rd Edition — main entry point.
 *
 * This file is loaded as an ES module by Foundry when the system initialises
 * (it's listed in system.json's "esmodules" array). Its job is to register
 * our custom document classes, sheet classes, and any helpers and settings.
 */

import { MC3Actor } from "./module/actor.js";
import { MC3Item }  from "./module/item.js";
import { MC3CharacterSheet } from "./module/sheets/character-sheet.js";
import { MC3NpcSheet } from "./module/sheets/npc-sheet.js";
import { MC3ItemSheet } from "./module/sheets/item-sheet.js";
import { preloadHandlebarsTemplates } from "./module/templates.js";
import { registerRollHelpers } from "./module/dice/mc3-roll.js";
import { PoolTrackerApp } from "./module/apps/pool-tracker.js";

const { Actors, Items } = foundry.documents.collections;

/**
 * The 'init' hook fires once, very early in Foundry's startup — after the
 * settings system is online but before any documents are loaded from the
 * database. This is the right place to swap in our subclasses so Foundry
 * uses them when it later instantiates Actors and Items.
 */
Hooks.once('init', () => {
  console.log('MC3 | Initialising Mutant Chronicles 3rd Edition system');

  // Tell Foundry: when you instantiate an Actor, use MC3Actor instead of
  // the base Actor class. Same for Item.
  CONFIG.Actor.documentClass = MC3Actor;
  CONFIG.Item.documentClass  = MC3Item;

  // ---------------------------------------------------------------------------
  // World settings — persisted server-side, synced to all clients automatically.
  // config: false hides them from the Settings UI; we manage them via our own HUD.
  // ---------------------------------------------------------------------------
  game.settings.register('mutant-chronicles', 'momentumPool', {
    name: 'Group Momentum Pool',
    scope: 'world',
    config: false,
    type: Number,
    default: 0,
  });

  game.settings.register('mutant-chronicles', 'darkSymmetryPool', {
    name: 'Dark Symmetry Pool',
    scope: 'world',
    config: false,
    type: Number,
    default: 0,
  });

  // ---------------------------------------------------------------------------
  // Pool Tracker — register as a UI singleton so ui.mc3pools is always
  // available. The updateSetting hook and the hotbar macro both reference it.
  // Open via macro: ui.mc3pools.render({ force: true })
  // ---------------------------------------------------------------------------
  CONFIG.ui.mc3pools = PoolTrackerApp;

  // Register custom Handlebars helpers (ne, etc.) used by dice templates.
  registerRollHelpers();

  // Register Handlebars Partials
  preloadHandlebarsTemplates();

  // Register our character sheet as the default for the 'character' actor type.
  // makeDefault: true means Foundry uses ours when opening a character actor,
  // rather than the generic base ActorSheet.
  Actors.registerSheet('mutant-chronicles', MC3CharacterSheet, {
    types: ['character'],
    makeDefault: true,
    label: 'MC3.SheetClassCharacter'
  });
  Actors.registerSheet('mutant-chronicles', MC3NpcSheet, {
    types: ['npc'],
    makeDefault: true,
    label: 'MC3.SheetClassNpc'
  });

  // Register our item sheet for all item types.
  Items.registerSheet('mutant-chronicles', MC3ItemSheet, {
    makeDefault: true,
    label: 'MC3.SheetClassItem'
  });
});

// ---------------------------------------------------------------------------
// Re-render the pool tracker on every client whenever a pool setting changes.
//
// game.settings.set() for a world setting updates a Setting document on the
// server, which Foundry then broadcasts to all connected clients — triggering
// this hook on each machine. So the GM clicks +/−, and every player's sidebar
// tab refreshes automatically with the new value.
// ---------------------------------------------------------------------------
Hooks.on('updateSetting', (setting) => {
  if (
    setting.key === 'mutant-chronicles.momentumPool' ||
    setting.key === 'mutant-chronicles.darkSymmetryPool'
  ) {
    ui.mc3pools?.render();
  }
});