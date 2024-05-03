import Constants from './constants.js';
import CustomEffectsHandler from './effects/custom-effects-handler.js';
import EffectHandler from './effects/effect-handler.js';
import EffectHelpers from './effects/effect-helpers.js';
import FoundryHelpers from './foundry-helpers.js';
import Settings from './settings.js';

/**
 * Interface for working with effects and executing them as a GM via sockets
 */
export default class EffectInterface {
  constructor() {
    this._customEffectsHandler = new CustomEffectsHandler();
    this._effectHandler = new EffectHandler();
    this._effectHelpers = new EffectHelpers();
    this._foundryHelpers = new FoundryHelpers();
    this._settings = new Settings();
  }

  /**
   * Initializes the socket and registers the socket functions
   */
  initialize() {
    this._socket = socketlib.registerModule(Constants.MODULE_ID);
    this._registerFunctions();
  }

  _registerFunctions() {
    this._socket.register(
      'toggleEffect',
      this._effectHandler.toggleEffect.bind(this._effectHandler)
    );
    this._socket.register(
      'addEffect',
      this._effectHandler.addEffect.bind(this._effectHandler)
    );
    this._socket.register(
      'removeEffect',
      this._effectHandler.removeEffect.bind(this._effectHandler)
    );
  }

  /**
   * Searches through the list of available effects and returns one matching the
   * effect name. Prioritizes finding custom effects first.
   *
   * @param {string} effectName - the effect name to search for
   * @returns {ActiveEffect} the found effect
   */
  findEffectByName(effectName) {
    const effect = this.findCustomEffectByName(effectName);
    if (effect) return effect;

    return game.dfreds.effects.all.find((effect) => effect.name == effectName);
  }

  /**
   * Searches through the list of available custom effects and returns one matching the
   * effect name.
   *
   * @param {string} effectName - the effect name to search for
   * @returns {ActiveEffect} the found effect
   */
  findCustomEffectByName(effectName) {
    const effect = this._customEffectsHandler
      .getCustomEffects()
      .find((effect) => effect.name == effectName);

    return effect;
  }

  /**
   * Finds whether the effectName provided matches any of the default dnd5e status effects,
   * by comparing it against the values of the CONFIG.statusEffects object
   *
   * @param {string} effectName - name of the effect
   * @returns {object||false} - 
   *                        {
   *                          id: the effect.id of the effect or false, 
   *                          staticID: the effect._id,
   *                          isExhaustion: 
   *                                the exhaustion level change (eg. +2 for "Exhaustion +2", -4 for "Exhaustion -4"),
   *                                || null if the effectName is "Exhaustion"
   *                                || false if not Exhaustion
   *                        }
   *                          || false if not a statusEffect or the modifyStatusEffects is other than NONE
   */
  isStatusEffect(effectName) {
    if (this._settings.modifyStatusEffects !== 'none') return false;
    const regex = /^(\w+)(?:\s*([+-]?\d+))?$/;
    const [_, stringEffectName, numberEffectName] = effectName.match(regex) ?? [];
    const checkTranslationsName = Object.values(CONFIG.statusEffects).find((effect) => effect.name == stringEffectName);
    if (!checkTranslationsName) return false;
    const isExhaustion =
    	checkTranslationsName._id ===
    	CONFIG.statusEffects.find((effect) => effect.id == 'exhaustion')._id
    		? numberEffectName ?? null
    		: false;
    if (checkTranslationsName)
      return { id: checkTranslationsName.id, staticID: checkTranslationsName._id, isExhaustion };
    else return false;
  }

  /**
   * Toggles the effect on the provided actor UUIDS as the GM via sockets. If no actor
   * UUIDs are provided, it finds one of these in this priority:
   *
   * 1. The targeted tokens (if prioritize targets is enabled)
   * 2. The currently selected tokens on the canvas
   * 3. The user configured character
   *
   * @param {string} effectName - name of the effect to toggle
   * @param {object} params - the effect parameters
   * @param {boolean} params.overlay - if the effect is an overlay or not
   * @param {string[]} params.uuids - UUIDS of the actors to toggle the effect on
   * @returns {Promise} a promise that resolves when the GM socket function completes
   */
   async toggleEffect(effectName, { overlay, uuids = [] } = {}) {
    if (uuids.length == 0) {
      uuids = this._foundryHelpers.getActorUuids();
    }

    if (uuids.length == 0) {
      ui.notifications.error(
        `Please select or target a token to toggle ${effectName}`
      );
      return;
    }
    
    let effect;
    const isStatusEffect = this.isStatusEffect(effectName);
    if (!isStatusEffect) {
      effect = this.findEffectByName(effectName);
      if (!effect) {
        ui.notifications.error(`Effect ${effectName} was not found`);
        return;
      }
      
      if (this.hasNestedEffects(effect)) {
        effect = await this._getNestedEffectSelection(effect);
        if (!effect) return; // dialog closed without selecting one
      }
    }

    return this._socket.executeAsGM('toggleEffect', effect?.name ?? effectName, {
      overlay,
      uuids,
      isStatusEffect,
    });
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
    return this._effectHandler.hasEffectApplied(effectName, uuid);
  }

