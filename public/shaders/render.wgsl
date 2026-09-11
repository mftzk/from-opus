// Two pipelines share this module:
//   fadeVS/fadeFS   -- carries the previous frame forward, dimmed (the trails)
//   partVS/partFS   -- additive soft splats for the particles themselves

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
  ripples     : array<vec4f, 8>,
};

struct Palette {
  // 5 stops for the outgoing palette, 5 for the incoming one.
  prev : array<vec4f, 5>,
  next : array<vec4f, 5>,
};

@group(0) @binding(0) var<storage, read> particles : array<Particle>;
@group(0) @binding(1) var<uniform> params : Params;
@group(0) @binding(2) var<uniform> pal : Palette;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv        : vec2f,
  @location(1) tint      : vec3f,
  @location(2) energy    : f32,
};

fn quadCorner(i: u32) -> vec2f {
  // two triangles, -1..1
  var c = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0),
  );
  return c[i];
}

fn sampleStops(stops: array<vec4f, 5>, t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0) * 4.0;
  let i = u32(floor(x));
  let f = fract(x);
  var s = stops;
  let a = s[min(i, 4u)].rgb;
  let b = s[min(i + 1u, 4u)].rgb;
  return mix(a, b, smoothstep(0.0, 1.0, f));
}

fn paletteColor(t: f32) -> vec3f {
  let a = sampleStops(pal.prev, t);
  let b = sampleStops(pal.next, t);
  return mix(a, b, clamp(params.paletteMix, 0.0, 1.0));
}

@vertex
fn partVS(@builtin(vertex_index) vi: u32,
          @builtin(instance_index) ii: u32) -> VSOut {
  let p = particles[ii];
  let corner = quadCorner(vi);

  let speed = length(p.vel);
  let lifeT = clamp(p.age / max(p.life, 0.001), 0.0, 1.0);
  // Fade in and out over the lifetime so nothing ever pops.
  let envelope = smoothstep(0.0, 0.16, lifeT) * (1.0 - smoothstep(0.72, 1.0, lifeT));

  // Faster filaments read brighter and further along the palette.
  let sn = clamp(speed * 9.0, 0.0, 1.0);
  let t = sn * 0.74 + fract(p.seed) * 0.26;

  // Slightly larger splats for slow particles: soft haze behind sharp streaks.
  // Same depth split as the compute pass: near layers are larger and brighter.
  let depth = floor(fract(p.seed * 5.17) * 3.0) * 0.5;
  let sizePx = mix(3.4, 1.35, sn) * mix(1.25, 0.7, depth) * (0.8 + fract(p.seed * 3.1) * 0.55);

  var out : VSOut;
  let ndc = vec2f(p.pos.x * 2.0 - 1.0, 1.0 - p.pos.y * 2.0);
  out.pos = vec4f(ndc + corner * sizePx / params.resolution * 2.0, 0.0, 1.0);
  out.uv = corner;
  out.tint = paletteColor(t);
  // A few particles carry much more light than the rest: that spread is what
  // separates bright filaments from the haze behind them.
  let spark = pow(fract(p.seed * 7.3), 2.4);
  // p.pad carries the large-scale cloud mask written by the compute pass.
  let cloud = mix(0.16, 1.0, clamp(p.pad, 0.0, 1.0));
  out.energy = envelope * mix(0.18, 1.0, sn) * (0.35 + spark * 2.6) * cloud * mix(1.15, 0.55, depth);
  return out;
}

@fragment
fn partFS(in: VSOut) -> @location(0) vec4f {
  let d = dot(in.uv, in.uv);
  if (d > 1.0) { discard; }
  let falloff = exp(-3.4 * d) * (1.0 - d);
  let i = falloff * in.energy * params.glow * 0.03;
  return vec4f(in.tint * i, i);
}
