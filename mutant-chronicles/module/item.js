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

/**
 * Multi-part weapons (e.g. a pistol with an integral grenade launcher) are
 * stored in the mc3-weapons compendium as separate items that share a
 * flags["mutant-chronicles"] block: { code, part, of }. When part 1 is dropped
 * onto an actor, the sheet calls this to fetch the remaining parts so they can
 * be created alongside it.
 *
 * @param {object} itemData   Raw item data from the drop (what _onDropItemCreate receives).
 * @param {Actor}  actor      The actor receiving the drop — used to skip parts it already owns.
 * @returns {Promise<object[]>} Plain item data for each missing companion part.
 */
export async function findLinkedParts(itemData, actor) {
  const link = itemData.flags?.['mutant-chronicles'];
  if (!link?.code || link.part !== 1 || (link.of ?? 1) < 2) return [];

  const pack = game.packs.get('mutant-chronicles.mc3-weapons');
  if (!pack) return [];

  // Which parts does the actor already have? (Guards against double-adding.)
  const owned = new Set(
    actor.items
      .filter(i => i.getFlag('mutant-chronicles', 'code') === link.code)
      .map(i => i.getFlag('mutant-chronicles', 'part'))
  );

  const docs = await pack.getDocuments();
  return docs
    .filter(d => {
      const f = d.getFlag('mutant-chronicles', 'code') === link.code;
      const part = d.getFlag('mutant-chronicles', 'part');
      return f && part > 1 && !owned.has(part);
    })
    .sort((a, b) => a.getFlag('mutant-chronicles', 'part') - b.getFlag('mutant-chronicles', 'part'))
    .map(d => d.toObject());
}