  /**
   * Removes the effect from the provided actor UUID as the GM via sockets
   *
   * @param {object} params - the effect params
   * @param {string} params.effectName - the name of the effect to remove
   * @param {string} params.uuid - the UUID of the actor to remove the effect from
   * @param {string | undefined} params.origin - only removes the effect if the origin
   * matches. If undefined, removes any effect with the matching name
   * @returns {Promise} a promise that resolves when the GM socket function completes
   */
  async removeEffect({ effectName, uuid, origin }) {
    let effect;
    const isStatusEffect = this.isStatusEffect(effectName);
    console.log(isStatusEffect)
    if (!isStatusEffect) {
      effect = this.findEffectByName(effectName);
        if (!effect) {
        ui.notifications.error(`Effect ${effectName} could not be found`);
        return;
      }
      if (this.hasNestedEffects(effect)) {
        effect = await this._getNestedEffectSelection(effect);
        if (!effect) return; // dialog closed without selecting one
      }
    }  

    const actor = this._foundryHelpers.getActorByUuid(uuid);

    if (!actor) {
      ui.notifications.error(`Actor ${uuid} could not be found`);
      return;
    }

    return this._socket.executeAsGM('removeEffect', {
      effectID: effect?.name ?? isStatusEffect.staticID,
      uuid,
      origin,
    });
  }

  /**
   * Adds the effect to the provided actor UUID as the GM via sockets
   *
   * @param {object} params - the params for adding an effect
   * @param {string} params.effectName - the name of the effect to add
   * @param {string} params.uuid - the UUID of the actor to add the effect to
   * @param {string} params.origin - the origin of the effect
   * @param {boolean} params.overlay - if the effect is an overlay or not
   * @param {object} params.metadata - additional contextual data for the application of the effect (likely provided by midi-qol)
   * @returns {Promise} a promise that resolves when the GM socket function completes
   */
  async addEffect({ effectName, uuid, origin, overlay, metadata }) {
    let effect;
    const actor = this._foundryHelpers.getActorByUuid(uuid);
    const token = actor.token?.object ?? actor.getActiveTokens()[0];

    if (!actor) {
      ui.notifications.error(`Actor ${uuid} could not be found`);
      return;
    }

    const isStatusEffect = this.isStatusEffect(effectName);
    console.log(isStatusEffect)
    if (isStatusEffect && isStatusEffect.isExhaustion === false) {
      effect = actor.appliedEffects.find((effect)=>effect._id === isStatusEffect.staticID);
      console.log(effect);
      if (effect) 
        await this._socket.executeAsGM('removeEffect', {
          effectID: effect?._id,
          uuid,
        });
      effect = await ActiveEffect.implementation.fromStatusEffect(isStatusEffect.id);
      const updateSource = {
        [`flags.${Constants.MODULE_ID}.${Constants.FLAGS.IS_CONVENIENT}`]: true
      };
      const changes = this.findEffectByName(effectName)?.changes || [];
      if (changes.length)
        foundry.utils.mergeObject(updateSource, { changes });     
      effect.updateSource(updateSource);
      console.log(effect)
    }
    else if (isStatusEffect && isStatusEffect.isExhaustion !== false) {
      const targetExhaustionLevel = isStatusEffect.isExhaustion;
      const systemExhaustionLevels = CONFIG.statusEffects.find(e=>e.id=='exhaustion').levels;
      const currentExhaustionlevel = actor.system.attributes.exhaustion ?? 0;
      const newExhaustionLevel = 
        !targetExhaustionLevel ? 
        Math.min(currentExhaustionlevel + 1, systemExhaustionLevels) :
          ['+', '-'].some((sign)=>targetExhaustionLevel.includes(sign)) ?
            Math.clamped(Number(currentExhaustionlevel) + Number(targetExhaustionLevel), 0, systemExhaustionLevels) :
             Math.clamped(Number(targetExhaustionLevel), 0, systemExhaustionLevels);
      console.log(targetExhaustionLevel, newExhaustionLevel)
      effect = actor.appliedEffects.find((effect)=>effect._id === isStatusEffect.staticID);
      if (!newExhaustionLevel) 
        return this._socket.executeAsGM('removeEffect', {
          effectID: effect?._id,
          uuid,
        });
      const name = `${CONFIG.statusEffects.find(e=>e.id=='exhaustion').name} ${newExhaustionLevel}`;
      console.log(name)
      const changes = this.findEffectByName(name)?.changes || [];
      console.log(effect)
      if (effect) 
        await this._socket.executeAsGM('removeEffect', {
          effectID: effect?._id,
          uuid,
        });
      effect = await ActiveEffect.implementation.fromStatusEffect(isStatusEffect.id);
      effect.updateSource({
        [`flags.${Constants.MODULE_ID}.${Constants.FLAGS.IS_CONVENIENT}`]: true,
        "flags.dnd5e.exhaustionLevel": Number(newExhaustionLevel),
        "flags.dnd5e.originalExhaustion": Number(currentExhaustionlevel),
        changes
      });
      effect = effect.toObject();
      effect.name = name;
    }
    else {
      effect = this.findEffectByName(effectName);

      if (!effect) {
        ui.notifications.error(`Effect ${effectName} could not be found`);
        return;
      }
      
      if (this.hasNestedEffects(effect) > 0) {
        effect = await this._getNestedEffectSelection(effect);
        if (!effect) return; // dialog closed without selecting one
      }
      effect = effect.toObject();
  
    }
    return this._socket.executeAsGM('addEffect', {
      effect,
      uuid,
      origin,
      overlay,
      isStatusEffect
    });
  }

