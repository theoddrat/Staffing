// Every Learn illustration renders against the real bundle (several scenarios) and with no data,
// without throwing and without leaking NaN / undefined / Infinity into the drawing.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultParams, runScenario } from '../../engine/index';
import type { DataBundle } from '../../types/data';
import type { Horizon, PresetId } from '../../types/engine';
import { ILL_IDS, ILLUSTRATIONS } from '../illustrations';

const PATH = fileURLToPath(new URL('../../../public/data.json', import.meta.url));
const HAS = existsSync(PATH);
const BAD = /NaN|undefined|Infinity/;

function render(id: (typeof ILL_IDS)[number], props: Parameters<(typeof ILLUSTRATIONS)['beta']>[0]) {
  const Draw = ILLUSTRATIONS[id];
  return renderToStaticMarkup(<Draw {...props} />);
}

describe('illustrations', () => {
  it('render with no data (schematic fallbacks)', () => {
    for (const id of ILL_IDS) {
      const html = render(id, { bundle: null, result: null });
      expect(html, id).toContain('<svg');
      expect(BAD.test(html), `${id}: ${html.match(/.{30}(NaN|undefined|Infinity).{30}/)?.[0]}`).toBe(false);
    }
  });

  describe.skipIf(!HAS)('real data.json', () => {
    const bundle = (HAS ? JSON.parse(readFileSync(PATH, 'utf8')) : null) as DataBundle;
    const cases: [PresetId, Horizon][] = [
      ['fullpop', '1M'],
      ['fullpop', '12M'],
      ['capex', '1D'],
      ['guidance', '1M'],
      ['restatement', '1D'],
      ['multiple', '12M'],
      ['credit', '1M'],
      ['replay', '1M'],
    ];
    it('render every illustration for every preset without NaN', () => {
      for (const [preset, h] of cases) {
        const result = runScenario(bundle, defaultParams(bundle, preset, h));
        for (const id of ILL_IDS) {
          for (const compact of [false, true]) {
            const html = render(id, { bundle, result, compact });
            expect(BAD.test(html), `${preset}/${h} ${id}: ${html.match(/.{30}(NaN|undefined|Infinity).{30}/)?.[0]}`).toBe(false);
          }
        }
      }
    });

    it('data-driven drawings use real values', () => {
      const result = runScenario(bundle, defaultParams(bundle, 'fullpop', '1M'));
      // beta scatter uses the real shock-day points of the showcase stock
      expect(render('beta', { bundle, result })).toMatch(/slope -?\d\.\d\d on \d+ big US-chip days/);
      // capex bars total the hyperscalers' reported capex
      expect(render('capex', { bundle, result })).toMatch(/Together: \$[\d,]+bn/);
      // drawdown overlay labels the dot-com Nasdaq-100 fall
      expect(render('drawdown', { bundle, result })).toMatch(/drawdown −8\d%/);
      // event study chart (DeepSeek) has the groups' end values
      expect(render('car', { bundle, result })).toContain('DeepSeek');
      // provenance legend shows real counts
      expect(render('sources', { bundle, result })).toMatch(/\d+ cited sources/);
    });
  });
});
