import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DataBundle } from '../../../types/data';
import { caseReplay, caseStart, caseStudy, CRASH_VIS, eras, periodStart } from '../timeline';
import { GLOSSARY_IDS } from '../../../learn/ids';

const PATH = fileURLToPath(new URL('../../../../public/data.json', import.meta.url));
const HAS = existsSync(PATH);

describe('timeline helpers', () => {
  it('reads the first date written in a period', () => {
    expect(periodStart('7-Jan-2009')).toBe('2009-01-07');
    expect(periodStart('Mar-2000 – Oct-2002')).toBe('2000-03-01');
    expect(periodStart('2000 – 2002')).toBe('2000-07-01');
    expect(periodStart('1844–1850')).toBe('1844-07-01');
    expect(periodStart('no date')).toBeNull();
  });
  it('every crash type links to a glossary entry', () => {
    for (const v of Object.values(CRASH_VIS)) expect(GLOSSARY_IDS as readonly string[]).toContain(v.term);
  });
});

describe.skipIf(!HAS)('timeline on the real bundle', () => {
  const b = JSON.parse(readFileSync(PATH, 'utf8')) as DataBundle;
  const cases = b.history.cases;
  it('eras keep every case once, in date order, with gaps between eras', () => {
    const es = eras(cases);
    const flat = es.flatMap((e) => e.cases);
    expect(flat.length).toBe(cases.length);
    expect(new Set(flat.map((c) => c.id)).size).toBe(cases.length);
    for (let i = 1; i < flat.length; i++) expect(caseStart(flat[i]) >= caseStart(flat[i - 1])).toBe(true);
    for (const e of es.slice(1)) expect(e.gapBefore).toBeGreaterThan(1.5);
    expect(es[es.length - 1].cluster).toBe(true);
  });
  it('cases link to their own event studies and replay windows', () => {
    const by = (id: string) => cases.find((c) => c.id === id);
    const d = by('deepseek');
    if (d) expect(caseStudy(d, b.history.event_studies)?.id).toBe('es_deepseek');
    const s = by('smci2024');
    if (s) expect(caseStudy(s, b.history.event_studies)?.id).toMatch(/^es_smci/);
    const dc = by('dotcom');
    if (dc) expect(caseReplay(dc, b.history.replay_windows)?.id).toBe('DOTCOM');
    // a linked study is never far from its case
    for (const c of cases) {
      const es = caseStudy(c, b.history.event_studies);
      if (es) expect(Math.abs(Number(es.date.slice(0, 4)) - Number(caseStart(c).slice(0, 4)))).toBeLessThanOrEqual(2);
    }
  });
});
