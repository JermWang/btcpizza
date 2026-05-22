const DEFAULT_BASE_INTERVAL_SECONDS = 180;
const DEFAULT_INTERVAL_MULTIPLIER = 2;
const DEFAULT_BASE_HOLDER_CAP = 5;
const DEFAULT_HOLDER_CAP_MULTIPLIER = 2;
const DEFAULT_PREVIEW_EPOCHS = 12;
const DEFAULT_DISTRIBUTION_STARTED_AT = "2026-05-22T15:29:25.000Z";

function numberFromEnv(env, keys, fallback) {
  for (const key of keys) {
    const value = Number(env[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

function parseStartedAt(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedPower(base, multiplier, exponent) {
  const value = base * multiplier ** exponent;
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return value;
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(1, Math.round(seconds));
  const days = Math.floor(safeSeconds / 86_400);
  const hours = Math.floor((safeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const secs = safeSeconds % 60;

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  return `${secs}s`;
}

function buildDistributionPolicy(env = process.env) {
  const baseHolderCap = Math.max(
    1,
    Math.floor(
      numberFromEnv(env, ["PUBLIC_DISTRIBUTION_BASE_HOLDER_CAP", "DISTRIBUTION_BASE_HOLDER_CAP", "HOLDER_ROUND_CAP"], DEFAULT_BASE_HOLDER_CAP)
    )
  );

  return {
    mode: env.PUBLIC_DISTRIBUTION_MODE || env.DISTRIBUTION_MODE || "exponential",
    startedAt: env.PUBLIC_DISTRIBUTION_STARTED_AT || env.DISTRIBUTION_STARTED_AT || DEFAULT_DISTRIBUTION_STARTED_AT,
    baseIntervalSeconds: numberFromEnv(
      env,
      ["PUBLIC_DISTRIBUTION_BASE_INTERVAL_SECONDS", "DISTRIBUTION_BASE_INTERVAL_SECONDS"],
      DEFAULT_BASE_INTERVAL_SECONDS
    ),
    intervalMultiplier: numberFromEnv(
      env,
      ["PUBLIC_DISTRIBUTION_INTERVAL_MULTIPLIER", "DISTRIBUTION_INTERVAL_MULTIPLIER"],
      DEFAULT_INTERVAL_MULTIPLIER
    ),
    baseHolderCap,
    holderCapMultiplier: numberFromEnv(
      env,
      ["PUBLIC_DISTRIBUTION_HOLDER_CAP_MULTIPLIER", "DISTRIBUTION_HOLDER_CAP_MULTIPLIER"],
      DEFAULT_HOLDER_CAP_MULTIPLIER
    ),
    previewEpochs: Math.max(
      1,
      Math.floor(numberFromEnv(env, ["PUBLIC_DISTRIBUTION_PREVIEW_EPOCHS", "DISTRIBUTION_PREVIEW_EPOCHS"], DEFAULT_PREVIEW_EPOCHS))
    )
  };
}

function epochStep(policy, epochIndex) {
  const safeIndex = Math.max(0, Math.floor(epochIndex));
  const seconds = Math.max(1, Math.round(boundedPower(policy.baseIntervalSeconds, policy.intervalMultiplier, safeIndex)));
  const holderCap = Math.max(1, Math.floor(boundedPower(policy.baseHolderCap, policy.holderCapMultiplier, safeIndex)));
  return {
    epochIndex: safeIndex,
    seconds,
    label: formatDuration(seconds),
    holderCap
  };
}

function distributionPreview(policy = buildDistributionPolicy()) {
  return Array.from({ length: policy.previewEpochs }, (_, index) => epochStep(policy, index));
}

function currentDistributionEpoch(policy = buildDistributionPolicy(), nowMs = Date.now()) {
  const startMs = parseStartedAt(policy.startedAt);
  const elapsedTotal = startMs ? Math.max(0, Math.floor((nowMs - startMs) / 1000)) : 0;
  let elapsed = elapsedTotal;
  let epochIndex = 0;
  let consumedSeconds = 0;

  while (epochIndex < 256) {
    const step = epochStep(policy, epochIndex);
    if (elapsed < step.seconds) {
      return {
        ...step,
        elapsedSeconds: elapsed,
        remainingSeconds: step.seconds - elapsed,
        progress: elapsed / step.seconds,
        nextAt: startMs ? new Date(startMs + (consumedSeconds + step.seconds) * 1000).toISOString() : ""
      };
    }
    elapsed -= step.seconds;
    consumedSeconds += step.seconds;
    epochIndex += 1;
  }

  const step = epochStep(policy, epochIndex);
  return {
    ...step,
    elapsedSeconds: 0,
    remainingSeconds: step.seconds,
    progress: 0,
    nextAt: startMs ? new Date(startMs + (consumedSeconds + step.seconds) * 1000).toISOString() : ""
  };
}

module.exports = {
  DEFAULT_DISTRIBUTION_STARTED_AT,
  buildDistributionPolicy,
  currentDistributionEpoch,
  distributionPreview,
  epochStep,
  formatDuration
};
