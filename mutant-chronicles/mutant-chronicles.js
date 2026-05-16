/**
 * Mutant Chronicles 3rd Edition — main entry point.
 *
 * This file is loaded as an ES module by Foundry when the system initialises
 * (it's listed in system.json's "esmodules" array). Its job is to register
 * our custom document classes, sheet classes, and any helpers and settings.
 */

import { MC3Actor } from "./module/actor.js";
import { MC3Item }  from "./module/item.js";

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
});