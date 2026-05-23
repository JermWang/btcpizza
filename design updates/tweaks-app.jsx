/* global React, ReactDOM, TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakColor, useTweaks */

const JENSEN_TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accentHex": "#76FF03",
  "background": "grid",
  "density": "comfy",
  "showJensen": true,
  "showTicker": true,
  "scanlines": true,
  "animateCoin": true
}/*EDITMODE-END*/;

const HEX_TO_ACCENT = { "#76FF03": "green", "#00E5FF": "cyan", "#FFB627": "amber" };

function JensenTweaks() {
  const [t, setTweak] = useTweaks(JENSEN_TWEAK_DEFAULTS);

  // Apply to <body> as data-attrs and toggle visibility
  React.useEffect(() => {
    const b = document.body;
    b.setAttribute("data-accent", HEX_TO_ACCENT[t.accentHex] || "green");
    b.setAttribute("data-bg", t.background);
    b.setAttribute("data-density", t.density);
    b.setAttribute("data-jensen", t.showJensen ? "shown" : "hidden");

    const ticker = document.querySelector(".market-ticker");
    if (ticker) ticker.style.display = t.showTicker ? "" : "none";

    const scan = document.querySelector(".atmosphere-scan");
    if (scan) scan.style.opacity = t.scanlines ? "" : "0";

    const coin = document.querySelector(".hero-jensen-coin");
    if (coin) coin.style.animationPlayState = t.animateCoin ? "running" : "paused";
  }, [t]);

  return (
    <TweaksPanel title="Jensen Tweaks">
      <TweakSection label="Theme" />
      <TweakColor
        label="Accent"
        value={t.accentHex}
        options={["#76FF03", "#00E5FF", "#FFB627"]}
        onChange={(v) => setTweak("accentHex", v)}
      />
      <TweakRadio
        label="Background"
        value={t.background}
        options={["grid", "dots", "solid"]}
        onChange={(v) => setTweak("background", v)}
      />
      <TweakRadio
        label="Density"
        value={t.density}
        options={["comfy", "dense"]}
        onChange={(v) => setTweak("density", v)}
      />

      <TweakSection label="Layout" />
      <TweakToggle
        label="Show Jensen avatar"
        value={t.showJensen}
        onChange={(v) => setTweak("showJensen", v)}
      />
      <TweakToggle
        label="Show market ticker"
        value={t.showTicker}
        onChange={(v) => setTweak("showTicker", v)}
      />
      <TweakToggle
        label="Scanlines"
        value={t.scanlines}
        onChange={(v) => setTweak("scanlines", v)}
      />
      <TweakToggle
        label="Animate floating coin"
        value={t.animateCoin}
        onChange={(v) => setTweak("animateCoin", v)}
      />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("tweaks-root")).render(<JensenTweaks />);
