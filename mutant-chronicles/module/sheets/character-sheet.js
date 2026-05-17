/**
 * MC3 Character Sheet — the window the GM/player sees when opening a character actor.
 *
 * Extends Foundry's ActorSheet. Overrides three key methods:
 *   - defaultOptions:     configures the sheet (template, size, tabs, CSS classes)
 *   - getData:            prepares the data object the Handlebars template renders
 *   - activateListeners:  wires up DOM event handlers after the sheet renders
 *
 * Plus several private event-handler methods (_onItemCreate, _onItemEdit, etc.).
 */
const { ActorSheet } = foundry.appv1.sheets;

export class MC3CharacterSheet extends ActorSheet {

  /**
   * Sheet configuration. Foundry reads this once to know how to set up our window.
   * Pattern: call super.defaultOptions and mergeObject our customizations on top.
   * @override
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['mc3', 'sheet', 'actor', 'character'],
      template: 'systems/mutant-chronicles/templates/actor/character-sheet.hbs',
      width: 800,
      height: 800,
      tabs: [{
        navSelector: '.sheet-tabs',
        contentSelector: '.sheet-body',
        initial: 'stats'
      }],
      scrollY: ['.sheet-body']
    });
  }

  /**
   * Prepare the data object the Handlebars template will use as its context.
   * Foundry calls this each time the sheet renders. We start from the parent's
   * context, then add MC3-specific conveniences: aliases, item categorization,
   * skills grouped by attribute.
   * @override
   */
  async getData(options) {
    const context = await super.getData(options);

    // Destructure `actor` out of `this` for terser references below.
    // (This is the destructuring syntax from Lesson 1.3 — pulls a property
    // out of an object into a standalone variable in one line.)
    const { actor } = this;

    // Convenience aliases — lets the template write {{system.attributes.agility.value}}
    // instead of {{actor.system.attributes.agility.value}}.
    context.system = actor.system;
    context.flags = actor.flags;

    // Bucket the actor's embedded items by type. This uses Array.prototype.filter
    // from Lesson 1.3 — Foundry stores all embedded items in one collection
    // (actor.items), and the template wants them split per type so it can render
    // weapons in the Weapons section, talents in the Talents tab, etc.
    context.skills    = actor.items.filter(i => i.type === 'skill');
    context.talents   = actor.items.filter(i => i.type === 'talent');
    context.weapons   = actor.items.filter(i => i.type === 'weapon');
    context.armours   = actor.items.filter(i => i.type === 'armour');
    context.equipment = actor.items.filter(i => i.type === 'equipment');
    context.spells    = actor.items.filter(i => i.type === 'spell');

    // Skills tab renders skills grouped under their fixed governing attribute
    // (per the Lesson 5.1 design + the corrected MC3 mechanic that skills
    // always pair with one specific attribute).
    context.skillsByAttribute = this._groupSkillsByAttribute(context.skills);

    return context;
  }

  /**
   * Helper: organize the actor's skill items into buckets keyed by attribute,
   * matching the MC3 character sheet's central-column layout.
   * @private
   */
  _groupSkillsByAttribute(skills) {
    const attributes = ['agility', 'awareness', 'coordination', 'intelligence',
                        'mentalStrength', 'personality', 'physique', 'strength'];
    const groups = {};
    for (const attr of attributes) {
      groups[attr] = skills.filter(s => s.system.attribute === attr);
    }
    // Catch any skill items whose attribute field is blank or doesn't match
    // a known attribute — render them in a separate Unassigned cluster so the
    // GM can spot mis-tagged data.
    groups.unassigned = skills.filter(s => !attributes.includes(s.system.attribute));
    return groups;
  }

  /**
   * Called by Foundry after the sheet's HTML is rendered and inserted into the DOM.
   * This is where we attach event handlers to buttons, inputs, clickable rows, etc.
   * @override
   */
  activateListeners(html) {
    super.activateListeners(html);

    // Don't wire up edit handlers if the current user can't edit the sheet
    // (e.g. a player viewing another player's sheet without owner permission).
    if (!this.isEditable) return;

    // Item management buttons. `.bind(this)` locks `this` to the sheet instance
    // inside the handler — the Lesson 1.4 `this` gotcha. (An arrow function
    // here would work too; both are common Foundry idioms.)
    html.find('.item-create').click(this._onItemCreate.bind(this));
    html.find('.item-edit').click(this._onItemEdit.bind(this));
    html.find('.item-delete').click(this._onItemDelete.bind(this));

    // Wound box clicks, mental-slot clicks, skill rolls, etc. — wired in
    // later lessons (Module 5.3+ and Module 6).
  }

  /* ------------------------------------------------------------------------ */
  /*   Event handlers (private — only called from activateListeners)         */
  /* ------------------------------------------------------------------------ */

  /**
   * Create a new embedded item of the type indicated by a `data-item-type` attribute
   * on the clicked element. Wired to e.g. <a class="item-create" data-item-type="weapon">+</a>.
   */
  async _onItemCreate(event) {
    event.preventDefault();
    const type = event.currentTarget.dataset.itemType;
    const itemData = {
      name: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
      type: type
    };
    // createEmbeddedDocuments is async — it writes to Foundry's database and
    // returns a Promise resolving to the new item(s). Lesson 1.5 territory.
    return this.actor.createEmbeddedDocuments('Item', [itemData]);
  }

  /**
   * Open an embedded item's own sheet for editing.
   * Wired to a row's "edit" button. The clicked button is expected to live
   * inside an element with a `data-item-id` attribute identifying the item.
   */
  _onItemEdit(event) {
    event.preventDefault();
    const li = event.currentTarget.closest('[data-item-id]');
    const item = this.actor.items.get(li.dataset.itemId);
    item.sheet.render(true);
  }

  /**
   * Delete an embedded item.
   */
  async _onItemDelete(event) {
    event.preventDefault();
    const li = event.currentTarget.closest('[data-item-id]');
    return this.actor.deleteEmbeddedDocuments('Item', [li.dataset.itemId]);
  }
}
