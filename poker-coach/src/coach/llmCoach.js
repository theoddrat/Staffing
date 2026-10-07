// Optional AI coach: Claude writes study plans and reviews hands from your
// stats and hand histories. Inside a published Claude artifact it uses the
// page's built-in `sample` capability (no key needed); run locally it uses
// the official Anthropic SDK in the browser with the player's own API key
// (kept in this browser only).

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
const MODEL = 'claude-opus-5-5';

const SYSTEM = `You are a world-class no-limit hold'em tournament coach reviewing a student's play from a training app.
The app's "GTO" numbers come from a GTO-approximate model (preflop charts, Nash push/fold, and theory-based postflop heuristics), not a full solver — treat them as strong guidance, not gospel.
Be concrete and practical: name spots, hands, sizings and frequencies. Prefer short paragraphs and tight bullet lists. No filler, no motivational fluff.`;

let clientPromise = null;
let sampleFn = null;

/** Resolve the artifact runtime's `sample` capability when the page runs inside a Claude viewer. */
export async function initHostBridge() {
  try {
    if (typeof globalThis.window?.claude?.use !== 'function') return false;
    sampleFn = await window.claude.use('sample');
  } catch {
    sampleFn = null;
  }
  return !!sampleFn;
}

export const hostBridgeReady = () => !!sampleFn;

export function coachAvailable(settings) {
  return !!(settings?.apiKey || sampleFn);
}

async function getClient(apiKey) {
  if (!clientPromise) {
    clientPromise = import(/* @vite-ignore */ SDK_URL).then((mod) => {
      const Anthropic = mod.default || mod.Anthropic;
      return (key) => new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    });
  }
  const make = await clientPromise;
  return make(apiKey);
}

/** Send one prompt; returns the reply text. */
export async function askCoach(settings, prompt) {
  if (!settings?.apiKey && sampleFn) {
    try {
      const { text, truncated } = await sampleFn(`${SYSTEM}\n\n${prompt}`, { modelTier: 'complex', cache: false });
      return truncated ? `${text}\n\n(Answer cut short.)` : text;
    } catch (e) {
      if (e?.code === 'not_granted') throw new Error('Permission to ask Claude was not granted on this page.');
      if (e?.code === 'rate_limited') throw new Error('Too many requests — try again in a minute.');
      throw new Error(e?.message || 'The AI coach is unavailable.');
    }
  }
  if (!settings?.apiKey) throw new Error('No API key set');
  const client = await getClient(settings.apiKey);
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium' },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The model declined this request.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) throw new Error('Empty response.');
  return text;
}

const p = (x) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);

export function studyPlanPrompt({ stats, style, likes, statLeaks, decLeaks, mistakes }) {
  const lines = [];
  lines.push(`Student profile after ${stats.hands} hands (WSOP-style tournaments, BB-ante structure).`);
  lines.push(`Style read: ${style.label}. Closest AI profiles: ${likes.map((l) => `${l.profile.name} (${l.similarity}% similar)`).join(', ') || 'n/a'}.`);
  lines.push(`HUD: VPIP ${p(stats.vpip)}, PFR ${p(stats.pfr)}, 3-bet ${p(stats.threeBet)}, fold to 3-bet ${p(stats.foldTo3Bet)}, steal ${p(stats.steal)}, fold to steal ${p(stats.foldToSteal)}, BB defense ${p(stats.bbDefense)}, flop c-bet ${p(stats.cbet)}, fold to c-bet ${p(stats.foldToCbet)}, turn c-bet ${p(stats.turnCbet)}, AF ${stats.af?.toFixed(2) ?? 'n/a'}, WTSD ${p(stats.wtsd)}, W$SD ${p(stats.wsd)}, win rate ${stats.bb100?.toFixed(1) ?? 'n/a'} bb/100.`);
  if (statLeaks.length) lines.push(`Stat leaks flagged by the app:\n${statLeaks.slice(0, 6).map((l) => `- ${l.title}: ${l.detail}`).join('\n')}`);
  if (decLeaks.length) lines.push(`Accuracy by decision spot (worst first):\n${decLeaks.slice(0, 6).map((l) => `- ${l.spot}: ${p(l.accuracy)} over ${l.n} decisions, ~${l.evLoss.toFixed(1)}bb lost`).join('\n')}`);
  if (mistakes.length) {
    lines.push(`Recent graded mistakes:\n${mistakes.slice(0, 8).map((d) => `- ${d.spot}: ${d.pos} ${d.cards}${d.board ? ` on ${d.board}` : ''} — played "${d.taken}", model preferred "${d.best}" (${d.grade})`).join('\n')}`);
  }
  lines.push(`Write a study plan for the next 3 sessions: (1) the two or three leaks that cost the most, with the correct adjustment and concrete example hands; (2) one drill per leak using the app's Train tab (preflop charts, push/fold, pot odds) or specific table situations to seek out; (3) which AI opponent profiles to practice against and why. Keep it under 450 words.`);
  return lines.join('\n\n');
}

export function handReviewPrompt(record, decisions) {
  const parts = [`Review this hand for the student (the hero). Explain the key decision points, what a strong player does on each street and why, and whether the student's line was good. Under 350 words.`];
  if (record.text) parts.push(`Hand history:\n${record.text}`);
  if (decisions?.length) {
    parts.push(`The app's grades for the hero's decisions:\n${decisions.map((d) => `- ${d.street}: played "${d.taken}" — ${d.grade}. Model mix: ${d.mix.map((m) => `${m.label} ${p(m.freq)}`).join(', ')}. Notes: ${d.notes.slice(0, 3).join(' ')}`).join('\n')}`);
  }
  return parts.join('\n\n');
}
