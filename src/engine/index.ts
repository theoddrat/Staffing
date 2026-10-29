// AI CRASH MONITOR scenario engine — public surface (implements EngineAPI in src/types/engine.ts).
import type { EngineAPI } from '../types/engine';
import { explainStock } from './explain';
import { runMonteCarlo, withRanges } from './montecarlo';
import { defaultParams } from './presets';
import { runScenario } from './scenario';

export { runScenario } from './scenario';
export { runMonteCarlo, withRanges, sampleSpecs, DEFAULT_MC_RUNS, DEFAULT_MC_SEED } from './montecarlo';
export { defaultParams, paramSpecs, presetById, withHorizon, horizonForWindow } from './presets';
export { effectiveQuantity, quantityIndex, restsOnAssumption } from './quantities';
export { securityWaterfall, securityWaterfall as originWaterfall } from './waterfall';
export { prepare } from './prepare';
export { explainStock, intensityValues, scenarioHeadline } from './explain';
export { ENSEMBLE_H } from './ensemble';
export type { CoefSel, NiftySel } from './ensemble';
export type { EffectiveQuantity, Intensity, IntensityValues, MCResultV2, Waterfall, WaterfallStep } from './types-extra';

export const engine: EngineAPI = { defaultParams, runScenario, runMonteCarlo, withRanges, explainStock };
export default engine;
