import { PALETTES } from './palettes.js';

const PARTICLE_FLOATS = 8;          // pos2, vel2, seed, age, life, pad
const PARAM_FLOATS = 48;            // see Params in the shaders
const MAX_RIPPLES = 8;
const DENSITY_MIN = 25000;
const DENSITY_MAX = 260000;

const DEFAULTS = {
  flow: 0.55,
  glow: 0.55,
  trail: 0.45,
  interaction: 0.5,
  density: 0.5,
  palette: 'deep-ocean',
};

const state = loadState();

// ---------------------------------------------------------------- utilities

function loadState() {
  try {
    const raw = localStorage.getItem('from-opus');
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) { /* storage may be unavailable; defaults are fine */ }
  return { ...DEFAULTS };
}

function saveState() {
  try { localStorage.setItem('from-opus', JSON.stringify(state)); } catch (_) {}
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function paletteById(id) {
  return PALETTES.find((p) => p.id === id) || PALETTES[0];
}

function fail(message) {
  const el = document.getElementById('unsupported');
  el.querySelector('p').textContent = message;
  el.classList.add('visible');
}

async function loadShader(name) {
  const res = await fetch(`shaders/${name}.wgsl`);
  if (!res.ok) throw new Error(`cannot load ${name}.wgsl`);
  return res.text();
}

// ------------------------------------------------------------------- setup

async function main() {
  if (!navigator.gpu) {
    fail('This scene needs WebGPU. Try the latest Chrome, Edge, or Safari 18+.');
    return;
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    fail('No GPU adapter available for WebGPU on this machine.');
    return;
  }
  const device = await adapter.requestDevice();
  device.lost.then((info) => {
    if (info.reason !== 'destroyed') fail('The GPU connection was lost. Reload to start again.');
  });

  const canvas = document.getElementById('scene');
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const [simSrc, renderSrc, fadeSrc, postSrc] = await Promise.all(
    ['simulate', 'render', 'fade', 'post'].map(loadShader),
  );
  const simModule = device.createShaderModule({ code: simSrc });
  const renderModule = device.createShaderModule({ code: renderSrc });
  const fadeModule = device.createShaderModule({ code: fadeSrc });
  const postModule = device.createShaderModule({ code: postSrc });

  const TRAIL_FORMAT = 'rgba16float';

  const simPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: simModule, entryPoint: 'main' },
  });

  const particlePipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: renderModule, entryPoint: 'partVS' },
    fragment: {
      module: renderModule,
      entryPoint: 'partFS',
      targets: [{
        format: TRAIL_FORMAT,
        blend: {
          color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const fadePipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: fadeModule, entryPoint: 'fadeVS' },
    fragment: { module: fadeModule, entryPoint: 'fadeFS', targets: [{ format: TRAIL_FORMAT }] },
    primitive: { topology: 'triangle-list' },
  });

  const blurPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: postModule, entryPoint: 'vsFull' },
    fragment: { module: postModule, entryPoint: 'fsBlur', targets: [{ format: TRAIL_FORMAT }] },
    primitive: { topology: 'triangle-list' },
  });

  const compositePipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: postModule, entryPoint: 'vsFull' },
    fragment: { module: postModule, entryPoint: 'fsComposite', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  // -------------------------------------------------------------- buffers

  const paramData = new Float32Array(PARAM_FLOATS);
  const paramBuffer = device.createBuffer({
    size: paramData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const paletteData = new Float32Array(40); // 5 from + 5 to, vec4 each
  const paletteBuffer = device.createBuffer({
    size: paletteData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const makePostBuffer = () => device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const postH = makePostBuffer();
  const postV = makePostBuffer();
  const postC = makePostBuffer();
  const postData = new Float32Array(16);

  let particleBuffer = null;
  let particleCount = 0;
  let simBindGroup = null;
  let particleBindGroup = null;

  function rebuildParticles() {
    const count = Math.round(lerp(DENSITY_MIN, DENSITY_MAX, clamp01(state.density)));
    if (count === particleCount && particleBuffer) return;
    particleCount = count;

    const data = new Float32Array(count * PARTICLE_FLOATS);
    for (let i = 0; i < count; i++) {
      const o = i * PARTICLE_FLOATS;
      data[o + 0] = Math.random();
      data[o + 1] = Math.random();
      data[o + 2] = 0;
      data[o + 3] = 0;
      data[o + 4] = Math.random() * 1000;
      data[o + 5] = Math.random() * 10;          // stagger the first respawns
      data[o + 6] = 6 + Math.random() * 12;
      data[o + 7] = 0;
    }
    particleBuffer = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(particleBuffer, 0, data);

    simBindGroup = device.createBindGroup({
      layout: simPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: particleBuffer } },
        { binding: 1, resource: { buffer: paramBuffer } },
      ],
    });
    particleBindGroup = device.createBindGroup({
      layout: particlePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: particleBuffer } },
        { binding: 1, resource: { buffer: paramBuffer } },
        { binding: 2, resource: { buffer: paletteBuffer } },
      ],
    });
  }

  // ------------------------------------------------------- render targets

  let trail = [null, null];
  let bloom = [null, null];
  let fadeBind = [null, null];
  let blurBindH = [null, null];
  let blurBindV = null;
  let compositeBind = [null, null];
  let cur = 0;
  let width = 0;
  let height = 0;

  function makeTexture(w, h) {
    return device.createTexture({
      size: [w, h],
      format: TRAIL_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.floor(window.innerWidth * dpr));
    const h = Math.max(2, Math.floor(window.innerHeight * dpr));
    if (w === width && h === height) return;
    width = w; height = h;
    canvas.width = w;
    canvas.height = h;

    for (const t of [...trail, ...bloom]) if (t) t.destroy();
    trail = [makeTexture(w, h), makeTexture(w, h)];
    const bw = Math.max(2, w >> 1);
    const bh = Math.max(2, h >> 1);
    bloom = [makeTexture(bw, bh), makeTexture(bw, bh)];

    for (let i = 0; i < 2; i++) {
      const other = 1 - i;
      fadeBind[i] = device.createBindGroup({
        layout: fadePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: trail[other].createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: paramBuffer } },
        ],
      });
      blurBindH[i] = device.createBindGroup({
        layout: blurPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: trail[i].createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: postH } },
        ],
      });
      compositeBind[i] = device.createBindGroup({
        layout: compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: trail[i].createView() },
          { binding: 1, resource: sampler },
          { binding: 2, resource: { buffer: postC } },
          { binding: 3, resource: bloom[1].createView() },
        ],
      });
    }
    blurBindV = device.createBindGroup({
      layout: blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: bloom[0].createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: { buffer: postV } },
      ],
    });

    // Blur step sizes are in the source texture's own texel units.
    writePost(postH, [1 / w, 1 / h], [1, 0]);
    writePost(postV, [1 / bw, 1 / bh], [0, 1]);
  }

  function writePost(buffer, texel, dir, bgFrom, bgTo) {
    postData[0] = texel[0];
    postData[1] = texel[1];
    postData[2] = dir[0];
    postData[3] = dir[1];
    postData[4] = glowNow;
    postData[5] = time;
    postData[6] = paletteMix;
    postData[7] = 0;
    if (bgFrom) {
      postData[8] = bgFrom[0]; postData[9] = bgFrom[1]; postData[10] = bgFrom[2]; postData[11] = 1;
      postData[12] = bgTo[0]; postData[13] = bgTo[1]; postData[14] = bgTo[2]; postData[15] = 1;
    }
    device.queue.writeBuffer(buffer, 0, postData);
  }

  // Loop state, declared before anything that writes uniforms touches it.
  let time = 0;
  let last = performance.now();
  let glowNow = state.glow;
  let paletteSmooth = 1;
  let running = true;

  // --------------------------------------------------------------- input

  const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, vx: 0, vy: 0, active: false };
  const ripples = new Float32Array(MAX_RIPPLES * 4);
  let rippleSlot = 0;

  function setPointer(e) {
    pointer.tx = e.clientX / window.innerWidth;
    pointer.ty = e.clientY / window.innerHeight;
    pointer.active = true;
  }

  window.addEventListener('pointermove', setPointer, { passive: true });
  window.addEventListener('pointerleave', () => { pointer.active = false; });
  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#panel')) return;
    setPointer(e);
    const o = rippleSlot * 4;
    ripples[o + 0] = pointer.tx;
    ripples[o + 1] = pointer.ty;
    ripples[o + 2] = time;
    ripples[o + 3] = 0.6 + state.interaction * 1.1;
    rippleSlot = (rippleSlot + 1) % MAX_RIPPLES;
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  // ------------------------------------------------------------ palettes

  let palFrom = paletteById(state.palette);
  let palTo = palFrom;
  let paletteMix = 1;
  let bgFrom = palFrom.bg[0].slice();
  let bgTo = palFrom.bg[1].slice();

  function writePalette() {
    for (let i = 0; i < 5; i++) {
      const a = palFrom.stops[i];
      const b = palTo.stops[i];
      paletteData[i * 4 + 0] = a[0];
      paletteData[i * 4 + 1] = a[1];
      paletteData[i * 4 + 2] = a[2];
      paletteData[i * 4 + 3] = 1;
      paletteData[20 + i * 4 + 0] = b[0];
      paletteData[20 + i * 4 + 1] = b[1];
      paletteData[20 + i * 4 + 2] = b[2];
      paletteData[20 + i * 4 + 3] = 1;
    }
    device.queue.writeBuffer(paletteBuffer, 0, paletteData);
  }

  function setPalette(id) {
    const next = paletteById(id);
    if (next === palTo) return;
    // Snapshot whatever is on screen right now so a mid-transition switch
    // still crossfades from the visible colours instead of jumping back.
    const snapshot = {
      stops: palFrom.stops.map((s, i) => s.map((v, k) => lerp(v, palTo.stops[i][k], paletteMix))),
    };
    palFrom = snapshot;
    palTo = next;
    paletteMix = 0;
    state.palette = id;
    saveState();
    writePalette();
  }

  writePalette();

  // ------------------------------------------------------------ the loop

  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) { last = performance.now(); requestAnimationFrame(frame); }
  });

  function frame(now) {
    if (!running) return;
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.min(rawDt, 1 / 30);
    time += dt;

    // Smooth the pointer so a fast flick still bends the field gently.
    const px = pointer.x, py = pointer.y;
    const follow = 1 - Math.exp(-dt * 6.0);
    pointer.x = lerp(pointer.x, pointer.tx, follow);
    pointer.y = lerp(pointer.y, pointer.ty, follow);
    const inst = dt > 0 ? [(pointer.x - px) / dt, (pointer.y - py) / dt] : [0, 0];
    const velSmooth = 1 - Math.exp(-dt * 4.0);
    pointer.vx = lerp(pointer.vx, pointer.active ? inst[0] : 0, velSmooth);
    pointer.vy = lerp(pointer.vy, pointer.active ? inst[1] : 0, velSmooth);

    if (paletteMix < 1) {
      paletteMix = Math.min(1, paletteMix + dt / 1.2);
      const t = paletteMix * paletteMix * (3 - 2 * paletteMix);
      const target = palTo.bg;
      bgFrom = bgFrom.map((v, i) => lerp(v, target[0][i], Math.min(1, dt * 1.6)));
      bgTo = bgTo.map((v, i) => lerp(v, target[1][i], Math.min(1, dt * 1.6)));
      paletteSmooth = t;
    } else {
      paletteSmooth = 1;
    }

    glowNow = lerp(glowNow, state.glow, Math.min(1, dt * 4));

    // Params ------------------------------------------------------------
    paramData[0] = width;
    paramData[1] = height;
    paramData[2] = pointer.x;
    paramData[3] = pointer.y;
    paramData[4] = pointer.active ? pointer.vx : 0;
    paramData[5] = pointer.active ? pointer.vy : 0;
    paramData[6] = time;
    paramData[7] = dt;
    paramData[8] = lerp(0.35, 2.1, clamp01(state.flow));
    paramData[9] = pointer.active ? lerp(0, 1.8, clamp01(state.interaction)) : 0;
    paramData[10] = lerp(0.12, 2.6, clamp01(state.trail));
    paramData[11] = lerp(0.25, 2.2, clamp01(glowNow));
    paramData[12] = particleCount;
    paramData[13] = paletteSmooth;
    paramData.set(ripples, 16);
    device.queue.writeBuffer(paramBuffer, 0, paramData);

    writePost(postH, [1 / width, 1 / height], [1, 0]);
    writePost(postV, [2 / width, 2 / height], [0, 1]);
    writePost(postC, [1 / width, 1 / height], [0, 0], bgFrom, bgTo);

    cur = 1 - cur;

    const enc = device.createCommandEncoder();

    const comp = enc.beginComputePass();
    comp.setPipeline(simPipeline);
    comp.setBindGroup(0, simBindGroup);
    comp.dispatchWorkgroups(Math.ceil(particleCount / 64));
    comp.end();

    const trailPass = enc.beginRenderPass({
      colorAttachments: [{
        view: trail[cur].createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    trailPass.setPipeline(fadePipeline);
    trailPass.setBindGroup(0, fadeBind[cur]); // samples trail[prev]
    trailPass.draw(6);
    trailPass.setPipeline(particlePipeline);
    trailPass.setBindGroup(0, particleBindGroup);
    trailPass.draw(6, particleCount);
    trailPass.end();

    const blurH = enc.beginRenderPass({
      colorAttachments: [{
        view: bloom[0].createView(), loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    blurH.setPipeline(blurPipeline);
    blurH.setBindGroup(0, blurBindH[cur]);
    blurH.draw(6);
    blurH.end();

    const blurV = enc.beginRenderPass({
      colorAttachments: [{
        view: bloom[1].createView(), loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    blurV.setPipeline(blurPipeline);
    blurV.setBindGroup(0, blurBindV);
    blurV.draw(6);
    blurV.end();

    const out = enc.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    out.setPipeline(compositePipeline);
    out.setBindGroup(0, compositeBind[cur]);
    out.draw(6);
    out.end();

    device.queue.submit([enc.finish()]);
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ UI

  setupUI({ onDensity: rebuildParticles, onPalette: setPalette });

  resize();
  rebuildParticles();
  document.body.classList.add('ready');
  requestAnimationFrame(frame);
}

// --------------------------------------------------------------------- UI

function setupUI({ onDensity, onPalette }) {
  const panel = document.getElementById('panel');
  const toggle = document.getElementById('toggle');

  const sliders = {
    flow: document.getElementById('flow'),
    glow: document.getElementById('glow'),
    trail: document.getElementById('trail'),
    interaction: document.getElementById('interaction'),
    density: document.getElementById('density'),
  };

  let densityTimer = 0;
  for (const [key, el] of Object.entries(sliders)) {
    el.value = String(Math.round(state[key] * 100));
    el.addEventListener('input', () => {
      state[key] = Number(el.value) / 100;
      if (key === 'density') {
        clearTimeout(densityTimer);
        densityTimer = setTimeout(onDensity, 220);
      }
      saveState();
    });
  }

  const list = document.getElementById('palettes');
  for (const p of PALETTES) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.type = 'button';
    b.title = p.name;
    b.setAttribute('aria-label', p.name);
    b.style.background = `linear-gradient(120deg, ${p.stops.map(toCss).join(', ')})`;
    b.dataset.id = p.id;
    if (p.id === state.palette) b.classList.add('active');
    b.addEventListener('click', () => {
      onPalette(p.id);
      list.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === b));
    });
    list.appendChild(b);
  }

  let hidden = false;
  function setHidden(v) {
    hidden = v;
    document.body.classList.toggle('ui-hidden', hidden);
  }
  toggle.addEventListener('click', () => setHidden(!hidden));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') setHidden(!hidden);
  });

  // The panel dims itself when the pointer has been still for a while, so a
  // scene left running does not keep a bright box in the corner.
  let idleTimer = 0;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 3200);
  };
  window.addEventListener('pointermove', wake, { passive: true });
  window.addEventListener('keydown', wake);
  wake();
}

function toCss(c) {
  const to255 = (v) => Math.round(Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * 255);
  return `rgb(${to255(c[0])}, ${to255(c[1])}, ${to255(c[2])})`;
}

main().catch((err) => {
  console.error(err);
  fail('Something went wrong starting the scene. Reload to try again.');
});
