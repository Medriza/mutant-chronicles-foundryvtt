/**
 * MC3 Actor — extends Foundry's base Actor class.
 * Handles MC3-specific data preparation for character and NPC actor types.
 */
export class MC3Actor extends Actor {

  /**
   * Called by Foundry every time the actor's data changes.
   * This is where we compute derived values (e.g. maximum Wounds, carrying
   * capacity) that depend on the base attributes. For now this just chains
   * to the parent — we'll add MC3 logic in Module 5.
   * @override
   */
  prepareData() {
    super.prepareData();
    // MC3-specific derived calculations will go here.
  }
}