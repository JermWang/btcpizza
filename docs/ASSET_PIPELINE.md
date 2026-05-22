# 3D Asset Pipeline

## Goal

Create tailored high-end 3D graphics for the Bitcoin Pizza Strategy dashboard while keeping the important visuals editable and data-driven.

## Recommended Pipeline

Use two layers:

1. GPT Image 2 / image generation for art direction, hero renders, style exploration, and polished raster assets.
2. Blender or code-driven 3D for reusable, editable objects whose state must reflect live protocol data.

This avoids locking critical dashboard states into static images.

## Asset Categories

### Hero Pizza Render

Purpose:

- First-viewport brand signal.
- High-end 3D pizza/BTC object.
- Can be mostly raster because it is decorative and brand-led.

Deliverables:

- Transparent PNG/WebP hero pizza.
- Dark-background version.
- Cropped social/share version.
- Optional layered source prompt and reference images.

### Data-Driven Pizza Pool

Purpose:

- Visually show how many pizza slices are in the reward pool.
- Reflect live airdrop epochs, remaining pool, distributed WBTC, and rolled-over dust.

This should not be a single static AI image. Build it as an editable 3D or SVG/canvas component.

Recommended implementation:

- Blender creates the master pizza geometry and materials.
- Export GLB slices or slice meshes.
- Website uses Three.js / React Three Fiber to show slice count, fill state, glow, and hover details.

Live states:

- Full slice: allocated and ready.
- Glowing slice: current epoch.
- Dim slice: future interval.
- Missing slice: already distributed.
- Sauce edge pulse: new fees detected.

### Receipt Icons

Purpose:

- Small visual language for fee intake, swap, manifest, batch, WBTC transfer, failed transfer.

Recommended implementation:

- Generate style references with image generation.
- Rebuild final icons as clean SVGs for crisp UI use.

### Marketing / Social Assets

Purpose:

- Share cards, announcement images, launch graphics.

Recommended implementation:

- GPT Image 2 raster assets are appropriate here because these do not need to be live-data editable.

## Prompt Template

```text
Create a premium 3D Blender-style render for a futuristic Bitcoin Pizza Strategy Solana dashboard.

Subject:
A circular pizza pie designed like a live crypto reward pool. The pizza is divided into [N] clean slices. Each slice is slightly separated with beveled crust edges, glossy melted cheese, pepperoni details, and subtle Bitcoin coin embossing. One slice glows with Solana mint light to indicate the active airdrop epoch. A small wrapped-BTC coin hovers above the pie.

Style:
High-end Blender product render, dark futuristic dashboard lighting, warm BTC gold and cheese tones, sauce red accents, subtle Solana mint/cyan glow, professional fintech polish, not cartoonish, not messy, not stock-like.

Composition:
Transparent background, centered object, three-quarter top-down camera, soft studio shadows, clean edges for web compositing.

Constraints:
No readable text inside the image. No random logos. No hands or people. No cluttered background. Object must be easy to mask and layer into a web UI.
```

## Editable Pizza Pool Spec

Data fields:

```text
total_slices
active_slice_index
distributed_slices
pending_slices
wbtc_pool_amount
current_epoch_amount
next_airdrop_at
```

Component behavior:

- Slice count is configurable.
- Active slice pulses.
- Hovering a slice shows epoch, interval, WBTC amount, and transaction status.
- Completed slices collapse slightly or show a confirmed edge mark.
- New fee intake increases the pool fill without refresh.

## File Targets

Suggested future repo structure:

```text
apps/web/public/assets/
  hero-pizza.webp
  hero-pizza-transparent.png
  social-card.png

apps/web/src/components/visuals/
  PizzaPool3D.tsx
  PizzaPoolLegend.tsx
  ReceiptIcon.tsx

assets/blender/
  bitcoin-pizza-strategy-pool.blend
  exports/pizza-slice.glb
  exports/pizza-pool.glb
```

## Practical Recommendation

Use generated images for mood and hero polish first. For the actual live pool graphic, build a reusable 3D component from Blender-exported slices so the site can show real slice counts and live WBTC pool states without regenerating images.
