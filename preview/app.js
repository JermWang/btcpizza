// app.js — Jensen Strategy dashboard scaffold (countdown, polling, holders, receipts)
// Adapted from BTC Pizza Strategy / Jensen Strategy preview index. Pre-launch friendly.

const state = {
  config: null,
  holderSnapshot: null,
  feeReceipts: [],
  rewardReceipts: [],
  rewardsStatus: null,
  operations: null,
  wbtcPoolBalance: 0,
  remaining: 0,
  cycle: null,
  configSyncedAtMs: Date.now(),
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const SET = (id, val) => {
  document.querySelectorAll(`#${id}, #${id}-mirror`).forEach((el) => {
    if (el) el.textContent = val;
  });
};

const els = {
  pool: $("#pool"),
  countdown: $("#countdown"),
  countdownProgress: $("#countdownProgress"),
  cycleStatus: $("#cycleStatus"),
  sliceSchedule: $("#sliceSchedule"),
  creatorFees: $("#creatorFees"),
  lastReceipt: $("#lastReceipt"),
  score: $("#score"),
  holderRank: $("#holderRank"),
  cutoffScore: $("#cutoffScore"),
  estimate: $("#estimate"),
  ticketStatus: $("#ticketStatus"),
  poolCardBalance: $("#poolCardBalance"),
  poolUsd: $("#poolUsd"),
  poolLastReceipt: $("#poolLastReceipt"),
  poolMeter: $("#poolMeter"),
  poolMeterLabel: $("#poolMeterLabel"),
  feeStatus: $("#feeStatus"),
  swapStatus: $("#swapStatus"),
  holderStatus: $("#holderStatus"),
  batch: $("#batch"),
  receipts: $("#receipts"),
  receiptsGrid: $("#receiptsGrid"),
  receiptEmpty: $("#receiptEmpty"),
  tickerTrack: $("#tickerTrack"),
  holderSearch: $("#holderSearch"),
  holderTable: $("#holderTable"),
  holderCutoff: $("#holderCutoff"),
  holderSource: $("#holderSource"),
  drawMeter: $("#drawMeter"),
  drawRank: $("#drawRank"),
  drawEdge: $("#drawEdge"),
  drawOddsLabel: $("#drawOdds"),
  copyContract: $("#copyContract"),
  refreshData: $("#refreshData"),
  topBar: $("#topBar"),
  menuToggle: $("#menuToggle"),
  primaryNav: $("#primaryNav"),
};

const marketFallback = {
  bitcoin: { usd: null, usd_24h_change: null },
  solana: { usd: null, usd_24h_change: null },
  ethereum: { usd: null, usd_24h_change: null },
  "jupiter-exchange-solana": { usd: null, usd_24h_change: null },
  dogwifcoin: { usd: null, usd_24h_change: null },
  bonk: { usd: null, usd_24h_change: null },
};

function shortAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
function solscanTx(signature) {
  const base = state.config?.solscanBaseUrl || "https://solscan.io";
  return `${base.replace(/\/$/, "")}/tx/${signature}`;
}
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function holderSearchText(h) {
  return [h?.wallet, h?.address, h?.solDomain, h?.domain, h?.snsName, h?.name]
    .filter(Boolean).join(" ").toLowerCase();
}
function formatTime(s) {
  const safe = Math.max(0, s);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60).toString().padStart(2, "0");
  const sec = Math.floor(safe % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}
function formatDurationLabel(sec) {
  const safe = Math.max(1, Math.round(sec));
  const d = Math.floor(safe / 86400);
  const h = Math.floor((safe % 86400) / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
function boundedPower(base, mult, exp) {
  const v = base * mult ** exp;
  return Number.isFinite(v) && v < Number.MAX_SAFE_INTEGER ? v : Number.MAX_SAFE_INTEGER;
}
function distributionStep(i) {
  const sec = state.config?.distributionScheduleSeconds || [];
  const labels = state.config?.distributionScheduleLabels || [];
  const caps = state.config?.distributionHolderCaps || [];
  const baseI = Number(state.config?.distributionBaseIntervalSeconds || sec[0] || 180);
  const mI = Number(state.config?.distributionIntervalMultiplier || 2);
  const baseC = Number(state.config?.distributionBaseHolderCap || caps[0] || 5);
  const mC = Number(state.config?.distributionHolderCapMultiplier || 2);
  const seconds = Number(sec[i]) || boundedPower(baseI, mI, i);
  const cap = Number(caps[i]) || boundedPower(baseC, mC, i);
  return {
    epochIndex: i,
    seconds: Math.max(1, Math.round(seconds)),
    holderCap: Math.max(1, Math.floor(cap)),
    label: labels[i] || formatDurationLabel(seconds),
  };
}
function distributionSchedule(currentIndex = 0) {
  const n = Math.max(1, Number(state.config?.distributionPreviewEpochs || 4));
  const start = Math.max(0, currentIndex >= n ? currentIndex - Math.floor(n / 2) : 0);
  return Array.from({ length: n }, (_, o) => distributionStep(start + o));
}
function distributionCycle(nowMs = Date.now()) {
  const step = distributionStep(0);
  return {
    active: false,
    schedule: distributionSchedule(0),
    scheduleIndex: 0,
    epochIndex: 0,
    interval: step.seconds,
    label: step.label,
    holderCap: step.holderCap,
    remaining: step.seconds,
    progress: 0,
  };
}
function renderSliceSchedule(cycle) {
  if (!els.sliceSchedule || !cycle?.schedule) return;
  els.sliceSchedule.innerHTML = cycle.schedule.slice(0, 4).map((step) => {
    const status = cycle.active
      ? step.epochIndex < cycle.scheduleIndex ? "done"
        : step.epochIndex === cycle.scheduleIndex ? "active" : ""
      : "";
    return `<div class="slice-step ${status}" title="Up to ${escapeHtml(step.holderCap.toLocaleString())} holders">${escapeHtml(step.label)}</div>`;
  }).join("");
}

function syncCountdown() {
  const cycle = distributionCycle();
  state.cycle = cycle;
  state.remaining = cycle.remaining;
  if (els.countdown) els.countdown.textContent = cycle.active ? formatTime(state.remaining) : "03:00";
  if (els.countdownProgress) els.countdownProgress.style.setProperty("--countdown-progress", `${Math.round(cycle.progress * 100)}%`);
  // Update both #interval (KPI) and #interval-mirror (schedule card)
  document.querySelectorAll("#interval, #interval-mirror").forEach((el) => el.textContent = cycle.label || "3 min");
  SET("epochHolderCap", String(cycle.holderCap));
  if (els.cycleStatus) els.cycleStatus.textContent = cycle.stage || (cycle.active ? `Epoch ${cycle.epochIndex + 1}` : "Warming up");
  renderSliceSchedule(cycle);
}

function renderShell() {
  syncCountdown();
  const ca = state.config?.contractAddress || "";
  if (els.copyContract) {
    const labelEl = els.copyContract.querySelector(".ca-value");
    if (ca) {
      if (labelEl) labelEl.textContent = shortAddress(ca);
      els.copyContract.disabled = false;
      els.copyContract.classList.add("ready");
    } else {
      if (labelEl) labelEl.textContent = "pending";
      els.copyContract.disabled = true;
    }
  }
}

function renderTicket(current) {
  const q = els.holderSearch?.value.trim() || "";
  const isEligible = current?.status === "eligible" || current?.eligible === true;
  if (els.score) els.score.textContent = current?.balanceLabel || current?.balance || "—";
  if (els.holderRank) els.holderRank.textContent = current?.rank ? `#${current.rank}` : "—";
  if (els.cutoffScore) els.cutoffScore.textContent = current?.cutoffScore?.toLocaleString?.() || "—";
  if (els.estimate) els.estimate.textContent = current?.projected_reward ? `${current.projected_reward} NVDAx` : "—";
  if (els.ticketStatus) {
    els.ticketStatus.textContent = current ? (isEligible ? "ELIGIBLE" : "NOT IN CUT") : q ? "NO MATCH" : "SEARCH";
    els.ticketStatus.classList.toggle("status-live", current && isEligible);
    els.ticketStatus.classList.toggle("status-pending", current && !isEligible);
  }
}

function resolveCurrentHolder() {
  const query = els.holderSearch?.value.trim().toLowerCase() || "";
  const holders = Array.isArray(state.holderSnapshot?.holders) ? state.holderSnapshot.holders : [];
  if (!query) return null;
  if (state.holderSnapshot?.current && holderSearchText(state.holderSnapshot.current).includes(query)) return state.holderSnapshot.current;
  return holders.find((holder) => holderSearchText(holder) === query) || holders.find((holder) => holderSearchText(holder).includes(query)) || null;
}

function renderHolderViews() {
  const current = resolveCurrentHolder();
  renderHolderBoard();
  renderTicket(current);
  renderDrawStats(current);
}

function renderDrawStats(current) {
  if (!current) {
    if (els.drawMeter) els.drawMeter.style.setProperty("--meter", "0%");
    if (els.drawRank) els.drawRank.textContent = "—";
    if (els.drawEdge) els.drawEdge.textContent = "—";
    if (els.drawOddsLabel) els.drawOddsLabel.textContent = "—";
    return;
  }
  if (els.drawMeter) els.drawMeter.style.setProperty("--meter", `${Math.max(0, Math.min(100, Number(current.cutoffProgress || 0)))}%`);
  if (els.drawRank) els.drawRank.textContent = current.rank ? `#${current.rank}` : "—";
  if (els.drawEdge) els.drawEdge.textContent = Number.isFinite(Number(current.cutoffDelta))
    ? `${Number(current.cutoffDelta) >= 0 ? "+" : ""}${Number(current.cutoffDelta).toLocaleString()}`
    : "—";
  if (els.drawOddsLabel) els.drawOddsLabel.textContent = current.oddsLabel || current.transfer_status || "—";
}

function renderHolderBoard() {
  const snap = state.holderSnapshot;
  const holders = snap?.holders || [];
  const q = els.holderSearch?.value.trim().toLowerCase() || "";

  SET("roundCap", snap?.roundCap?.toLocaleString?.() || "5");
  SET("holderCutoff", snap?.cutoffScore?.toLocaleString?.() || "—");
  SET("eligibleShown", String(snap?.eligibleCount ?? 0));
  SET("snapshotAge", snap?.updatedAt ? new Date(snap.updatedAt).toLocaleTimeString() : "pre-snapshot");

  if (els.holderSource) {
    if (snap?.reason === "no_snapshot_yet") {
      els.holderSource.textContent = "Awaiting first snapshot";
      els.holderSource.classList.add("fallback");
    } else if (snap?.degraded) {
      els.holderSource.textContent = snap.message || "Cached snapshot";
      els.holderSource.classList.add("fallback");
    } else {
      els.holderSource.textContent = snap?.sourceLabel || "Live snapshot";
      els.holderSource.classList.remove("fallback");
    }
  }

  if (!els.holderTable) return;
  const visible = holders.filter((h) => !q || holderSearchText(h).includes(q));
  els.holderTable.innerHTML = `
    <div class="holder-row header">
      <span>Rank</span><span>Wallet · balance</span><span>Est. epoch NVDAx</span>
    </div>
    ${visible.length
      ? visible.map((h) => {
        const wallet = h.wallet || h.address || "";
        const chips = [`Bal ${h.balanceLabel || "—"}`, `Share ${h.score || "—"}`]
          .map((c) => `<span class="holder-chip">${escapeHtml(c)}</span>`).join("");
        return `
          <div class="holder-row">
            <span class="holder-rank">${h.rank ? `#${h.rank}` : "—"}</span>
            <span class="holder-main">
              <strong class="holder-wallet">${escapeHtml(shortAddress(wallet))}</strong>
              <span class="holder-details">${chips}</span>
            </span>
            <strong class="holder-amount">${escapeHtml(h.projected_reward || "—")}<span>this epoch</span></strong>
          </div>`;
      }).join("")
      : `<div class="holder-empty">First snapshot begins when the first reward epoch closes. Pre-launch holders are not indexed yet.</div>`
    }`;
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "$—";
  if (value >= 1000) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString(undefined, { minimumSignificantDigits: 2, maximumSignificantDigits: 3 })}`;
}

function renderMarketTicker(data) {
  document.querySelectorAll(".ticker-item").forEach((item) => {
    const d = data[item.dataset.symbol] || marketFallback[item.dataset.symbol];
    const change = Number(d?.usd_24h_change);
    const priceEl = item.querySelector(".price");
    const changeEl = item.querySelector(".change");
    if (priceEl) priceEl.textContent = formatUsd(Number(d?.usd));
    if (changeEl) {
      if (Number.isFinite(change)) {
        changeEl.textContent = `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;
        changeEl.className = `change ${change >= 0 ? "up" : "down"}`;
      } else {
        changeEl.textContent = "live";
        changeEl.className = "change up";
      }
    }
  });
}

