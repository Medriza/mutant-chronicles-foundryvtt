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


/**
 * Standard Category Bleed effects for each Gift of... category.
 * Keyed by the exact giftCategory value stored on the item.
 *
 * Auto-populated into the Category Bleed table when the Gift of... dropdown
 * is changed and the table is currently empty. Dark Symmetry Gift has no
 * standard category bleed, so it is intentionally omitted — selecting it
 * leaves the table blank for manual entry.
 *
 * Source: Mutant Chronicles 3rd Edition core rulebook.
 */
const CATEGORY_BLEED_DEFAULTS = {
  'Gift of Ilian': [
    {
      threshold: '1',
      effect: 'TRANSDIMENSIONAL IMPEDANCE: The area immediately around the Heretic is made treacherous by a thick rime of void-frost, a slick pool of protoplasmic slime, or some other extradimensional substance. This spreads outwards from the Heretic to cover the entire zone the Heretic is in, and forces all creatures other than the Heretic to pass an Average D1 Athletics or Acrobatics test to cross that area without slipping and falling prone. This remains for a number of hours equal to the gift\'s difficulty before dissipating.',
    },
    {
      threshold: '1+',
      effect: 'VOID-CHILL: The chill of the void is tangible in the wake of a gift\'s effect, causing breath to mist, frost to form, and liquids to freeze as heat is stolen away. This deep cold emanates from the Heretic, reaching out to cover the entire zone the Heretic is in. The ambient temperature within that area drops to below freezing almost instantly, inflicting 1+§2 damage to any creature other than the Heretic that fails an Average D1 Resistance test. The damage increases by §2 per Momentum spent. This sudden cold will also have a variety of environmental effects, such as freezing nearby liquids (including rain), subject to the GM\'s discretion. Warmth will return to the area over a number of minutes equal to the amount of Momentum spent.',
    },
    {
      threshold: '2+',
      effect: 'SPELL-WEAVER: The Heretic directs excess power back into the gift, empowering it further. For every two Momentum spent, any effects of the gift are increased as if the difficulty was one step higher. This is less efficient than setting the gift\'s difficulty high initially, but allows a limited degree of power scaling as befits a servant of one who has mastered the sorcerous arts.',
    },
  ],
  'Gift of Algeroth': [
    {
      threshold: '1+',
      effect: 'STOKE THE FIRES OF RAGE: Algeroth imparts bloodlust and dark fury to the Heretic\'s surroundings, inciting anger and a violent recklessness in those nearby. All living, intelligent creatures within Close range must attempt a Challenging D2 Willpower test. Those who fail suffer one Mental Wound, and will suffer one further Mental Wound at the end of every turn in which they do not attack another creature (friend or foe) until this effect ends. The effect lasts one round per Momentum spent.',
    },
    {
      threshold: '1+',
      effect: 'TOUCH OF FLAME: The fires of dark industry ignite upon the Heretic\'s weapons, making him deadlier in battle. On his next attack with any weapon – including natural weapons like claws – he gains the Incendiary 2 weapon quality and adds a number of § equal to the Momentum spent to the damage.',
    },
  ],
  'Gift of Demnogonis': [
    {
      threshold: '1+',
      effect: 'FEVER: The target is exposed to a minor illness. The illness is Acute (X), where X is equal to the Momentum spent, with a Virulence of D1, an Incubation of one day, and an interval of days. The symptom causes the creature to gain two Dread.',
    },
    {
      threshold: '2+',
      effect: 'IMMUNODEFICIENCY: The target\'s ability to resist disease is compromised, increasing the difficulty of all Resistance tests against disease by one step. This lasts for one week per two Momentum spent.',
    },
  ],
  'Gift of Semai': [
    {
      threshold: '1+',
      effect: 'FAMILIARITY BREEDS CONTEMPT: The Bringer of Discord whispers subtle falsehoods and misunderstood truths into those nearby, making cooperation difficult. For a number of rounds equal to the Momentum spent, any enemy within Close range attempting to perform an action that directly aids another creature gains 1 Dread. This aura surrounds the Heretic and moves with him.',
    },
    {
      threshold: '2',
      effect: 'BABEL CURSE: Any attempt at communication near the Heretic becomes prone to misunderstanding, obfuscation, and error. Within Close range, the difficulty of all communication-based tests increases by one, as the Heretic\'s foes suddenly find themselves speaking different languages. This forces Average D1 Personality tests for communication where communication would not otherwise require it.',
    },
  ],
  'Gift of Muawijhe': [
    {
      threshold: '1+',
      effect: 'WITNESS: The Lord of Insanity blesses the Heretic with a glimpse of the immediate future. It may make no sense at first, but it can turn failure into success if the Heretic realises its significance in time. On the next skill test the Heretic attempts, increase his Focus rank for that skill by an amount equal to the Momentum spent on this effect. This may increase his Focus beyond the normal maximum.',
    },
    {
      threshold: '1+',
      effect: 'PSYCHOTIC CERTAINTY: The Heretic\'s mind is reinforced with delusions of invincibility, giving him the will to attempt anything. He is so sure of his inevitable triumph that his powers truly make him harder to harm. For the next round, the Heretic gains Soak equal to the Momentum spent, and gains a number of bonus d20 on all tests to resist mentally traumatic events – other than using Dark Gifts, as those are self-inflicted – equal to the Momentum spent.',
    },
  ],
};


