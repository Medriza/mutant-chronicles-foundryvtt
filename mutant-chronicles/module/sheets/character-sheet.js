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
import { showSkillRollDialog }          from '../dice/roll-dialog.js';
import { rollMC3, sendRollToChat }      from '../dice/mc3-roll.js';

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

    // Mental wound slots - build a display array matching the derived max.
    // storedSlots may have fewer entries than max (e.g. MENSTR just increased),
    // so we use optional chaining (?.) and nullish coalescing (??) to default
    // missing slots to false rather than crashing on undefined.
    // ── Mental Wounds ─────────────────────────────────────────────────────────
    // Physical max from the official MC3 character sheet: 20 boxes.
    // Active boxes = derived mentalWounds.max (= MEN attribute score).
    // Each slot carries its taint state independently of fill state.
    // 'state' drives the CSS class: 'filled' | 'active' | 'inactive'.
    const MENTAL_PHYSICAL_MAX = 20;
    const storedSlots = actor.system.mentalWounds.slots;
    const mentalMax = actor.system.mentalWounds.max;
    context.mentalWoundSlots = Array.from(
      { length: MENTAL_PHYSICAL_MAX },
      (_, i) => ({
        key:     String(i),
        tainted: storedSlots[String(i)]?.tainted ?? false,
        state:   i >= mentalMax                        ? 'inactive'
               : storedSlots[String(i)]?.filled        ? 'filled'
               :                                         'active',
      })
    );

    // ── Physical Wound Slots ───────────────────────────────────────────────────
    // Physical maxes from the official MC3 character sheet (the total printed
    // boxes, which are always more than any derived max from the table).
    // 'state' drives the CSS class: 'filled' | 'active' | 'inactive'.
    //   filled   → index < value  (wound taken)
    //   active   → value ≤ index < max  (available, empty)
    //   inactive → index ≥ max  (greyed out — beyond this character's capacity)
    const WOUND_PHYSICAL_MAX = {
      head: 10, torso: 12,
      leftArm: 10, rightArm: 10,
      leftLeg: 10, rightLeg: 10,
    };
    const SERIOUS_PHYSICAL_MAX  = 10;
    const CRITICAL_PHYSICAL_MAX = 6;

    const woundsData = actor.system.wounds;

    // lightWoundSlots is an array of location objects so the template can iterate
    // with a single {{#each}} and access loc, path, soak, and slots together.
    context.lightWoundSlots = Object.entries(woundsData.light).map(([loc, data]) => ({
      loc,
      path:  `system.wounds.light.${loc}`,
      soak:  data.soak ?? 0,
      slots: Array.from(
        { length: WOUND_PHYSICAL_MAX[loc] ?? 10 },
        (_, i) => ({
          state: i < data.value ? 'filled' : i < data.max ? 'active' : 'inactive',
        })
      ),
    }));

    context.seriousWoundSlots = {
      path:  'system.wounds.serious',
      slots: Array.from(
        { length: SERIOUS_PHYSICAL_MAX },
        (_, i) => ({
          state: i < woundsData.serious.value ? 'filled'
               : i < woundsData.serious.max   ? 'active'
               :                                'inactive',
        })
      ),
    };

    context.criticalWoundSlots = {
      path:  'system.wounds.critical',
      slots: Array.from(
        { length: CRITICAL_PHYSICAL_MAX },
        (_, i) => ({
          state: i < woundsData.critical.value ? 'filled'
               : i < woundsData.critical.max   ? 'active'
               :                                 'inactive',
        })
      ),
    };

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
    html.find('.skill-roll').click(this._onRollSkill.bind(this));

    // Don't wire up edit handlers if the current user can't edit the sheet
    // (e.g. a player viewing another player's sheet without owner permission).
    if (!this.isEditable) return;

    // Item management buttons. `.bind(this)` locks `this` to the sheet instance
    // inside the handler — the Lesson 1.4 `this` gotcha. (An arrow function
    // here would work too; both are common Foundry idioms.)
    html.find('.item-create').click(this._onItemCreate.bind(this));
    html.find('.item-edit').click(this._onItemEdit.bind(this));
    html.find('.item-delete').click(this._onItemDelete.bind(this));

    // Physical wound boxes — left-click fills next slot, right-click clears last.
    // Each box is a div.wound-slot; its ancestor carries data-wound-path so the
    // handler knows which field (system.wounds.light.head, etc.) to update.
    html.find('.wound-slot').click(this._onWoundFill.bind(this));
    html.find('.wound-slot').contextmenu(this._onWoundClear.bind(this));

    // Mental wound boxes — same left/right-click pattern, but the data model
    // uses per-slot objects ({ filled, tainted }) rather than a simple count,
    // so the handlers scan the slots object directly.
    html.find('.mental-slot').click(this._onMentalWoundFill.bind(this));
    html.find('.mental-slot').contextmenu(this._onMentalWoundClear.bind(this));
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

  /* ------------------------------------------------------------------------ */
  /*   Wound box handlers                                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * Left-click on a physical wound box: fill the next available slot.
   * Ignores clicks on inactive boxes (beyond the character's derived max).
   * The clicked box's ancestor carries data-wound-path, which maps directly
   * to a field in system.wounds (e.g. "system.wounds.light.head").
   */
  async _onWoundFill(event) {
    event.preventDefault();
    if (event.currentTarget.classList.contains('inactive')) return;
    const path = event.currentTarget.closest('[data-wound-path]').dataset.woundPath;
    const data  = foundry.utils.getProperty(this.actor.system, path.replace('system.', ''));
    const next  = Math.min((data.value ?? 0) + 1, data.max ?? 0);
    if (next !== data.value) await this.actor.update({ [`${path}.value`]: next });
  }

  /**
   * Right-click on a physical wound box: clear the last filled slot.
   */
  async _onWoundClear(event) {
    event.preventDefault();
    if (event.currentTarget.classList.contains('inactive')) return;
    const path = event.currentTarget.closest('[data-wound-path]').dataset.woundPath;
    const data  = foundry.utils.getProperty(this.actor.system, path.replace('system.', ''));
    const next  = Math.max((data.value ?? 0) - 1, 0);
    if (next !== data.value) await this.actor.update({ [`${path}.value`]: next });
  }

  /**
   * Left-click on a mental wound box: fill the leftmost unfilled active slot.
   * Mental wounds use per-slot objects ({ filled, tainted }) so we scan the
   * stored slots rather than incrementing a counter.
   */
  async _onMentalWoundFill(event) {
    event.preventDefault();
    if (event.currentTarget.classList.contains('inactive')) return;
    const max   = this.actor.system.mentalWounds.max;
    const slots = this.actor.system.mentalWounds.slots;
    for (let i = 0; i < max; i++) {
      if (!slots[String(i)]?.filled) {
        await this.actor.update({ [`system.mentalWounds.slots.${i}.filled`]: true });
        return;
      }
    }
  }

  /**
   * Right-click on a mental wound box: clear the rightmost filled active slot.
   */
  async _onMentalWoundClear(event) {
    event.preventDefault();
    if (event.currentTarget.classList.contains('inactive')) return;
    const max   = this.actor.system.mentalWounds.max;
    const slots = this.actor.system.mentalWounds.slots;
    for (let i = max - 1; i >= 0; i--) {
      if (slots[String(i)]?.filled) {
        await this.actor.update({ [`system.mentalWounds.slots.${i}.filled`]: false });
        return;
      }
    }
  }

  async _onRollSkill(event) {
    event.preventDefault();
    const li    = event.currentTarget.closest('[data-item-id]');
    const skill = this.actor.items.get(li.dataset.itemId);

    // Open the dialog. If the user cancels, rollParams is null — bail out.
    const rollParams = await showSkillRollDialog(this.actor, skill);
    if (!rollParams) return;

    if (!rollParams?.numDice) return;
    const rollResult = await rollMC3({ ...rollParams, actor: this.actor });
    await sendRollToChat(rollResult);
  }
}