async function updateMarketTicker() {
  const ids = Object.keys(marketFallback).join(",");
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`, { cache: "no-store" });
    if (!r.ok) throw new Error();
    renderMarketTicker(await r.json());
  } catch {
    renderMarketTicker(marketFallback);
  }
}

function renderReceipts() {
  if (!els.receiptsGrid) return;
  els.receiptsGrid.querySelectorAll(".receipt").forEach((n) => n.remove());

  const receipts = [];
  const operationReceipts = Array.isArray(state.operations?.receipts) ? state.operations.receipts : [];
  state.rewardReceipts.forEach((r) =>
    receipts.push({
      status: r.status,
      time: r.created_at ? new Date(r.created_at).toLocaleString() : "",
      signature: r.signature,
      label: r.amount_ui ? `${r.amount_ui} NVDAx` : "NVDAx receipt"
    })
  );
  operationReceipts.forEach((r) =>
    receipts.push({
      status: r.status || "recorded",
      time: r.createdAt || r.updatedAt ? new Date(r.createdAt || r.updatedAt).toLocaleString() : "",
      signature: r.signature || r.txSignature,
      label: r.type || r.receiptType || "Stored proof"
    })
  );
  state.feeReceipts.forEach((r) =>
    receipts.push({
      status: r.status,
      time: r.blockTime ? new Date(r.blockTime * 1000).toLocaleString() : r.slot ? `Slot ${r.slot}` : "",
      signature: r.signature,
      label: "Fee receipt"
    })
  );

  if (!receipts.length) {
    if (els.receiptEmpty) els.receiptEmpty.style.display = "grid";
    return;
  }
  if (els.receiptEmpty) els.receiptEmpty.style.display = "none";
  receipts.slice(0, 8).forEach((r) => {
    const card = document.createElement("article");
    card.className = "receipt";
    const link = r.signature
      ? `<a class="tx-link" href="${escapeHtml(solscanTx(r.signature))}" target="_blank" rel="noreferrer">TX ${shortAddress(r.signature)}</a>`
      : `<span>${escapeHtml(r.label || "Stored proof")}</span>`;
    card.innerHTML = `<b>${escapeHtml(r.status || "recorded")}</b><span>${escapeHtml(r.time || "")}</span>${link}`;
    els.receiptsGrid.appendChild(card);
  });
}

async function loadConfig() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    state.config = await r.json();
  } catch { state.config = {}; }
  state.configSyncedAtMs = Date.now();
  if (els.feeStatus) els.feeStatus.textContent = state.config.feeWallet ? "Ready" : "Pending";
  if (els.swapStatus) els.swapStatus.textContent = state.config.distributorWallet ? "Ready" : "Pending";
  if (els.holderStatus) els.holderStatus.textContent = state.config.holderIndexerUrlConfigured ? "Indexer" : "RPC";
  if (els.batch) els.batch.textContent = "Queued";
  renderShell();
}

async function loadRewardsStatus() {
  try {
    const r = await fetch("/api/rewards/status", { cache: "no-store" });
    if (!r.ok) return;
    state.rewardsStatus = await r.json();
    const s = state.rewardsStatus;
    state.wbtcPoolBalance = Number(s.total_wbtc_pool || 0);
    const poolLabel = s.total_wbtc_pool && s.total_wbtc_pool !== "0" ? s.total_wbtc_pool : "0.00";
    if (els.pool) els.pool.textContent = poolLabel;
    if (els.poolCardBalance) els.poolCardBalance.innerHTML = `${escapeHtml(poolLabel)} <em>NVDAx</em>`;
    if (els.poolUsd) els.poolUsd.textContent = "$0.00";
    const meterPercent = Math.max(0, Math.min(100, (Number(state.wbtcPoolBalance || 0) / 50) * 100));
    if (els.poolMeter) els.poolMeter.style.width = `${meterPercent}%`;
    if (els.poolMeterLabel) els.poolMeterLabel.textContent = `${Math.round(meterPercent)}%`;
    if (els.creatorFees) els.creatorFees.textContent = s.creator_fees_collected || "$0";
  } catch {}
}
async function loadHolderSnapshot() {
  try {
    const params = new URLSearchParams();
    const walletQuery = els.holderSearch?.value.trim();
    if (walletQuery) params.set("wallet", walletQuery);
    const r = await fetch(`/api/rewards/holders?${params}`, { cache: "no-store" });
    if (!r.ok) return;
    state.holderSnapshot = await r.json();
    renderHolderViews();
  } catch {}
}
async function loadFeeReceipts() {
  try {
    const r = await fetch("/api/fee-receipts", { cache: "no-store" });
    if (!r.ok) return;
    const body = await r.json();
    state.feeReceipts = body.receipts || [];
    const latest = state.feeReceipts[0];
    const latestLabel = latest?.blockTime ? new Date(latest.blockTime * 1000).toLocaleTimeString() : latest?.slot ? `slot ${latest.slot}` : "";
    if (els.lastReceipt) els.lastReceipt.textContent = latestLabel || "no receipts yet";
    if (els.poolLastReceipt) els.poolLastReceipt.textContent = latestLabel || "never";
  } catch {}
}
async function loadRewardReceipts() {
  try {
    const r = await fetch("/api/rewards/receipts", { cache: "no-store" });
    if (!r.ok) return;
    const b = await r.json();
    state.rewardReceipts = b.receipts || [];
  } catch {}
}
async function loadOperationsSummary() {
  try {
    const r = await fetch("/api/operations", { cache: "no-store" });
    state.operations = await r.json();
    const automation = state.operations?.automation;
    if (automation?.active && els.batch) els.batch.textContent = "Armed";
    if (state.operations?.latestBatch?.status && els.batch) els.batch.textContent = state.operations.latestBatch.status;
  } catch {}
}
async function loadChainData() {
  if (!state.config) await loadConfig();
  await Promise.allSettled([
    loadRewardsStatus(),
    loadHolderSnapshot(),
    loadFeeReceipts(),
    loadRewardReceipts(),
    loadOperationsSummary(),
  ]);
  renderReceipts();
}

// ---- Mobile menu ----
function closeMobileMenu() {
  els.topBar?.classList.remove("menu-open");
  els.menuToggle?.setAttribute("aria-expanded", "false");
}
function toggleMobileMenu() {
  const open = els.topBar?.classList.toggle("menu-open");
  els.menuToggle?.setAttribute("aria-expanded", String(open));
}
els.menuToggle?.addEventListener("click", toggleMobileMenu);
els.primaryNav?.addEventListener("click", (e) => { if (e.target.closest("a")) closeMobileMenu(); });
document.addEventListener("click", (e) => {
  if (!els.topBar?.classList.contains("menu-open")) return;
  if (els.topBar.contains(e.target)) return;
  closeMobileMenu();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMobileMenu(); });

// ---- Contract copy ----
els.copyContract?.addEventListener("click", async () => {
  const ca = state.config?.contractAddress || "";
  if (!ca) return;
  try {
    await navigator.clipboard.writeText(ca);
    els.copyContract.classList.add("copied");
    const val = els.copyContract.querySelector(".ca-value");
    if (val) val.textContent = "copied";
    setTimeout(() => {
      els.copyContract.classList.remove("copied");
      if (val) val.textContent = shortAddress(ca);
    }, 1400);
  } catch {}
});

// ---- Refresh ----
els.refreshData?.addEventListener("click", loadChainData);

// ---- Holder search ----
let searchTimer;
els.holderSearch?.addEventListener("input", () => {
  renderHolderViews();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadHolderSnapshot, 350);
});

// ---- Ticker setup: duplicate set for smooth loop ----
if (els.tickerTrack?.firstElementChild) {
  els.tickerTrack.appendChild(els.tickerTrack.firstElementChild.cloneNode(true));
}

// ---- Brand strip: duplicate set for smooth marquee loop ----
{
  const track = document.querySelector(".brand-strip-track");
  const set = track?.querySelector(".brand-strip-set");
  if (track && set) track.appendChild(set.cloneNode(true));
}

// ---- Boot ----
renderShell();
renderTicket(null);
renderDrawStats(null);
renderHolderBoard();
renderMarketTicker(marketFallback);
loadConfig().then(loadChainData);
updateMarketTicker();
setInterval(updateMarketTicker, 60_000);
setInterval(loadChainData, 30_000);
setInterval(syncCountdown, 1000);