export class MC3ItemSheet extends ItemSheet {

  /**
   * Sheet configuration — size, CSS classes, no tabs (items are simple enough
   * to fit on a single panel).
   * @override
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ['mc3', 'sheet', 'item'],
      width: 520,
      height: 560,
    });
  }

  /**
   * Adjust the initial window size per item type.
   *
   * defaultOptions is static, so it can't inspect this.item. Instead we
   * mutate this.position here — after the parent constructor has initialised
   * it from defaultOptions — so that the first setPosition() call (triggered
   * by render) picks up the right dimensions for each type.
   * @override
   */
  constructor(item, options = {}) {
    super(item, options);
    if (item?.type === 'darkgift') {
      this.position.width  = 700;
      this.position.height = 620;
    }
  }

  /**
   * Pick the template file based on item type.
   * Skill items get their own dedicated template; every other type falls back
   * to a generic template until we build type-specific sheets in a later module.
   * @override
   */
  get template() {
    // Each item type gets its own dedicated template.
    // skill-sheet and item-sheet (generic fallback) remain for safety.
    const type = this.item.type;
    const templates = {
      skill:         'skill-sheet.hbs',
      talent:        'talent-sheet.hbs',
      weapon:        'weapon-sheet.hbs',
      armour:        'armour-sheet.hbs',
      equipment:     'equipment-sheet.hbs',
      spell:         'spell-sheet.hbs',
      darkgift:      'darkgift-sheet.hbs',
      specialability: 'specialability-sheet.hbs',
      weaponquality: 'weaponquality-sheet.hbs',
    };
    const file = templates[type] ?? 'item-sheet.hbs';
    return `systems/mutant-chronicles/templates/item/${file}`;
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

    // Talent attribute options — display names used as both key and value so
    // {{talent.system.attribute}} on the character sheet tab shows the full
    // name without needing a separate lookup.
    context.talentAttributes = {
      'Agility':        'Agility',
      'Awareness':      'Awareness',
      'Coordination':   'Coordination',
      'Intelligence':   'Intelligence',
      'Mental Strength': 'Mental Strength',
      'Personality':    'Personality',
      'Physique':       'Physique',
      'Strength':       'Strength',
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

  /**
   * Wire up event listeners after the sheet renders.
   *
   * Handles add/delete rows for the dynamic effect tables used by the spell
   * (Momentum) and darkgift (Category Bleed) sheets. Both tables share the
   * same two handlers, distinguished by a data-field attribute on each button.
   * @override
   */
  activateListeners(html) {
    super.activateListeners(html);
    if (!this.isEditable) return;
    html.find('.dynamic-row-add').click(this._onDynamicRowAdd.bind(this));
    html.find('.dynamic-row-delete').click(this._onDynamicRowDelete.bind(this));
    // Dark Gift only — auto-populate Category Bleed when Gift of... changes.
    if (this.item.type === 'darkgift') {
      html.find('[name="system.giftCategory"]').change(this._onGiftCategoryChange.bind(this));
    }
  }

  /**
   * Auto-populate the Category Bleed table when the Gift of... dropdown changes.
   *
   * Only fires when the table is currently empty, so existing Dark Gifts with
   * manually entered bleed rows are never overwritten. Dark Symmetry Gift has
   * no standard bleed data, so selecting it leaves the table untouched.
   */
  async _onGiftCategoryChange(event) {
    const category = event.currentTarget.value;
    if (!category) return;

    const defaults = CATEGORY_BLEED_DEFAULTS[category];
    if (!defaults) return;   // Dark Symmetry Gift — no standard bleed to insert

    // Skip if the table already has rows — don't clobber custom entries.
    const current = this.item.system.categoryBleed;
    const rows = Array.isArray(current) ? current : Object.values(current ?? {});
    if (rows.length > 0) return;

    await this.item.update({ 'system.categoryBleed': defaults });
  }

  /**
   * Append a blank { threshold, effect } row to the named array field and
   * save. The sheet re-renders automatically after the update.
   */
  async _onDynamicRowAdd(event) {
    event.preventDefault();
    const field = event.currentTarget.dataset.field;
    const current = this.item.system[field];
    // Defensive: Foundry may store the array as a numeric-keyed object after a
    // form submit (see _getSubmitData). Object.values() normalises both cases.
    const rows = Array.isArray(current) ? [...current] : Object.values(current ?? {});
    rows.push({ threshold: '', effect: '' });
    await this.item.update({ [`system.${field}`]: rows });
  }

  /**
   * Remove the row at data-index from the named array field and save.
   */
  async _onDynamicRowDelete(event) {
    event.preventDefault();
    const { field, index } = event.currentTarget.dataset;
    const current = this.item.system[field];
    const rows = Array.isArray(current) ? [...current] : Object.values(current ?? {});
    rows.splice(Number(index), 1);
    await this.item.update({ [`system.${field}`]: rows });
  }

  /**
   * Foundry's FormDataExtended turns array-index input names like
   * "system.momentum.0.threshold" into a plain object { '0': { threshold } }
   * rather than a true array. This override converts those objects back to
   * arrays before the data reaches the database, so stored values stay as
   * proper arrays and the handlers above can rely on Array.isArray().
   * @override
   */
  _getSubmitData(updateData = {}) {
    const data = super._getSubmitData(updateData);

    /** Fields that must stay as arrays, keyed by item type. */
    const ARRAY_FIELDS = {
      spell:    ['momentum'],
      darkgift: ['categoryBleed'],
    };

    for (const field of (ARRAY_FIELDS[this.item.type] ?? [])) {
      const val = data.system?.[field];
      if (val && !Array.isArray(val) && typeof val === 'object') {
        data.system[field] = Object.values(val);
      }
    }

    return data;
  }

  /**
   * Intercept input changes before Foundry's auto-submit reads the form.
   *
   * When the isRanked checkbox is toggled on a talent:
   *   - Checking it:   enables the rank input and sets it to 1 if it was 0.
   *   - Unchecking it: resets rank to 0 and disables the input.
   *
   * We modify the DOM values here, before super._onChangeInput fires, so
   * the form submit picks up the correct rank value automatically.
   * @override
   */
  _onChangeInput(event) {
    const input = event.target;

    if (input.name === 'system.isRanked') {
      const rankInput = this.form.querySelector('[name="system.rank"]');
      if (!rankInput) return super._onChangeInput(event);

      if (input.checked) {
        rankInput.disabled = false;
        if (Number(rankInput.value) === 0) rankInput.value = 1;
      } else {
        rankInput.value = 0;
        rankInput.disabled = true;
      }
    }

    return super._onChangeInput(event);
  }
}
