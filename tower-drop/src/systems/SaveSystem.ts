import type { CitySave, SceneId } from '../types';
import { MAP_ARCHETYPES } from '../types';
import { CitySystem } from './CitySystem';
import type { MarketSystem } from './MarketSystem';

const KEY = 'city-builder-save-v1';

export function saveCity(city: CitySystem, scene: SceneId, market?: MarketSystem): boolean {
  try {
    const save: CitySave = {
      version: '1.0.0',
      scene,
      seed: city.seed,
      peopleCount: city.people.length,
      carsCount: city.cars.length,
      bikesCount: city.cyclists.length,
      objects: city.serialize(),
      money: city.money,
      zones: [...city.zones],
      season: city.season,
      taxRate: city.taxRate,
      goals: [...city.goals],
      peopleNames: city.people.map((p) => p.name),
      archetype: city.archetype,
      // personal allowance / holdings — never mixed into the city treasury
      stocks: market ? market.serialize() : undefined,
    };
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch (e) {
    console.error('Save failed', e);
    return false;
  }
}

export function loadCity(city: CitySystem, market?: MarketSystem): SceneId | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const save = JSON.parse(raw) as CitySave;
    city.seed = save.seed;
    city.taxRate = typeof save.taxRate === 'number' ? save.taxRate : 1; // older saves → 100%
    city.goals = save.goals ? [...save.goals] : []; // older saves → re-claim on restore
    city.archetype = save.archetype ?? 'grid'; // older saves → classic grid (park centre)
    city.restore(save.objects, save.peopleCount, save.carsCount, save.money, save.zones, save.bikesCount);
    if (save.peopleNames) city.applyPeopleNames(save.peopleNames); // people re-spawn by count only
    if (save.season) city.setSeason(save.season); // after restore so snow caps match
    const archName = MAP_ARCHETYPES.find((a) => a.id === city.archetype)?.name ?? 'Classic Grid';
    city.pushNews(`🗺️ ${archName} map restored — welcome back!`);
    market?.restore(save.stocks); // older saves (no key) → a fresh allowance
    return save.scene;
  } catch (e) {
    console.error('Load failed', e);
    return null;
  }
}

export function hasSave(): boolean {
  return localStorage.getItem(KEY) !== null;
}