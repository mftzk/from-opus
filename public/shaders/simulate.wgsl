// Particle advection through a curl-noise flow field.
// Divergence-free by construction, so the motion swirls like ink in water
// instead of collapsing into sinks or blowing apart.

struct Particle {
  pos  : vec2f,
  vel  : vec2f,
  seed : f32,
  age  : f32,
  life : f32,
  pad  : f32,
};

struct Params {
  resolution  : vec2f,
  mouse       : vec2f,
  mouseVel    : vec2f,
  time        : f32,
  dt          : f32,
  flowSpeed   : f32,
  interaction : f32,
  trail       : f32,
  glow        : f32,
  count       : f32,
  paletteMix  : f32,
  ripples     : array<vec4f, 8>, // xy = centre, z = start time, w = strength
};

@group(0) @binding(0) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(1) var<uniform> params : Params;

fn hash21(p: vec2f) -> f32 {
  var h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2f, t: f32) -> f32 {
  var v = 0.0;
  var amp = 0.55;
  var q = p;
  for (var i = 0; i < 3; i = i + 1) {
    let drift = vec2f(t * 0.045 * f32(i + 1), -t * 0.032 * f32(i + 1));
    v = v + amp * vnoise(q + drift);
    q = q * 2.07 + vec2f(11.3, 7.7);
    amp = amp * 0.5;
  }
  return v;
}

fn curl(p: vec2f, t: f32) -> vec2f {
  let e = 0.045;
  let dx = fbm(p + vec2f(e, 0.0), t) - fbm(p - vec2f(e, 0.0), t);
  let dy = fbm(p + vec2f(0.0, e), t) - fbm(p - vec2f(0.0, e), t);
  return vec2f(dy, -dx) / (2.0 * e);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= u32(params.count)) { return; }

  var p = particles[idx];
  let dt = params.dt;
  let aspect = params.resolution.x / max(params.resolution.y, 1.0);

  // Each particle belongs to a depth layer: far layers ride a finer, slower
  // field, near layers a broader, faster one. That parallax is most of the
  // sense of volume in the scene.
  // Three discrete layers, not a continuum: within a layer every particle
  // rides the same field, so each layer keeps clean, coherent streamlines.
  let depth = floor(fract(p.seed * 5.17) * 3.0) * 0.5;
  let scale = mix(1.9, 3.6, depth);
  let pace = mix(1.2, 0.72, depth);

  // Noise is sampled in aspect-corrected space so the swirls stay round.
  let np = vec2f(p.pos.x * aspect, p.pos.y) * scale;
  // Soft-normalised so the field's direction leads and its raw magnitude,
  // which swings a lot between octaves, only modulates.
  let cv = curl(np, params.time);
  var force = (cv / (length(cv) + 0.8)) * 0.17 * params.flowSpeed * pace;

  // A second, much larger and slower field gives the whole scene a tidal drift.
  let tv = curl(np * 0.32 + vec2f(3.7, 1.9), params.time * 0.45);
  force = force + (tv / (length(tv) + 0.8)) * 0.05 * params.flowSpeed * pace;

  // Pointer bends the field: a tangential swirl plus a little of the pointer's
  // own velocity. Never a hard push -- the falloff is a wide gaussian.
  let toM = (params.mouse - p.pos) * vec2f(aspect, 1.0);
  let dm = length(toM);
  let infl = exp(-(dm * dm) / 0.045) * params.interaction;
  if (infl > 0.0005) {
    let tangent = vec2f(-toM.y, toM.x) / max(dm, 0.0001);
    force = force + tangent * 0.14 * infl;
    force = force + params.mouseVel * 1.6 * infl;
  }

  // Click ripples: an expanding, decaying ring of outward pressure.
  for (var i = 0; i < 8; i = i + 1) {
    let r = params.ripples[i];
    if (r.w <= 0.0) { continue; }
    let age = params.time - r.z;
    if (age < 0.0 || age > 3.2) { continue; }
    let d = (p.pos - r.xy) * vec2f(aspect, 1.0);
    let dist = length(d);
    let radius = age * 0.30;
    let band = exp(-pow(dist - radius, 2.0) / 0.0016);
    let decay = exp(-age * 1.0);
    force = force + (d / max(dist, 0.0001)) * band * decay * r.w * 0.55;
  }

  // Heavy damping keeps everything slow and fluid; particles glide, never dart.
  p.vel = p.vel * exp(-dt * 1.6) + force * dt;
  let sp = length(p.vel);
  let maxSp = 0.42;
  if (sp > maxSp) { p.vel = p.vel * (maxSp / sp); }

  p.pos = p.pos + p.vel * dt;

  // Wrap so the field never looks like it has walls.
  p.pos = fract(p.pos + vec2f(1.0, 1.0));

  // A slow, very large-scale mask carves the field into luminous clouds and
  // near-empty voids -- this is what gives the scene depth instead of an even
  // carpet of light. Stored here so the vertex stage does not resample noise.
  let m = fbm(np * 0.95 + vec2f(19.1, 4.3), params.time * 0.28);
  p.pad = smoothstep(0.28, 0.66, m);

  p.age = p.age + dt;
  if (p.age > p.life) {
    let s = p.seed + params.time * 0.017;
    p.pos = vec2f(hash21(vec2f(s, s * 1.7)), hash21(vec2f(s * 2.3, s * 0.7)));
    p.vel = vec2f(0.0, 0.0);
    p.age = 0.0;
    p.life = 6.0 + hash21(vec2f(s * 3.1, s)) * 12.0;
    p.pad = 0.0;
  }

  particles[idx] = p;
}
