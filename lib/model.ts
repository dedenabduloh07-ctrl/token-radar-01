// The token radar's model, radar-2: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// every pre-token protocol below the floor that passes the same exclusion rule the watchlist uses:
// not a bridge, liquid-staking, restaking or exchange product, not a versioned pool, no wrapped or
// staked word in its name, no exchange prefix. A protocol above the floor that the watchlist leaves
// out is left out: the house rule kept it off because DefiLlama records a parent protocol for it,
// a field this file does not carry, and the board does not re-add products of another protocol.
//
// Implied value follows only from the snapshot's own figures, and the base multiple is not assumed:
// it is the market's own. The model calibrates it from the snapshot's live-token protocols (every
// protocol that records a token, outside CEX, with a market cap and a TVL): the median of their
// market-cap-to-TVL ratios. The same three inputs score every row, and no protocol name is ever
// special-cased:
//
//   multiple   = median(mcap_usd / tvl_usd) over the live-token set
//   base       = tvl_usd x multiple
//   growth     = clamp(change_7d, -60, 120) per cent          (unreported growth counts as 0)
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4       (unknown age counts as 365 days)
//   implied    = max(1, round(base x growthMult x maturity))
//
// Live-token protocols are kept apart and shown with the market's own values, never mixed into the
// ranked board. Category medians are context for the reader, never an input: the ranking uses the
// one market median, so no category is favoured by assumption.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. base_multiple is calibrated, not assumed. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

/** The fixed shape of the model; the base multiple is filled in by calibrate(). */
export const MODEL_SHAPE = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
} as const;

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The smallest live-token count for which a category median is shown as context. */
export const MIN_CATEGORY_LIVE = 3;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** How the base multiple was calibrated from the snapshot's live-token set. */
export interface Calibration {
  live_count: number;
  median_multiple: number;
  q1_multiple: number;
  q3_multiple: number;
  min_multiple: number;
  max_multiple: number;
}

/** A category's live-token median multiple, shown as context, never a model input. */
export interface CategoryMultiple {
  category: string;
  live_count: number;
  median_multiple: number;
}

/** The coverage funnel: how the snapshot's protocols became the board's rows. */
export interface Funnel {
  scanned: number;
  records_token: number;
  pre_token: number;
  watchlist: number;
  early: number;
  excluded_below_floor: number;
  excluded_below_floor_by_category: number;
  excluded_below_floor_versioned: number;
  excluded_below_floor_wrapped_word: number;
  excluded_below_floor_exchange_prefix: number;
  above_floor_not_watchlist: number;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  calibration: Calibration;
  category_multiples: CategoryMultiple[];
  funnel: Funnel;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted numeric array; the mean of the middle two when its length is even. */
export function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A quartile of a sorted numeric array, by nearest rank. */
function quartileOf(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[at]!;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The live-token set the multiple is calibrated from: a token recorded, not a CEX, priced. */
export function liveSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX' && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0);
}

/**
 * The market's own multiple: the median market-cap-to-TVL ratio of the live-token set, with the
 * quartiles that show how wide the market's own range is. The median, not the mean, so one
 * mispriced protocol cannot move it.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const ratios = liveSet(snapshot)
    .map((p) => (p.mcap_usd as number) / p.tvl_usd)
    .sort((a, b) => a - b);
  return {
    live_count: ratios.length,
    median_multiple: medianOf(ratios),
    q1_multiple: quartileOf(ratios, 0.25),
    q3_multiple: quartileOf(ratios, 0.75),
    min_multiple: ratios.length > 0 ? ratios[0]! : 0,
    max_multiple: ratios.length > 0 ? ratios[ratios.length - 1]! : 0,
  };
}

/** The model the snapshot calibrates: the fixed shape plus the market's own multiple. */
export function modelFor(snapshot: Snapshot): ModelConstants {
  return { base_multiple: calibrate(snapshot).median_multiple, ...MODEL_SHAPE };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that name a wrapped, staked, bridged or exchange product, not a protocol of its own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchange names: a protocol beginning with one is the exchange's own product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word wrapped, staked or staking in a name, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Why a protocol is left out of the early radar, or null when it may be ranked: the watchlist's own
 * exclusion rule, applied to the protocols below the floor. The checks run in a fixed order so the
 * funnel's counts are disjoint.
 */
export function exclusionReason(p: SnapshotProtocol): 'category' | 'versioned' | 'wrapped-word' | 'exchange-prefix' | null {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return 'category';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped-word';
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return 'exchange-prefix';
  return null;
}

/** Whether a protocol is one the early radar may rank: pre-token and no product exclusion. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, as the house rule vetted it.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every pre-token protocol below the floor that passes the exclusion rule, by
  // TVL. Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in the words a farmer budgets with. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $5 to $15 of gas';
  if (c === 'solana' || c.includes('hyperliquid') || c.includes('sui') || c === 'aptos') return 'under $0.10 of gas';
  if (c === 'binance' || c.includes('bnb')) return 'under $0.50 of gas';
  if (c === 'bitcoin') return 'a few dollars of network fees';
  if (c === 'tron') return 'under $1 of energy fees';
  return 'under $1 of gas';
}

/** What a week's qualifying actions cost on a chain. */
function weeklyGasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $5 of gas a week';
  if (c === 'bitcoin') return 'a few dollars of fees a week';
  return 'about $1 of gas a week';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('uncollateralized')) return `Lend $${capital} of USDC through ${name} on ${chain} and keep the loan position open.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('leveraged farm')) return `Open a leveraged farm with $${capital} on ${name} on ${chain} at the lowest leverage it offers, and watch the health factor.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} managed liquidity position on ${chain} and keep it in range.`;
  if (c.includes('dex') || c.includes('exchange')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} of USDC into a ${name} yield vault on ${chain} and keep the shares.`;
  if (c.includes('basis')) return `Deposit $${capital} into a ${name} basis strategy on ${chain} and hold the position through one funding cycle.`;
  if (c.includes('interest rate')) return `Deposit $${capital} on ${name} on ${chain} and open one fixed-rate position.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset through ${name} on ${chain} and hold it.`;
  if (c.includes('anchor btc') || c.includes('decentralized btc')) return `Deposit $${capital} worth of BTC through ${name} on ${chain} and hold the receipt token.`;
  if (c.includes('stablecoin') || c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('cedefi')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('payment')) return `Fund $${capital} and make one real payment through ${name} on ${chain}.`;
  if (c.includes('governance')) return `Deposit $${capital} and vote in one governance round on ${name}.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index token on ${chain} and hold it.`;
  if (c.includes('farm')) return `Deposit $${capital} into a ${name} farm on ${chain} and keep the position staked.`;
  if (c.includes('card')) return `Load $${capital} onto the ${name} card and spend it in one real purchase.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${name}, swap once, and deposit into one of its native apps.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: gas + ' for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Return each week and make one real action in ${p.name} — a deposit, a borrow, a swap or a vote — so the wallet's history is continuous, not a single day.`,
      cost: weeklyGasFor(chain),
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check whether ${p.name} runs a points program on its own site or docs, and claim only from a link the protocol itself publishes — never from a DM, an ad or a search result.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, and plan the unwind before you need it: know the withdrawal steps and any lock or cooldown.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/**
 * Each category's live-token median multiple, where enough live-token protocols exist to say so.
 * Context for the reader, never a model input: the ranking uses the one market median.
 */