  /**
   * Adds the defined effect to the provided actor UUID as the GM via sockets
   *
   * @param {object} params - the params for adding an effect
   * @param {object} params.effectData - the object containing all of the relevant effect data
   * @param {string} params.uuid - the UUID of the actor to add the effect to
   * @param {string} params.origin - the origin of the effect
   * @param {boolean} params.overlay - if the effect is an overlay or not
   * @returns {Promise} a promise that resolves when the GM socket function completes
   */
  async addEffectWith({ effectData, uuid, origin, overlay }) {
    if (foundry.utils.isEmpty(effectData)) {
      ui.notifications.error('No effectData were provided!');
      return;
    }
    let effect;
    const effectName = effectData.name;
    const isStatusEffect = effectName ? this.isStatusEffect(effectName) : false;
    
    if (isStatusEffect) {
      effect = await ActiveEffect.implementation.fromStatusEffect(isStatusEffect.id);
      foundry.utils.mergeObject(effectData.flags, {[`${Constants.MODULE_ID}.${Constants.FLAGS.IS_CONVENIENT}`]: true});
      effect.updateSource(effectData);
      console.log(effect);
    }
    else {
      effect = this._effectHelpers.createActiveEffect({
        ...effectData,
        origin,
      });
      if (this.hasNestedEffects(effect)) {
        effect = await this._getNestedEffectSelection(effect);
        if (!effect) return; // dialog closed without selecting one
      }
      //effect = effect.toObject();
    }

    const actor = this._foundryHelpers.getActorByUuid(uuid);

    if (!actor) {
      ui.notifications.error(`Actor ${uuid} could not be found`);
      return;
    }

    return this._socket.executeAsGM('addEffect', {
      effect: effect.toObject(),
      uuid,
      origin,
      overlay,
      isStatusEffect
    });
  }

  /**
   * Creates new custom effects with the provided active effect data.
   *
   * @param {object} params - the params for adding an effect
   * @param {ActiveEffect[]} params.activeEffects - array of active effects to add
   * @returns {Promise} a promise that resolves when the active effects have finished being added
   */
  createNewCustomEffectsWith({ activeEffects }) {
    return this._customEffectsHandler.createNewCustomEffectsWith({
      activeEffects,
    });
  }

  /**
   * Checks if the given effect has nested effects
   *
   * @param {ActiveEffect} effect - the active effect to check the nested effets on
   * @returns
   */
  hasNestedEffects(effect) {
    const nestedEffects =
      effect.getFlag(Constants.MODULE_ID, Constants.FLAGS.NESTED_EFFECTS) ?? [];

    return nestedEffects.length > 0;
  }

  async _getNestedEffectSelection(effect) {
    const nestedEffectNames =
      effect.getFlag(Constants.MODULE_ID, Constants.FLAGS.NESTED_EFFECTS) ?? [];
    const nestedEffects = nestedEffectNames
      .map((nestedEffect) =>
        game.dfreds.effectInterface.findEffectByName(nestedEffect)
      )
      .filter((effect) => effect !== undefined);

    const content = await renderTemplate(
      'modules/dfreds-convenient-effects/templates/nested-effects-dialog.hbs',
      { parentEffect: effect, nestedEffects }
    );
    const choice = await Dialog.prompt(
      {
        title: effect.name,
        content: content,
        label: 'Select Effect',
        callback: (html) => {
          const htmlChoice = html.find('select[name="effect-choice"]').val();
          return htmlChoice;
        },
        rejectClose: false,
      },
      { width: 300 }
    );

    return nestedEffects.find((nestedEffect) => nestedEffect.name == choice);
  }

  /**
   * Adds the given effect name to the status effects. Note that Foundry
   * needs to be refreshed to reflect the changes on the token HUD.
   *
   * @param {string} effectName - the effect name to add as a status effect
   */
  async addStatusEffect(effectName) {
    await this._settings.addStatusEffect(effectName);
  }

  /**
   * Removes the given effect name from the status effects. Note that Foundry
   * needs to be refreshed to reflect the changes on the token HUD.
   *
   * @param {string} effectName - the effect name to remove as a status effect
   */
  async removeStatusEffect(effectName) {
    await this._settings.removeStatusEffect(effectName);
  }
}
