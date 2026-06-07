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
import { rollDSD, sendDamageToChat } from "./module/dice/damage-roll.js";
import { PoolTrackerApp } from "./module/apps/pool-tracker.js";
import { MC3Combat }     from "./module/combat.js";

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
  CONFIG.Actor.documentClass  = MC3Actor;
  CONFIG.Item.documentClass   = MC3Item;
  CONFIG.Combat.documentClass = MC3Combat;

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

// ---------------------------------------------------------------------------
// Combat tracker — MC3 styling, roll-button suppression, up/down reorder
// arrows (GM only), disposition-based row colours, PC/NPC group divider,
// initiative-box hiding, and done-indicator for combatants whose turn has
// already passed this round.
//
// MC3 uses manual initiative ordering (PCs 100–51, NPCs 50–1). The GM clicks
// ↑/↓ to move a combatant one slot within its group. Moves that would cross
// the PC/NPC boundary are blocked.
// ---------------------------------------------------------------------------

/**
 * Move a combatant one slot up (direction = -1) or down (direction = 1).
 * Blocks moves that would cross the PC/NPC group boundary.
 */
async function moveCombatant(combatantId, direction) {
  const combat = game.combat;
  if (!combat) return;

  // Sort descending by initiative — this is the tracker's display order.
  const sorted = combat.combatants.contents
    .filter(c => c.initiative !== null)
    .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0));

  const idx       = sorted.findIndex(c => c.id === combatantId);
  const targetIdx = idx + direction;
  if (idx === -1 || targetIdx < 0 || targetIdx >= sorted.length) return;

  const mover    = sorted[idx];
  const neighbor = sorted[targetIdx];

  // Block moves that would cross the PC/NPC boundary.
  const moverIsPC    = mover.actor?.type    === 'character';
  const neighborIsPC = neighbor.actor?.type === 'character';
  if (moverIsPC !== neighborIsPC) {
    ui.notifications.warn('Cannot move across the PC/NPC boundary.');
    return;
  }

  if (mover.initiative === neighbor.initiative) {
    // Equal initiatives — nudge the mover to force a distinction.
    await combat.updateEmbeddedDocuments('Combatant', [{
      _id:        mover.id,
      initiative: mover.initiative + (direction < 0 ? 0.5 : -0.5),
    }]);
  } else {
    // Swap initiative values — Foundry re-sorts on the next render.
    await combat.updateEmbeddedDocuments('Combatant', [
      { _id: mover.id,    initiative: neighbor.initiative },
      { _id: neighbor.id, initiative: mover.initiative    },
    ]);
  }
}

