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
import { preloadHandlebarsTemplates } from "./module/templates.js";

const { Actors } = foundry.documents.collections;

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
});