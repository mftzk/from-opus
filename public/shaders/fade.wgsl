// Carries the previous frame forward, dimmed. This is what makes the trails.

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

fn quadCorner(i: u32) -> vec2f {
  var c = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0),
  );
  return c[i];
}

@group(0) @binding(0) var prevTex  : texture_2d<f32>;
@group(0) @binding(1) var prevSamp : sampler;
@group(0) @binding(2) var<uniform> fadeParams : Params;

struct FadeOut {
  @builtin(position) pos : vec4f,
  @location(0) uv        : vec2f,
};

@vertex
fn fadeVS(@builtin(vertex_index) vi: u32) -> FadeOut {
  let c = quadCorner(vi);
  var o : FadeOut;
  o.pos = vec4f(c, 0.0, 1.0);
  o.uv = vec2f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
  return o;
}

@fragment
fn fadeFS(in: FadeOut) -> @location(0) vec4f {
  // Frame-rate independent decay: trail is a half-life in seconds.
  let k = exp(-fadeParams.dt / max(fadeParams.trail, 0.05));
  let prev = textureSample(prevTex, prevSamp, in.uv);
  return vec4f(prev.rgb * k, prev.a * k);
}
