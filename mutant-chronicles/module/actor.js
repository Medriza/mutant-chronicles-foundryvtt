/**
 * MC3 Actor — document class for all MC3 actor types.
 *
 * Extends Foundry's Actor and overrides prepareData() to compute derived
 * values from raw attribute scores. Derived values are written to this.system
 * on every render — they are NOT persisted to the database. Change an
 * attribute → sheet re-renders → prepareData() fires → derived values update.
 */
export class MC3Actor extends Actor {

  /**
   * Augment the basic actor data with additional dynamic data.
   * Foundry calls this automatically as part of the document lifecycle,
   * before the sheet's getData() runs, so derived values are ready for
   * the template. Always call super.prepareData() first to load raw data.
   * @override
   */
  prepareData() {
    super.prepareData();

    // Route to type-specific preparation.
    if (this.type === 'character') this._prepareCharacterData();
    if (this.type === 'npc')       this._prepareNpcData();
  }

  /* ------------------------------------------------------------------------ */
  /*   Private — character data preparation                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Compute all derived values for a PC character actor.
   * Called from prepareData() when this.type === 'character'.
   */
  _prepareCharacterData() {
    const { system } = this;
    const attrs = system.attributes;

    // ── Mental Wounds max ──────────────────────────────────────────────────
    // Max mental wound slots = Mental Strength score directly. No formula.
    system.mentalWounds.max = attrs.mentalStrength.value;

    // ── Physical wound maxes (PHY + STR lookup table) ─────────────────────
    // Light Wounds per location, Serious max, and Critical max are all read
    // from the MC3 Wounds chart, keyed by Physique + Strength combined score.
    // The arms value applies to both leftArm and rightArm; legs to both legs.
    const wm = this._getWoundMaxes(attrs.physique.value, attrs.strength.value);
    system.wounds.light.head.max     = wm.head;
    system.wounds.light.torso.max    = wm.torso;
    system.wounds.light.leftArm.max  = wm.arms;
    system.wounds.light.rightArm.max = wm.arms;
    system.wounds.light.leftLeg.max  = wm.legs;
    system.wounds.light.rightLeg.max = wm.legs;
    system.wounds.serious.max        = wm.serious;
    system.wounds.critical.max       = wm.critical;

    // ── Derived stats ──────────────────────────────────────────────────────
    // All three use the same bonus chart — only the governing attribute differs.
    //   Melee Bonus Damage  → Strength
    //   Ranged Bonus Damage → Awareness
    //   Influence           → Personality
    system.derivedStats.meleeBonusDamage  = this._bonusFromAttribute(attrs.strength.value);
    system.derivedStats.rangedBonusDamage = this._bonusFromAttribute(attrs.awareness.value);
    system.derivedStats.influence         = this._bonusFromAttribute(attrs.personality.value);

    // ── Derived soak (from worn armour items) ──────────────────────────────
    this._prepareSoak();
  }

  /* ------------------------------------------------------------------------ */
  /*   Private — NPC data preparation                                         */
  /* ------------------------------------------------------------------------ */

  /**
   * Compute derived values for an NPC actor.
   *
   * NPC wound maxes are NOT derived here — they come directly from the
   * creature's stat block and are set by the GM on the sheet. Overwriting
   * them in prepareData() would undo anything the GM typed in.
   *
   * Bonus stats are still computed (same formula as PCs) so the dice roller
   * in Module 6 can reference them without needing to know actor type.
   */
  _prepareNpcData() {
    const { system } = this;
    const attrs = system.attributes;

    system.derivedStats.meleeBonusDamage  = this._bonusFromAttribute(attrs.strength.value);
    system.derivedStats.rangedBonusDamage = this._bonusFromAttribute(attrs.awareness.value);
    system.derivedStats.influence         = this._bonusFromAttribute(attrs.personality.value);
  }

