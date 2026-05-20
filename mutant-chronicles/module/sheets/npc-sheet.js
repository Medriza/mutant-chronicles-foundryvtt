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
 *   darksymmetry → Dark Symmetry Abilities
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
      height: 800,
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

    // Item buckets for the three NPC sections.
    // (Note: same item *types* as the PC sheet, different display labels.)
    context.attacks          = actor.items.filter(i => i.type === 'weapon');
    context.specialAbilities = actor.items.filter(i => i.type === 'talent');
    context.darkSymmetry     = actor.items.filter(i => i.type === 'darksymmetry');

    return context;
  }

  /**
   * Wire up event handlers after the sheet HTML renders.
   * @override
   */
  activateListeners(html) {
    super.activateListeners(html);
    html.find('.expertise-roll').click(this._onRollExpertise.bind(this));
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
