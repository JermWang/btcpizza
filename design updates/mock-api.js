// mock-api.js — intercept /api/* fetches so the page renders cleanly in static preview.
// Returns "pre-launch" state shape that the original app.js scaffold expects.
(function () {
  const realFetch = window.fetch.bind(window);
  const pre = {
    "/api/config": {
      contractAddress: "",
      feeWallet: "",
      distributorWallet: "",
      holderIndexerUrlConfigured: false,
      distributionScheduleSeconds: [180, 360, 720, 1440, 2880, 5760],
      distributionScheduleLabels: ["3m", "6m", "12m", "24m", "48m", "96m"],
      distributionHolderCaps: [5, 10, 20, 40, 80, 160],
      distributionBaseIntervalSeconds: 180,
      distributionIntervalMultiplier: 2,
      distributionBaseHolderCap: 5,
      distributionHolderCapMultiplier: 2,
      distributionPreviewEpochs: 4,
      solscanBaseUrl: "https://solscan.io",
      coingeckoApiUrl: "https://api.coingecko.com/api/v3",
    },
    "/api/rewards/status": {
      total_nvdax_pool: "0",
      creator_fees_collected: "$0",
      current_epoch: null,
    },
    "/api/rewards/holders": {
      holders: [],
      eligibleCount: 0,
      roundCap: 5,
      cutoffScore: null,
      sourceLabel: "Awaiting first snapshot",
      configured: false,
      reason: "no_snapshot_yet",
      updatedAt: null,
    },
    "/api/rewards/receipts": { receipts: [] },
    "/api/operations": {
      automation: { active: false, status: "armed", nextEpochIndex: 0 },
      latestBatch: null,
      latestManifest: null,
      latestSnapshot: null,
      latestEpoch: null,
      receipts: [],
    },
  };

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    // Match any /api/* path
    for (const key of Object.keys(pre)) {
      if (url === key || url.startsWith(key + "?")) {
        return Promise.resolve(
          new Response(JSON.stringify(pre[key]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
    }
    // Allow Coingecko + everything else through as normal
    return realFetch(input, init);
  };
})();
