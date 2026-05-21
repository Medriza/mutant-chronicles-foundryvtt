/**
 * MC3ItemSheet — the window that opens when a user double-clicks any Item
 * (skill, talent, weapon, armour, etc.) in a character sheet or the sidebar.
 *
 * Extends Foundry's ItemSheet. Overrides two key methods:
 *   - template (getter):  picks the right .hbs file based on item type
 *   - getData:            prepares the data object the Handlebars template renders
 *
 * Pattern mirrors MC3CharacterSheet and MC3NpcSheet exactly.
 */

const { ItemSheet } = foundry.appv1.sheets;

export class MC3ItemSheet extends ItemSheet {

  /**
   * Sheet configuration — size, CSS classes, no tabs (items are simple enough
   * to fit on a single panel).
   * @override
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['mc3', 'sheet', 'item'],
      width: 480,
      height: 360,
    });
  }

  /**
   * Pick the template file based on item type.
   * Skill items get their own dedicated template; every other type falls back
   * to a generic template until we build type-specific sheets in a later module.
   * @override
   */
  get template() {
    if (this.item.type === 'skill') {
      return 'systems/mutant-chronicles/templates/item/skill-sheet.hbs';
    }
    return 'systems/mutant-chronicles/templates/item/item-sheet.hbs';
  }

  /**
   * Prepare the data object passed to the Handlebars template.
   *
   * We start from the parent's context (which gives us `item`, `data`, etc.),
   * then lift `system` to the top level so templates can write {{system.attribute}}
   * instead of {{item.system.attribute}}.
   *
   * We also add an `attributes` object — a label map keyed by the camelCase
   * attribute names used in the data model. The skill-sheet template feeds
   * this into Foundry's {{selectOptions}} helper to build the attribute dropdown.
   * @override
   */
  async getData(options) {
    const context = await super.getData(options);

    // Lift system data to the top level for cleaner template references.
    context.system = this.item.system;

    // Attribute label map — keys match template.json attribute keys exactly.
    // {{selectOptions attributes selected=system.attribute}} renders these as
    // <option value="agility">Agility</option> etc.
    context.attributes = {
      agility:        'Agility',
      awareness:      'Awareness',
      coordination:   'Coordination',
      intelligence:   'Intelligence',
      mentalStrength: 'Mental Strength',
      personality:    'Personality',
      physique:       'Physique',
      strength:       'Strength',
    };

    // Parent skill options — only the 9 skills that have at least one advanced
    // child. Keys and values are identical (the skill name string is both the
    // stored value and the display label). {{selectOptions parentSkills selected=system.parentSkill blank="—"}}
    context.parentSkills = {
      'Close Combat':   'Close Combat',
      'Education':      'Education',
      'Observation':    'Observation',
      'Persuade':       'Persuade',
      'Pilot':          'Pilot',
      'Ranged Weapons': 'Ranged Weapons',
      'Survival':       'Survival',
      'Treatment':      'Treatment',
      'Willpower':      'Willpower',
    };

    return context;
  }
}