Hooks.on('renderCombatTracker', (app, html, data) => {
  // v13 passes a raw HTMLElement here (not jQuery). Wrap once so we can use
  // .find(), .hide(), and .on() throughout without worrying about the API.
  const $html = $(html);
  $html.addClass('mc3-combat-tracker');

  // Hide per-combatant d20 roll button and header Roll All / Roll NPCs buttons.
  $html.find('[data-control="rollInitiative"]').hide();
  $html.find('[data-action="rollAll"], [data-action="rollNPC"]').hide();
  $html.find('.combat-control[title*="Initiative"]').hide();

  const combat = game.combat;

  // Build the turn-order list so we can mark "already acted" combatants.
  // combat.turn is the index (0-based) of the *current* combatant; everyone
  // with a lower sorted index has already had their turn this round.
  const sortedCombatants = (combat?.combatants.contents ?? [])
    .filter(c => c.initiative !== null)
    .sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0));
  const sortedIds = sortedCombatants.map(c => c.id);

  let firstNPCEl = null;   // track where to insert the ENEMIES divider

  $html.find('[data-combatant-id]').each((i, el) => {
    const $el       = $(el);
    const id        = el.dataset.combatantId;
    const combatant = combat?.combatants.get(id);
    if (!combatant) return;

    // ── Disposition-based row colour ──────────────────────────────────────
    const disposition = combatant.token?.disposition;
    if (disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) {
      $el.addClass('mc3-combatant-pc');
    } else if (disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE) {
      $el.addClass('mc3-combatant-npc');
    } else {
      $el.addClass('mc3-combatant-neutral');
    }

    // ── Track first NPC row for group divider ─────────────────────────────
    if (combatant.actor?.type !== 'character' && !firstNPCEl) {
      firstNPCEl = $el;
    }

    // ── Done indicator — dimmed + ✓ for combatants whose turn has passed ──
    const sortedIdx = sortedIds.indexOf(id);
    if (combat?.started && sortedIdx >= 0 && sortedIdx < (combat.turn ?? 0)) {
      $el.addClass('mc3-turn-done');
    }

    // ── Up/down arrows — GM only, guard against double-injection ──────────
    if (!game.user.isGM || $el.find('.mc3-init-arrows').length) return;

    const $arrows = $(`
      <div class="mc3-init-arrows">
        <a class="mc3-init-up"   title="Move Up"   data-id="${id}"><i class="fas fa-caret-up"></i></a>
        <a class="mc3-init-down" title="Move Down"  data-id="${id}"><i class="fas fa-caret-down"></i></a>
      </div>
    `);

    // Insert before the initiative box if present; otherwise append to the row.
    const $initBox = $el.find('.token-initiative');
    if ($initBox.length) $initBox.before($arrows);
    else $el.append($arrows);
  });

  // ── PC/NPC group divider ──────────────────────────────────────────────────
  if (firstNPCEl) {
    firstNPCEl.before('<li class="mc3-group-label">Enemies</li>');
  }

  // ── Wire click handlers ───────────────────────────────────────────────────
  if (!game.user.isGM) return;
  $html.find('.mc3-init-up, .mc3-init-down').on('click', async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const direction = ev.currentTarget.classList.contains('mc3-init-up') ? -1 : 1;
    await moveCombatant(ev.currentTarget.dataset.id, direction);
  });
});

// ---------------------------------------------------------------------------
// Momentum attrition — fires when the combat round advances.
//
// At the end of each combat round the Group Momentum Pool loses 1 point
// (min 0). This represents unspent momentum dissipating under pressure.
// Only runs on the GM client to avoid double-applying from multiple users.
// ---------------------------------------------------------------------------
Hooks.on('updateCombat', (combat, changed, options, userId) => {
  // Only the GM applies attrition (world setting change still broadcasts
  // to all clients via the updateSetting hook, keeping the pool tracker fresh).
  if (!game.user.isGM) return;

  // changed.round is present only when the round number actually changed.
  // Round 1 start (changed.round === 1) is combat beginning — no attrition yet.
  if (!changed.round || changed.round <= 1) return;

  const current = game.settings.get('mutant-chronicles', 'momentumPool');
  const newValue = Math.max(0, current - 1);
  game.settings.set('mutant-chronicles', 'momentumPool', newValue);

  // Post a brief chat notice so the table can see the pool shrink.
  ChatMessage.create({
    content: `<div class="mc3-attrition-notice">
      <i class="fas fa-bolt"></i>
      Round ${changed.round - 1} ended — Momentum Pool: ${newValue}
      <span class="attrition-delta">(-1 attrition)</span>
    </div>`,
    speaker: { alias: 'MC3 Combat' },
  });
});

