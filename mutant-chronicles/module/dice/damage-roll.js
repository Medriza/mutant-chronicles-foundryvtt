/**
 * MC3 Damage Roll Engine — Dark Symmetry Dice (DSD).
 *
 * DSD are d6s with custom face resolution:
 *   1 → 1 damage
 *   2 → 2 damage
 *   3, 4, 5 → 0 damage
 *   6 → Dark Symmetry Icon (DSI) — 0 damage, triggers weapon special effect
 *
 * Total damage = sum of die results + weapon's flat damage bonus.
 * DSI count is reported separately on the chat card.
 *
 * A 1d20 hit location roll is also made on every damage roll:
 *   1–2   → Head
 *   3–5   → Right Arm
 *   6–8   → Left Arm
 *   9–14  → Torso
 *   15–17 → Right Leg
 *   18–20 → Left Leg
 *
 * Exported functions:
 *   rollDSD({ actor, weapon, bonusDamageDice })  → Promise<damageResult>
 *   sendDamageToChat(damageResult)               → Promise<void>
 */

const DAMAGE_TEMPLATE = 'systems/mutant-chronicles/templates/dice/damage-chat.hbs';

/**
 * MC3 hit location table. Each entry covers an inclusive range [min, max].
 * CSS class drives colour in damage-chat.hbs.
 */
const HIT_LOCATION_TABLE = [
  { min: 1,  max: 2,  name: 'Head',      cssClass: 'loc-head'  },
  { min: 3,  max: 5,  name: 'Right Arm', cssClass: 'loc-arm'   },
  { min: 6,  max: 8,  name: 'Left Arm',  cssClass: 'loc-arm'   },
  { min: 9,  max: 14, name: 'Torso',     cssClass: 'loc-torso' },
  { min: 15, max: 17, name: 'Right Leg', cssClass: 'loc-leg'   },
  { min: 18, max: 20, name: 'Left Leg',  cssClass: 'loc-leg'   },
];

/**
 * Map a d20 result to its hit location entry.
 * @param {number} roll  A value from 1–20.
 * @returns {{ name: string, cssClass: string }}
 */
function getHitLocation(roll) {
  return HIT_LOCATION_TABLE.find(({ min, max }) => roll >= min && roll <= max);
}

/**
 * Evaluate a DSD damage roll and return a structured result object.
 *
 * @param {object} params
 * @param {Actor}  params.actor           The attacking actor (for chat attribution).
 * @param {Item}   params.weapon          The weapon item being used.
 * @param {number} params.bonusDamageDice Extra DSD purchased with Momentum.
 * @returns {Promise<object>} damageResult
 */
export async function rollDSD({ actor, weapon, bonusDamageDice = 0 }) {
  const numDice   = (weapon.system.damageDice ?? 0) + bonusDamageDice;
  const flatBonus = weapon.system.damageFlat  ?? 0;

  // Roll the DSD (if there are any dice).
  const roll = numDice > 0 ? new Roll(`${numDice}d6`) : null;
  if (roll) await roll.evaluate();

  // Classify each die face.
  const dice = roll ? roll.dice[0].results.map(({ result }) => {
    const damage   = result === 1 ? 1 : result === 2 ? 2 : 0;
    const isDSI    = result === 6;

    // CSS class drives colour in damage-chat.hbs:
    //   dsd-one    → amber  (1 damage)
    //   dsd-two    → gold   (2 damage)
    //   dsd-miss   → grey   (0 damage, faces 3–5)
    //   dsd-effect → red    (DSI, face 6)
    const cssClass = result === 1 ? 'dsd-one'
                   : result === 2 ? 'dsd-two'
                   : result === 6 ? 'dsd-effect'
                   :                'dsd-miss';

    return { result, damage, isDSI, cssClass };
  }) : [];

  const totalDamage = dice.reduce((sum, d) => sum + d.damage, 0) + flatBonus;
  const dsiCount    = dice.filter(d => d.isDSI).length;

  // Roll hit location (always — every damage roll tells you where you hit).
  const locRoll = new Roll('1d20');
  await locRoll.evaluate();
  const locResult   = locRoll.dice[0].results[0].result;
  const locData     = getHitLocation(locResult);

  return {
    weaponName:        weapon.name,
    numDice,
    flatBonus,
    dice,
    totalDamage,
    dsiCount,
    roll,
    actor,
    hitRoll:           locResult,
    hitLocation:       locData.name,
    hitLocationClass:  locData.cssClass,
  };
}

/**
 * Render a damage result into the chat log.
 *
 * @param {object} damageResult  The object returned by rollDSD().
 */
export async function sendDamageToChat(damageResult) {
  const content = await foundry.applications.handlebars.renderTemplate(
    DAMAGE_TEMPLATE,
    damageResult
  );

  await ChatMessage.create({
    content,
    // Only attach the Roll object if we actually rolled dice.
    // (A flat-bonus-only result has roll: null.)
    ...(damageResult.roll ? { rolls: [damageResult.roll] } : {}),
    speaker: ChatMessage.getSpeaker({ actor: damageResult.actor }),
  });
}
