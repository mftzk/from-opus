// Bloom blur (separable, half resolution) and the final composite:
// background gradient, trails, bloom, vignette, dither.

struct Post {
  texel    : vec2f, // 1 / size of the texture being sampled
  dir      : vec2f, // blur direction, (1,0) or (0,1)
  glow     : f32,
  time     : f32,
  paletteMix : f32,
  pad      : f32,
  bgFrom   : vec4f,
  bgTo     : vec4f,
};

@group(0) @binding(0) var srcTex   : texture_2d<f32>;
@group(0) @binding(1) var srcSamp  : sampler;
@group(0) @binding(2) var<uniform> post : Post;
@group(0) @binding(3) var bloomTex : texture_2d<f32>;

struct VSOut {
  @builtin(position) pos : vec4f,
  @location(0) uv        : vec2f,
};

@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> VSOut {
  var c = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0),
  );
  let p = c[vi];
  var o : VSOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return o;
}

// 9-tap gaussian, wide enough to read as a soft halo rather than a smear.
@fragment
fn fsBlur(in: VSOut) -> @location(0) vec4f {
  let w = array<f32, 5>(0.227027, 0.194595, 0.121622, 0.054054, 0.016216);
  let step = post.texel * post.dir * 1.7;
  var sum = textureSample(srcTex, srcSamp, in.uv) * w[0];
  for (var i = 1; i < 5; i = i + 1) {
    let o = step * f32(i);
    sum = sum + textureSample(srcTex, srcSamp, in.uv + o) * w[i];
    sum = sum + textureSample(srcTex, srcSamp, in.uv - o) * w[i];
  }
  return sum;
}

fn hash21(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

@fragment
fn fsComposite(in: VSOut) -> @location(0) vec4f {
  let scene = textureSample(srcTex, srcSamp, in.uv).rgb;
  let bloom = textureSample(bloomTex, srcSamp, in.uv).rgb;

  // Background: a very dark vertical gradient with a faint off-centre glow,
  // so the empty areas are never a flat black slab.
  let g = smoothstep(0.0, 1.0, in.uv.y);
  var bg = mix(post.bgFrom.rgb, post.bgTo.rgb, g);
  let c = in.uv - vec2f(0.5, 0.42);
  bg = bg + post.bgTo.rgb * 0.55 * exp(-dot(c, c) * 5.0);

  var col = bg + scene + bloom * post.glow * 0.6;

  // Soft filmic roll-off: highlights compress instead of clipping to white.
  col = col / (1.0 + col * 0.85);
  col = pow(col, vec3f(0.94));

  // Vignette.
  let v = in.uv - 0.5;
  col = col * (1.0 - dot(v, v) * 0.55);

  // Clamp-to-edge sampling in the blur leaves a faint bright rim; fade the
  // outermost few pixels so the frame has no visible border line.
  let e = min(min(in.uv.x, 1.0 - in.uv.x) / max(post.texel.x * 3.0, 1e-6),
              min(in.uv.y, 1.0 - in.uv.y) / max(post.texel.y * 3.0, 1e-6));
  col = col * mix(0.78, 1.0, smoothstep(0.0, 1.0, clamp(e, 0.0, 1.0)));

  // Dither at roughly one 8-bit step kills banding across the dark gradient.
  let n = hash21(in.uv * 1024.0 + vec2f(post.time * 31.0, post.time * 17.0));
  col = col + (n - 0.5) * (1.6 / 255.0);

  return vec4f(col, 1.0);
}
