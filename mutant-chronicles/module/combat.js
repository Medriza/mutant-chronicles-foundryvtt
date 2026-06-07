/**
 * MC3Combat — custom Combat document for Mutant Chronicles 3rd Edition.
 *
 * MC3 initiative is manual, not dice-based. All PCs act before all NPCs;
 * order within each group is set by the GM via the initiative number boxes.
 *
 * PCs are auto-assigned initiatives 100, 99, 98… (preserving add order).
 * NPCs are auto-assigned 50, 49, 48… so they always sort after PCs.
 *
 * The GM can rearrange combatants by typing a new number in the initiative
 * box — Foundry re-sorts the tracker automatically.
 */
export class MC3Combat extends Combat {

  /**
   * Auto-assign sequential initiative values whenever combatants are added.
   * Handles batch additions (e.g. adding 5 tokens at once) correctly by
   * working on the full array rather than firing once per combatant.
   * @override
   */
  async createEmbeddedDocuments(embeddedName, dataArray, options = {}) {
    // Let Foundry create the documents first.
    const created = await super.createEmbeddedDocuments(embeddedName, dataArray, options);

    // Only the GM assigns initiative, and only for Combatant documents.
    if (embeddedName !== 'Combatant' || !game.user.isGM) return created;

    // Separate newly added combatants into PC and NPC groups.
    const pcs  = created.filter(c => c.actor?.type === 'character');
    const npcs = created.filter(c => c.actor?.type !== 'character');

    const updates = [];

    for (const [group, isPC] of [[pcs, true], [npcs, false]]) {
      if (!group.length) continue;

      const topValue = isPC ? 100 : 50;

      // Find the lowest existing initiative in this group among combatants
      // that are NOT part of this batch (they were already in the encounter).
      const createdIds = new Set(created.map(c => c.id));
      const existing   = this.combatants.filter(c =>
        !createdIds.has(c.id) &&
        (c.actor?.type === 'character') === isPC &&
        c.initiative !== null
      );

      // New combatants slot in just below the existing minimum, or start at
      // topValue if this group has no existing combatants yet.
      const floorValue = existing.length
        ? Math.min(...existing.map(c => c.initiative))
        : topValue + 1;

      group.forEach((c, i) => {
        updates.push({ _id: c.id, initiative: floorValue - 1 - i });
      });
    }

    if (updates.length) await this.updateEmbeddedDocuments('Combatant', updates);

    return created;
  }

  /**
   * Override per-combatant initiative roll — MC3 uses manual ordering.
   * @override
   */
  async rollInitiative(ids, options = {}) {
    ui.notifications.info('MC3 uses manual initiative — type a number to set turn order.');
    return this;
  }

  /**
   * Override "Roll All" — no-op.
   * @override
   */
  async rollAll(options = {}) {
    ui.notifications.info('MC3 uses manual initiative — type a number to set turn order.');
    return this;
  }

  /**
   * Override "Roll NPCs" — no-op.
   * @override
   */
  async rollNPC(options = {}) {
    ui.notifications.info('MC3 uses manual initiative — type a number to set turn order.');
    return this;
  }
}