// ---------------------------------------------------------------------------
// Interactive damage controls on weapon attack chat cards.
//
// This hook fires every time Foundry renders a chat message — on first
// creation, on page reload, and whenever the message document is updated
// (including flag changes). We use it to keep the damage controls in sync
// with the flags we store on each weapon attack card.
//
// State lives in message.flags['mutant-chronicles']:
//   rollMomentum    — Momentum generated by this specific roll; decreases as
//                     the player spends it on bonus DSD.
//   bonusDamageDice — extra DSD purchased so far; increases with each spend.
//
// When rollMomentum hits 0, further spends draw from the shared Momentum Pool
// (the world setting), which updates the Pool Tracker for all clients.
// ---------------------------------------------------------------------------
Hooks.on('renderChatMessage', (message, html) => {
  const mcFlags = message.flags?.['mutant-chronicles'];

  // Exit early if this card has nothing for us to wire up.
  const hasWeaponAttack  = mcFlags?.isWeaponAttack;
  const hasRepercussions = (mcFlags?.totalRepercussions ?? 0) > 0;
  if (!hasWeaponAttack && !hasRepercussions) return;

  // ── Repercussion row ──────────────────────────────────────────────────────
  // HBS renders the row whenever totalRepercussions > 0. We show/hide the
  // Bank button based on GM status, and hide the whole row once banked.
  if (hasRepercussions) {
    if (mcFlags.repercussionsBanked) {
      // Already handled — hide the entire row for everyone.
      html.find('.roll-card-repercussions').hide();
    } else if (!game.user.isGM) {
      // Players see the repercussion count but not the button — GM's call.
      html.find('.bank-repercussions-btn').hide();
    } else {
      // GM: wire up the Bank button.
      // Re-read flags inside the handler (stale closure guard).
      html.find('.bank-repercussions-btn').off('click').on('click', async () => {
        const msg       = game.messages.get(message.id);
        const reps      = msg?.flags?.['mutant-chronicles']?.totalRepercussions ?? 0;
        const dsGain    = reps * 2;   // +2 DS per repercussion
        const currentDS = game.settings.get('mutant-chronicles', 'darkSymmetryPool');
        await game.settings.set('mutant-chronicles', 'darkSymmetryPool', currentDS + dsGain);
        await msg.update({ 'flags.mutant-chronicles.repercussionsBanked': true });
        ui.notifications.info(`+${dsGain} added to the Dark Symmetry Pool.`);
      });
    }
  }

  // Exit here if this card has no weapon-attack controls to wire up.
  if (!hasWeaponAttack) return;

  const { weaponId, actorId } = mcFlags;
  const rollMomentum    = mcFlags.rollMomentum    ?? 0;
  const bonusDamageDice = mcFlags.bonusDamageDice ?? 0;

  // ── Update the live displays ──────────────────────────────────────────────

  html.find('.damage-momentum-remaining').html(
    rollMomentum > 0
      ? `+${rollMomentum} <i class="fas fa-bolt"></i>`
      : `Shared Pool <i class="fas fa-bolt"></i>`
  );

  const bonusEl = html.find('.damage-bonus-dsd');
  if (bonusDamageDice > 0) {
    bonusEl.html(`+${bonusDamageDice} <i class="fas fa-eclipse"></i>`).show();
  } else {
    bonusEl.hide();
  }

  // ── +1 DSD button ─────────────────────────────────────────────────────────
  // Re-read flags inside the handler to avoid stale closure values — the
  // document may have been updated since this render.
  html.find('.add-damage-die-btn').off('click').on('click', async () => {
    const msg  = game.messages.get(message.id);
    const f    = msg?.flags?.['mutant-chronicles'] ?? {};
    const curMom   = f.rollMomentum    ?? 0;
    const curBonus = f.bonusDamageDice ?? 0;

    if (curMom > 0) {
      // Spend from this roll's generated Momentum first.
      await msg.update({
        'flags.mutant-chronicles.rollMomentum':    curMom - 1,
        'flags.mutant-chronicles.bonusDamageDice': curBonus + 1,
      });
    } else {
      // Roll Momentum exhausted — fall back to the shared pool.
      const sharedPool = game.settings.get('mutant-chronicles', 'momentumPool');
      if (sharedPool <= 0) {
        ui.notifications.warn('No Momentum remaining to spend.');
        return;
      }
      await game.settings.set('mutant-chronicles', 'momentumPool', sharedPool - 1);
      await msg.update({
        'flags.mutant-chronicles.bonusDamageDice': curBonus + 1,
      });
    }
  });

  // ── Roll Damage button ────────────────────────────────────────────────────
  html.find('.roll-damage-btn').off('click').on('click', async () => {
    const actor  = game.actors.get(actorId);
    const weapon = actor?.items.get(weaponId);
    if (!actor || !weapon) {
      ui.notifications.warn('Could not find actor or weapon for this roll.');
      return;
    }
    if (!actor.isOwner) {
      ui.notifications.warn("You don't have permission to roll damage for this actor.");
      return;
    }
    // Re-read bonus dice from flags at click time (player may have spent more).
    const msg    = game.messages.get(message.id);
    const bonus  = msg?.flags?.['mutant-chronicles']?.bonusDamageDice ?? 0;
    const result = await rollDSD({ actor, weapon, bonusDamageDice: bonus });
    await sendDamageToChat(result);
  });
});