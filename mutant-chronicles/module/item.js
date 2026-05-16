/**
 * MC3 Item — extends Foundry's base Item class.
 * Covers weapons, armour, skills, talents, and equipment.
 */
export class MC3Item extends Item {

  /**
   * Called by Foundry when an item's data changes.
   * Will eventually compute things like skill totals (attribute + rating)
   * or weapon damage formulas. For now, just defers to the parent.
   * @override
   */
  prepareData() {
    super.prepareData();
    // MC3-specific item derivations will go here.
  }
}