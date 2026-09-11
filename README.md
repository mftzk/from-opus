# from-opus

An ambient WebGPU scene — curl-noise particle flow, accumulation trails, and a
soft bloom. Meant to be left running: slow motion, dark palettes, no flashing.

## Run locally

```
node server.js       # http://localhost:3000
```

Needs a browser with WebGPU (Chrome/Edge 113+, Safari 18+). Browsers without it
get a short message instead of the scene.

## Controls

Panel top-right; `H` or the small dot toggles it. Flow speed, glow, trail
length, interaction strength, density, and five palettes (deep ocean, purple
nebula, sunset amber, emerald aurora, monochrome blue). Settings persist in
`localStorage`.

Move the pointer to bend the flow; click for a ripple.

## Structure

- `public/main.js` — device setup, pipelines, uniforms, input, UI
- `public/shaders/simulate.wgsl` — compute pass, curl-noise advection
- `public/shaders/render.wgsl` — additive particle splats
- `public/shaders/fade.wgsl` — trail decay
- `public/shaders/post.wgsl` — bloom blur and final composite
- `server.js` — dependency-free static server (`PORT` from env)
