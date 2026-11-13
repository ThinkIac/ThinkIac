import { readMigratedStorage } from './storage_migration.js';

export const INPUTBAR_OPTIONS_KEY = 'agent:inputbar-options:v1';
export const DEFAULT_OPTIONS = Object.freeze({
  moeEnabled: true, reasoningMode: 'auto', approximation: 'auto',
  locationApproximate: true, pinsTab: 'active', model: 'auto',
});

function storageTarget(storage) {
  return storage === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : storage;
}

export function normalizeInputBarOptions(value) {
  const data = value && typeof value === 'object' ? value : {};
  return {
    moeEnabled: typeof data.moeEnabled === 'boolean' ? data.moeEnabled : true,
    reasoningMode: ['auto', 'cot'].includes(data.reasoningMode) ? data.reasoningMode : 'auto',
    approximation: ['auto', 'full', 'compact', 'detailed'].includes(data.approximation) ? data.approximation : 'auto',
    locationApproximate: typeof data.locationApproximate === 'boolean' ? data.locationApproximate : true,
    pinsTab: data.pinsTab === 'inactive' ? 'inactive' : 'active',
    model: typeof data.model === 'string' && data.model ? data.model : 'auto',
  };
}

export function loadInputBarOptions(storage) {
  try {
    const target = storageTarget(storage);
    return normalizeInputBarOptions(JSON.parse(readMigratedStorage(target, INPUTBAR_OPTIONS_KEY, ['aurora:inputbar-options:v1']) || '{}'));
  } catch { return { ...DEFAULT_OPTIONS }; }
}

export function saveInputBarOptions(value, storage) {
  try {
    storageTarget(storage)?.setItem(INPUTBAR_OPTIONS_KEY, JSON.stringify(normalizeInputBarOptions(value)));
  } catch { /* Quota ou storage bloqueado não impede o envio. */ }
}