export function categoryMultiples(snapshot: Snapshot): CategoryMultiple[] {
  const byCategory = new Map<string, number[]>();
  for (const p of liveSet(snapshot)) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push((p.mcap_usd as number) / p.tvl_usd);
    byCategory.set(key, list);
  }
  const out: CategoryMultiple[] = [];
  for (const [category, ratios] of byCategory) {
    if (ratios.length < MIN_CATEGORY_LIVE) continue;
    ratios.sort((a, b) => a - b);
    out.push({ category, live_count: ratios.length, median_multiple: medianOf(ratios) });
  }
  out.sort((a, b) => b.live_count - a.live_count || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return out;
}

/** The coverage funnel: how the snapshot's protocols became the board's rows. */
export function funnelOf(snapshot: Snapshot, boardSize: number): Funnel {
  const watchlist = new Set(snapshot.watchlist);
  let preToken = 0;
  let excluded = 0;
  let byCategory = 0;
  let versioned = 0;
  let wrappedWord = 0;
  let exchangePrefix = 0;
  let aboveFloorNotWatchlist = 0;
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    preToken++;
    if (watchlist.has(p.slug)) continue;
    if (p.tvl_usd >= snapshot.floor_usd) {
      aboveFloorNotWatchlist++;
      continue;
    }
    const reason = exclusionReason(p);
    if (reason === null) continue;
    excluded++;
    if (reason === 'category') byCategory++;
    else if (reason === 'versioned') versioned++;
    else if (reason === 'wrapped-word') wrappedWord++;
    else exchangePrefix++;
  }
  return {
    scanned: snapshot.protocols.length,
    records_token: snapshot.protocols.length - preToken,
    pre_token: preToken,
    watchlist: snapshot.watchlist.length,
    early: boardSize - snapshot.watchlist.length,
    excluded_below_floor: excluded,
    excluded_below_floor_by_category: byCategory,
    excluded_below_floor_versioned: versioned,
    excluded_below_floor_wrapped_word: wrappedWord,
    excluded_below_floor_exchange_prefix: exchangePrefix,
    above_floor_not_watchlist: aboveFloorNotWatchlist,
  };
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = modelFor(snapshot);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.length - snapshot.watchlist.length,
    live_size: live.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    calibration: calibrate(snapshot),
    category_multiples: categoryMultiples(snapshot),
    funnel: funnelOf(snapshot, board.length),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** The gate's own ceiling on one row's implied value, in whole dollars. */
const IMPLIED_MAX = 100_000_000_000_000;

/**
 * Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied
 * value, farm steps, and every slug a protocol the snapshot lists.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board names a slug twice';
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (r.name.trim().length === 0) return `${r.slug} has an empty name`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 it must`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > IMPLIED_MAX) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
