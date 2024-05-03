import Constants from '../constants.js';
import DynamicEffectsAdder from './dynamic-effects-adder.js';
import EffectHelpers from './effect-helpers.js';
import FoundryHelpers from '../foundry-helpers.js';
import Settings from '../settings.js';
import log from '../logger.js';

/**
 * Handles toggling on and off effects on actors
 */
export default class EffectHandler {
  constructor() {
    this._effectHelpers = new EffectHelpers();
    this._foundryHelpers = new FoundryHelpers();
    this._dynamicEffectsAdder = new DynamicEffectsAdder();
    this._settings = new Settings();
  }

  /**
   * Toggles an effect on or off by name on an actor by UUID
   *
   * @param {string} effectName - name of the effect to toggle
   * @param {object} params - the effect parameters
   * @param {boolean} params.overlay - if the effect is an overlay or not
   * @param {string[]} params.uuids - UUIDS of the actors to toggle the effect on
   */
  async toggleEffect(effectName, { overlay, uuids, isStatusEffect, active }) {
	for (const uuid of uuids) {
		if (!isStatusEffect) {
			if (this.hasEffectApplied(effectName, uuid)) {
				await this.removeEffect({ effectName, uuid });
			} else {
				let effect = game.dfreds.effectInterface.findEffectByName(effectName);
				await this.addEffect({ effect: effect.toObject(), uuid, overlay });
			}
		} else {
			const actor = this._foundryHelpers.getActorByUuid(uuid);
			if (!actor) continue;
			const statusId = isStatusEffect.id;
			const existing = [];

			// Find the effect with the static _id of the status effect
			if (isStatusEffect._id) {
				const effect = actor.effects.get(isStatusEffect._id);
				if (effect) existing.push(effect.id);
			}

			// If no static _id, find all single-status effects that have this status
			else {
				for (const effect of actor.effects) {
					const statuses = effect.statuses;
					if (statuses.size === 1 && statuses.has(statusId))
						existing.push(effect.id);
				}
			}

			// Remove the existing effects unless the status effect is forced active
			if (existing.length) {
				if (active) continue;
				await actor.deleteEmbeddedDocuments('ActiveEffect', existing);
				continue;
			}

			// Create a new effect unless the status effect is forced inactive
			if (!active && active !== undefined) continue;
			const effect = await ActiveEffect.implementation.fromStatusEffect(
				statusId
			);
			if (overlay) effect.updateSource({ 'flags.core.overlay': true });
			await ActiveEffect.implementation.create(effect, {
				parent: actor,
				keepId: true,
			});
		}
	}
}


  /**
   * Checks to see if any of the current active effects applied to the actor
   * with the given UUID match the effect name and are a convenient effect
   *
   * @param {string} effectName - the name of the effect to check
   * @param {string} uuid - the uuid of the actor to see if the effect is
   * applied to
   * @returns {boolean} true if the effect is applied, false otherwise
   */
  hasEffectApplied(effectName, uuid) {
    const actor = this._foundryHelpers.getActorByUuid(uuid);
    return actor?.appliedEffects?.some(
      (activeEffect) =>
        this._effectHelpers.isConvenient(activeEffect) &&
        activeEffect?.name == effectName 
    );
  }

  /**
   * Removes the effect with the provided ID from an actor matching the
   * provided UUID
   *
   * @param {object} params - the effect parameters
   * @param {string} params.effectName - the ID of the effect to remove (name or staticID)
   * @param {string} params.uuid - the uuid of the actor to remove the effect from
   * @param {string | undefined} params.origin - only removes the effect if the origin
   * matches. If undefined, removes any effect with the matching name
   */
  async removeEffect({ effectID, uuid, origin }) {
    const actor = this._foundryHelpers.getActorByUuid(uuid);

    let effectToRemove;

    if (origin) {
      effectToRemove = actor.appliedEffects.find(
        (activeEffect) =>
          this._effectHelpers.isConvenient(activeEffect) &&
          [activeEffect?._id, activeEffect?.name].some((eID) => eID === effectID) &&
          activeEffect?.origin == origin
      );
    } else {
      effectToRemove = actor.appliedEffects.find(
        (activeEffect) =>
          this._effectHelpers.isConvenient(activeEffect) &&
          [activeEffect?._id, activeEffect?.name].some((eID) => eID === effectID)
      );
    }

    if (!effectToRemove) return;

    await effectToRemove.delete();
    log(`Removed effect ${effectToRemove.name} from ${actor.name} - ${actor.id}`);
  }

  /**
   * Adds the effect with the provided name to an actor matching the provided
   * UUID
   *
   * @param {object} params - the effect parameters
   * @param {object} params.effect - the object form of an ActiveEffect to add
   * @param {string} params.uuid - the uuid of the actor to add the effect to
   * @param {string} params.origin - the origin of the effect
   * @param {boolean} params.overlay - if the effect is an overlay or not
   */
  async addEffect({ effect, uuid, origin, overlay, isStatusEffect }) {
    const actor = this._foundryHelpers.getActorByUuid(uuid);
    const activeEffectsToApply = [];
    console.log(effect)
    console.log(isStatusEffect)

    if (isStatusEffect) {
      const existing = actor.appliedEffects.find((eff) => eff._id === effect._id);
      if (existing) await this.removeEffect({effectID: existing.id, uuid});
      if (actor.token?.object.hasActiveHUD || actor.getActiveTokens()[0].hasActiveHUD) canvas.tokens.hud.refreshStatusIcons();
      return ActiveEffect.implementation.create(effect, { parent: actor, origin, overlay, keepId: true });
    }

    activeEffectsToApply.push(effect);
/*
    if (effect.name.startsWith('Exhaustion')) {
      await this._removeAllExhaustionEffects(uuid);
    }

    if (effect.name == 'Unconscious') {
      activeEffectsToApply.push(this._getProneEffect());
    }

    if (origin) {
      effect.origin = origin;
    }
*/
    let coreFlags = {
      core: {
        overlay,
      },
    };
    effect.flags = foundry.utils.mergeObject(effect.flags, coreFlags);

    if (effect.flags[Constants.MODULE_ID]?.[Constants.FLAGS.IS_DYNAMIC]) {
      await this._dynamicEffectsAdder.addDynamicEffects(effect, actor);
    }

    await actor.createEmbeddedDocuments('ActiveEffect', activeEffectsToApply);
    log(`Added effect ${effect.name} to ${actor.name} - ${actor.id}`);

    const subEffects =
      effect.flags[Constants.MODULE_ID]?.[Constants.FLAGS.SUB_EFFECTS];
    if (subEffects) {
      // Apply all sub-effects with the original effect being the origin
      for (const subEffect of subEffects) {
        await game.dfreds.effectInterface.addEffectWith({
          effectData: subEffect,
          uuid,
          origin: this._effectHelpers.getId(effect.name),
        });
      }
    }
  }

  _getProneEffect() {
    let proneActiveEffectData =
      game.dfreds.effectInterface.findEffectByName('Prone');
    return proneActiveEffectData;
  }

  async _removeAllExhaustionEffects(uuid) {
    await this.removeEffect({ effectName: 'Exhaustion 1', uuid });
    await this.removeEffect({ effectName: 'Exhaustion 2', uuid });
    await this.removeEffect({ effectName: 'Exhaustion 3', uuid });
    await this.removeEffect({ effectName: 'Exhaustion 4', uuid });
    await this.removeEffect({ effectName: 'Exhaustion 5', uuid });
  }
}
