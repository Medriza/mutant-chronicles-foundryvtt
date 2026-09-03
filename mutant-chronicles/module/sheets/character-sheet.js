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
import { findLinkedParts }              from '../item.js';

const { ActorSheet } = foundry.appv1.sheets;

/**
 * Maps a weapon's weaponType value to the name of the skill used for attack rolls.
 * Stored at module level so it's defined once and shared by any method that needs it.
 * Using an object as a lookup table (rather than a switch or if/else chain) keeps
 * the mapping readable and easy to extend if new weapon types are added later.
 */
const WEAPON_SKILL_MAP = {
  melee:   'Close Combat',
  unarmed: 'Unarmed Combat',
  ranged:  'Ranged Weapons',
  heavy:   'Heavy Weapons',
  gunnery: 'Gunnery',
};

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

    // Earnings descriptor — shown as a read-only label next to the rating number.
    // Updates automatically each render so changing the rating (0–5) immediately
    // reflects the correct title in the header without any extra JS handler.
    const EARNINGS_TITLES = [
      'Impoverished', 'Meagre', 'Average', 'Comfortable', 'Affluent', 'Wealthy'
    ];
    context.earningsTitle = EARNINGS_TITLES[actor.system.details?.earningsRating ?? 0]
                         ?? 'Impoverished';

    // Bucket the actor's embedded items by type. This uses Array.prototype.filter
    // from Lesson 1.3 — Foundry stores all embedded items in one collection
    // (actor.items), and the template wants them split per type so it can render
    // weapons in the Weapons section, talents in the Talents tab, etc.
    context.skills    = actor.items.filter(i => i.type === 'skill');
    context.talents   = actor.items.filter(i => i.type === 'talent');
    context.weapons   = actor.items.filter(i => i.type === 'weapon');
    context.armours   = actor.items.filter(i => i.type === 'armour');
    context.equipment = actor.items.filter(i => i.type === 'equipment');
    context.spells    = actor.items.filter(i => i.type === 'spell')
                          .sort((a, b) => {
                            const aspect = a.system.aspect.localeCompare(b.system.aspect);
                            if (aspect !== 0) return aspect;
                            return a.name.localeCompare(b.name);
                          });

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

    // Location metadata: display range (for the hit-location-grid range badge)
    // and human-readable label. Range uses en-dashes per MC3 book typography.
    const LOCATION_META = {
      head:     { range: '1–2',   label: 'Head'      },
      rightArm: { range: '3–5',   label: 'Right Arm'  },
      leftArm:  { range: '6–8',   label: 'Left Arm'   },
      torso:    { range: '9–14',  label: 'Torso'      },
      rightLeg: { range: '15–17', label: 'Right Leg'  },
      leftLeg:  { range: '18–20', label: 'Left Leg'   },
    };

    const woundsData = actor.system.wounds;

    // lightWoundSlots is now a keyed object so tab-stats.hbs can reference each
    // location directly (e.g. {{lightWoundSlots.head.slots}}) rather than relying
    // on iteration order. The template positions each card in a fixed grid layout
    // matching the official MC3 character sheet.
    context.lightWoundSlots = {};
    for (const [loc, data] of Object.entries(woundsData.light)) {
      const meta = LOCATION_META[loc] ?? { range: '?', label: loc };
      context.lightWoundSlots[loc] = {
        loc,
        range: meta.range,
        label: meta.label,
        path:  `system.wounds.light.${loc}`,
        soak:  data.soak ?? 0,
        slots: Array.from(
          { length: WOUND_PHYSICAL_MAX[loc] ?? 10 },
          (_, i) => ({
            state: i < data.value ? 'filled' : i < data.max ? 'active' : 'inactive',
          })
        ),
      };
    }

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

    // ── Chronicle Points ───────────────────────────────────────────────────────
    // 5 circular tokens; filled from left. Left-click fills next, right clears last.
    const cpValue = actor.system.chroniclePoints?.value ?? 0;
    context.chroniclePointSlots = Array.from({ length: 5 }, (_, i) => ({
      index:  i,
      filled: i < cpValue,
    }));

    // ── Dread Track ────────────────────────────────────────────────────────────
    // Stepped layout: 5 rows of 1/2/3/4/5 boxes = 15 total.
    // When a row is completed the complication range escalates to that row's Range.
    // The Severity (difficulty) column is used for Psychotherapy tests to cure Dread.
    // Boxes fill globally left-to-right, top-to-bottom: globalIndex 0 is row-1 box-1.
    const DREAD_ROW_DEFS = [
      { range: '20',    count: 1, difficulty: null  },
      { range: '19–20', count: 2, difficulty: 'D1'  },
      { range: '18–20', count: 3, difficulty: 'D2'  },
      { range: '17–20', count: 4, difficulty: 'D3'  },
      { range: '16–20', count: 5, difficulty: 'D4'  },
    ];
    const dreadValue = actor.system.dread?.value ?? 0;
    let dreadBoxIndex = 0;
    context.dreadRows = DREAD_ROW_DEFS.map((def, rowIdx) => {
      const slots = Array.from({ length: def.count }, (_, i) => {
        const globalIndex = dreadBoxIndex + i;
        return { globalIndex, state: globalIndex < dreadValue ? 'filled' : 'active' };
      });
      dreadBoxIndex += def.count;
      return { range: def.range, difficulty: def.difficulty, rowIndex: rowIdx, slots };
    });

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
      const attrSkills = skills.filter(s => s.system.attribute === attr);

      // Separate parent skills (non-advanced) from advanced skills, sort each A→Z.
      const parents  = attrSkills
        .filter(s => !s.system.isAdvanced)
        .sort((a, b) => a.name.localeCompare(b.name));
      const advanced = attrSkills.filter(s => s.system.isAdvanced);

      // Build the ordered list: each parent followed immediately by its children
      // (alphabetically sorted). Any advanced skill whose parentSkill field doesn't
      // match a known parent in this group is appended at the end (orphan guard).
      const ordered = [];
      for (const parent of parents) {
        ordered.push(parent);
        const children = advanced
          .filter(s => s.system.parentSkill === parent.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        ordered.push(...children);
      }
      // Orphaned advanced skills — parentSkill references something not in this group
      const knownParentNames = new Set(parents.map(p => p.name));
      const orphans = advanced
        .filter(s => !knownParentNames.has(s.system.parentSkill))
        .sort((a, b) => a.name.localeCompare(b.name));
      ordered.push(...orphans);

      groups[attr] = ordered;
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
    html.find('.weapon-attack').click(this._onWeaponAttack.bind(this));

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

    // Chronicle Points — 5 circular tokens; left-click fills next, right clears last.
    html.find('.chronicle-point-slot').click(this._onCPFill.bind(this));
    html.find('.chronicle-point-slot').contextmenu(this._onCPClear.bind(this));

    // Dread track — 15 boxes in a stepped layout; left-click fills next, right clears last.
    html.find('.dread-slot').click(this._onDreadFill.bind(this));
    html.find('.dread-slot').contextmenu(this._onDreadClear.bind(this));

    // Armour worn toggle — updates the item, which triggers prepareData() to
    // recompute per-location soak and re-render the stats tab automatically.
    html.find('.armour-worn-toggle').change(this._onToggleArmourWorn.bind(this));
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

  /**
   * Toggle the worn state on an armour item directly from the Gear tab.
   *
   * The checkbox lives on the character sheet, but it controls an embedded
   * Item — so we call item.update() rather than actor.update(). Foundry then
   * fires prepareData() on the actor, which calls _prepareSoak(), which
   * recomputes per-location soak from all currently worn armour pieces and
   * writes the new values to system.wounds.light.{loc}.soak. The stats tab
   * re-renders automatically with the updated numbers.
   */
  async _onToggleArmourWorn(event) {
    event.preventDefault();
    const row = event.currentTarget.closest('[data-item-id]');
    const item = this.actor.items.get(row.dataset.itemId);
    if (!item) return;
    return item.update({ 'system.worn': event.currentTarget.checked });
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

  /* ------------------------------------------------------------------------ */
  /*   Chronicle Points handlers                                              */
  /* ------------------------------------------------------------------------ */

  /**
   * Left-click on a chronicle-point circle: spend the next available point
   * (fills the leftmost unfilled token).
   */
  async _onCPFill(event) {
    event.preventDefault();
    const current = this.actor.system.chroniclePoints?.value ?? 0;
    const next = Math.min(current + 1, 5);
    if (next !== current) await this.actor.update({ 'system.chroniclePoints.value': next });
  }

  /**
   * Right-click on a chronicle-point circle: recover the last spent point
   * (clears the rightmost filled token).
   */
  async _onCPClear(event) {
    event.preventDefault();
    const current = this.actor.system.chroniclePoints?.value ?? 0;
    const next = Math.max(current - 1, 0);
    if (next !== current) await this.actor.update({ 'system.chroniclePoints.value': next });
  }

  /* ------------------------------------------------------------------------ */
  /*   Dread track handlers                                                    */
  /* ------------------------------------------------------------------------ */

  /**
   * Left-click on a dread box: add one point of Dread (fills the next box,
   * advancing through the stepped layout globally left-to-right, top-to-bottom).
   */
  async _onDreadFill(event) {
    event.preventDefault();
    const current = this.actor.system.dread?.value ?? 0;
    const next = Math.min(current + 1, 15);
    if (next !== current) await this.actor.update({ 'system.dread.value': next });
  }

  /**
   * Right-click on a dread box: remove one point of Dread (clears the last
   * filled box).
   */
  async _onDreadClear(event) {
    event.preventDefault();
    const current = this.actor.system.dread?.value ?? 0;
    const next = Math.max(current - 1, 0);
    if (next !== current) await this.actor.update({ 'system.dread.value': next });
  }

  /**
   * Click on a weapon name in the Gear tab: look up the governing skill from
   * WEAPON_SKILL_MAP and open a skill roll dialog pre-populated for that weapon.
   *
   * The pattern here — weapon holds a type key, map translates it to a skill name,
   * we find that skill in the actor's items — will recur in Lesson 9.4 for NPCs.
   */
  async _onWeaponAttack(event) {
    event.preventDefault();
    const li     = event.currentTarget.closest('[data-item-id]');
    const weapon = this.actor.items.get(li.dataset.itemId);
    if (!weapon) return;

    // Translate weaponType → skill name. If the type isn't in the map
    // (e.g. a weapon was created before 9.2 and has no type set), warn and bail.
    const skillName = WEAPON_SKILL_MAP[weapon.system.weaponType];
    if (!skillName) {
      ui.notifications.warn(`No skill mapped for weapon type "${weapon.system.weaponType}". Open the weapon and set its type.`);
      return;
    }

    // Find the skill item on this actor. A character without the relevant skill
    // (e.g. no Gunnery) gets a helpful warning rather than a silent failure.
    const skill = this.actor.items.find(i => i.type === 'skill' && i.name === skillName);
    if (!skill) {
      ui.notifications.warn(`${this.actor.name} doesn't have the ${skillName} skill.`);
      return;
    }

    // From here it's identical to _onRollSkill — same dialog, same pipeline.
    const rollParams = await showSkillRollDialog(this.actor, skill);
    if (!rollParams?.numDice) return;
    if (rollParams.dsSpend > 0) {
      const currentDS = game.settings.get('mutant-chronicles', 'darkSymmetryPool');
      await game.settings.set('mutant-chronicles', 'darkSymmetryPool', currentDS + rollParams.dsSpend);
    }
    const rollResult = await rollMC3({ ...rollParams, actor: this.actor, weaponName: weapon.name, weaponId: weapon.id });
    await sendRollToChat(rollResult);
  }

  async _onRollSkill(event) {
    event.preventDefault();
    const li    = event.currentTarget.closest('[data-item-id]');
    const skill = this.actor.items.get(li.dataset.itemId);

    // Open the dialog. If the user cancels, rollParams is null — bail out.
    const rollParams = await showSkillRollDialog(this.actor, skill);
    if (!rollParams?.numDice) return;
    if (rollParams.dsSpend > 0) {
      const currentDS = game.settings.get('mutant-chronicles', 'darkSymmetryPool');
      await game.settings.set('mutant-chronicles', 'darkSymmetryPool', currentDS + rollParams.dsSpend);
    }
    const rollResult = await rollMC3({ ...rollParams, actor: this.actor });
    await sendRollToChat(rollResult);
  }

  /**
   * Intercept item creation to handle multi-rank talents.
   *
   * When a talent is dropped onto the sheet, we check whether the actor
   * already owns a talent with the same name. If it does, we increment that
   * talent's Rank by 1 and discard the incoming duplicate. All other item
   * types pass through to the default Foundry behaviour.
   *
   * This implements the MC3 rule that some talents (e.g. Catfall) can be
   * taken multiple times, with each additional purchase increasing the Rank.
   *
   * @param {object|object[]} itemData  The item document data from the drop.
   * @override
   */
  async _onDropItemCreate(itemData) {
    // Foundry may pass a single object or an array — normalise to array.
    const items = Array.isArray(itemData) ? itemData : [itemData];

    const toCreate = [];

    for (const data of items) {
      if (data.type === 'talent') {
        const existing = this.actor.items.find(
          i => i.type === 'talent' && i.name === data.name
        );
        if (existing) {
          // Duplicate talent found. Only increment rank if isRanked is true.
          // Either way, never create a second copy.
          if (existing.system.isRanked) {
            const newRank = (existing.system.rank ?? 1) + 1;
            await existing.update({ 'system.rank': newRank });
          }
          // isRanked = false: silently ignore the duplicate drop.
          continue;
        }
      }
      toCreate.push(data);

      // Multi-part weapon? Pull its companion parts (e.g. an integral grenade
      // launcher) out of the compendium so they arrive together.
      if (data.type === 'weapon') {
        toCreate.push(...await findLinkedParts(data, this.actor));
      }
    }

    // Create any non-duplicate items normally.
    if (toCreate.length) return super._onDropItemCreate(toCreate);
  }
}