  /**
   * Derive per-location soak from all worn armour items.
   *
   * MC3 rule: when multiple armour pieces are worn, each location uses the
   * HIGHEST soak value among all worn pieces — armour does not stack.
   *
   * If no armour is worn every location resets to 0. Called from
   * _prepareCharacterData() so it re-runs on every actor update, including
   * when an item's worn flag changes.
   */
  _prepareSoak() {
    const locations = ['head', 'leftArm', 'rightArm', 'torso', 'leftLeg', 'rightLeg'];

    // Start every location at 0.
    const soak = Object.fromEntries(locations.map(loc => [loc, 0]));

    // For each worn armour item, keep the higher value per location.
    for (const item of this.items) {
      if (item.type !== 'armour' || !item.system.worn) continue;
      for (const loc of locations) {
        soak[loc] = Math.max(soak[loc], item.system.soak[loc] ?? 0);
      }
    }

    // Write the computed values back into the wound data so the stats tab
    // template can read them as system.wounds.light.{loc}.soak.
    for (const loc of locations) {
      this.system.wounds.light[loc].soak = soak[loc];
    }
  }

  /**
   * Convert a single attribute score to a bonus using the MC3 bonus-damage chart.
   *
   * The same chart governs Melee Bonus Damage (STR), Ranged Bonus Damage (AWA),
   * and Influence (PER). Full chart:
   *   attr ≤ 8   → 0
   *   attr = 9   → 1
   *   attr 10–11 → 2
   *   attr 12–13 → 3
   *   attr 14–15 → 4
   *   attr ≥ 16  → 5
   *
   * This fits the formula: attr <= 8 ? 0 : Math.floor((attr - 6) / 2)
   * Verified against the full 2–17 attribute range.
   *
   * @param {number} attr  Raw attribute value (clamped to 0-5 output; handles out-of-range from buffs/debuffs).
   * @returns {number}     Bonus value (0–5).
   */
  _bonusFromAttribute(attr) {
    if (attr <= 8) return 0;
    return Math.min(5, Math.floor((attr - 6) / 2));
  }

  /**
   * Look up wound maximums from the MC3 Wounds chart, keyed by
   * Physique + Strength combined score.
   *
   * Each row: [minScore, head, torso, arms, legs, serious, critical]
   * The table is sorted descending by minScore. Array.find() returns the
   * first row where the combined score meets or exceeds the minimum —
   * i.e. the highest applicable bracket.
   *
   * The arms value applies to both leftArm and rightArm.
   * The legs value applies to both leftLeg and rightLeg.
   *
   * @param {number} physique  PHY attribute value.
   * @param {number} strength  STR attribute value.
   * @returns {{ head: number, torso: number, arms: number,
   *             legs: number, serious: number, critical: number }}
   */
  _getWoundMaxes(physique, strength) {
    const score = physique + strength;

    // [minScore, head, torso, arms, legs, serious, critical]
    const table = [
      [30, 5, 11, 7, 9, 9, 6],
      [28, 5, 10, 7, 8, 9, 5],
      [26, 5, 10, 6, 8, 8, 5],
      [24, 4,  9, 6, 7, 8, 5],
      [22, 4,  9, 5, 7, 7, 4],
      [20, 4,  8, 5, 6, 7, 4],
      [18, 3,  8, 4, 6, 6, 4],
      [16, 3,  7, 4, 5, 6, 3],
      [14, 3,  7, 3, 5, 5, 3],
      [12, 2,  6, 3, 4, 5, 3],
      [10, 2,  6, 2, 4, 4, 2],
      [ 0, 2,  5, 2, 3, 4, 2], // score < 10
    ];

    // Destructuring in the .find() callback: [min] pulls out only the first
    // element of each row for the comparison. Then the matched row is
    // destructured again below — the leading comma skips minScore.
    const [, head, torso, arms, legs, serious, critical] =
      table.find(([min]) => score >= min);

    return { head, torso, arms, legs, serious, critical };
  }
}
