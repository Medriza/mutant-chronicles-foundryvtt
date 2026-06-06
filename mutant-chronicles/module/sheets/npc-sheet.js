/**
 * MC3 NPC Sheet — the window a GM sees when opening an NPC actor.
 *
 * Single page, no tabs. Covers two wound-display modes toggled by
 * system.useLocationWounds:
 *   false (default) — simplified: one wound pool + per-location soak values
 *   true            — location:   per-location wounds (Head / Torso / Arms /
 *                     Legs / Serious / Critical) + Mental Wounds +/− track
 *
 * NPC item sections use the same embedded-item types as the PC sheet, but
 * labelled differently:
 *   weapon      → Attacks
 *   talent      → Special Abilities
 *   specialability → Special Abilities (covers all NPC abilities, including Dark Symmetry)
 *
 * Fields of Expertise (Movement / Combat / Fortitude / Technical / Social /
 * Senses) are stored as inline actor data (system.expertise.*), not as
 * embedded items, because they are always the same six named fields.
 */
import { showExpertiseRollDialog }      from '../dice/roll-dialog.js';
import { rollMC3, sendRollToChat }      from '../dice/mc3-roll.js';

const { ActorSheet } = foundry.appv1.sheets;

export class MC3NpcSheet extends ActorSheet {

  /**
   * Sheet configuration. Single page, no tabs array.
   * @override
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['mc3', 'sheet', 'actor', 'npc'],
      template: 'systems/mutant-chronicles/templates/actor/npc-sheet.hbs',
      width:  700,
      height: 910,
      scrollY: ['.npc-body']
    });
  }

  /**
   * Build the template context.
   *
   * Simpler than the PC sheet: no wound-slot arrays, no tab groupings. We add:
   *   - aliases for system / flags (terser template references)
   *   - item buckets for the three NPC item sections
   *   - mentalWoundsCurrent: a plain count of filled slots for the +/− display
   *
   * @override
   */
  async getData(options) {
    const context = await super.getData(options);
    const { actor } = this;

    // Convenience aliases — same pattern as character-sheet.js.
    context.system = actor.system;
    context.flags  = actor.flags;

    // Item buckets for the two NPC sections.
    // specialAbilities uses the 'specialability' type (covers all NPC abilities,
    // including Dark Symmetry ones — they're all the same item type).
    context.attacks          = actor.items.filter(i => i.type === 'weapon');
    context.specialAbilities = actor.items
      .filter(i => i.type === 'specialability')
      .sort((a, b) => a.name.localeCompare(b.name));

    return context;
  }

  /**
   * Wire up event handlers after the sheet HTML renders.
   * @override
   */
  activateListeners(html) {
    super.activateListeners(html);
    html.find('.expertise-roll').click(this._onRollExpertise.bind(this));
    html.find('.weapon-attack').click(this._onWeaponAttack.bind(this));
    if (!this.isEditable) return;

    // Item CRUD — same pattern as character-sheet.js.
    html.find('.item-create').click(this._onItemCreate.bind(this));
    html.find('.item-edit').click(this._onItemEdit.bind(this));
    html.find('.item-delete').click(this._onItemDelete.bind(this));
  }

  /* ------------------------------------------------------------------------ */
  /*   Item CRUD (same logic as character-sheet.js)                           */
  /* ------------------------------------------------------------------------ */

  async _onItemCreate(event) {
    event.preventDefault();
    const type = event.currentTarget.dataset.itemType;
    const itemData = {
      name: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
      type
    };
    return this.actor.createEmbeddedDocuments('Item', [itemData]);
  }

  _onItemEdit(event) {
    event.preventDefault();
    const li   = event.currentTarget.closest('[data-item-id]');
    const item = this.actor.items.get(li.dataset.itemId);
    item.sheet.render(true);
  }

  async _onItemDelete(event) {
    event.preventDefault();
    const li = event.currentTarget.closest('[data-item-id]');
    return this.actor.deleteEmbeddedDocuments('Item', [li.dataset.itemId]);
  }

  /**
   * Intercept item drops to prevent duplicate special abilities.
   *
   * When a specialability is dropped onto the sheet, check whether the actor
   * already owns one with the same name. If so, increment its Rank (if isRanked)
   * rather than creating a second copy. All other item types pass through.
   *
   * @param {object|object[]} itemData
   * @override
   */
  async _onDropItemCreate(itemData) {
    const items = Array.isArray(itemData) ? itemData : [itemData];
    const toCreate = [];

    for (const data of items) {
      if (data.type === 'specialability') {
        const existing = this.actor.items.find(
          i => i.type === 'specialability' && i.name === data.name
        );
        if (existing) {
          if (existing.system.isRanked) {
            const newRank = (existing.system.rank ?? 1) + 1;
            await existing.update({ 'system.rank': newRank });
          }
          continue; // never create a duplicate, ranked or not
        }
      }
      toCreate.push(data);
    }

    if (toCreate.length) return super._onDropItemCreate(toCreate);
  }

  /**
   * Click on an attack name in the Attacks table: trigger a Combat FoE roll.
   *
   * NPCs don't differentiate weapon types — all attacks use the Combat Field
   * of Expertise regardless of whether the weapon is melee, ranged, or heavy.
   * This contrasts with the PC sheet, which maps weaponType → specific skill.
   */
  async _onWeaponAttack(event) {
    event.preventDefault();
    const li     = event.currentTarget.closest('[data-item-id]');
    const weapon = this.actor.items.get(li.dataset.itemId);
    if (!weapon) return;

    const expertise = this.actor.system.expertise?.combat;
    if (!expertise) return;

    const rollParams = await showExpertiseRollDialog(this.actor, 'combat', expertise);
    if (!rollParams?.numDice) return;
    const rollResult = await rollMC3({ ...rollParams, actor: this.actor });
    await sendRollToChat(rollResult);
  }

  async _onRollExpertise(event) {
    event.preventDefault();
    const field     = event.currentTarget.dataset.field;
    const expertise = this.actor.system.expertise[field];

    // Open the dialog. Null means the GM clicked Cancel — bail out.
    const rollParams = await showExpertiseRollDialog(this.actor, field, expertise);
    if (!rollParams) return;

    // Roll the dice and classify each result.
    if (!rollParams?.numDice) return;
    const rollResult = await rollMC3({ ...rollParams, actor: this.actor });
    await sendRollToChat(rollResult);
  }

}
