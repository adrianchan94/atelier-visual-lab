// ShaderImageGallery — hover-driven liquid displacement + RGB chromatic split.
// uHover (0->1) scales both the noise warp amplitude and the channel offset.
precision highp float;

uniform sampler2D uTex;
uniform float uHover;
uniform float uTime;
uniform vec2 uMouse;

varying vec2 vUv;

// Ashima 2D simplex noise (public domain) — clean, isotropic flow for the warp.
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// Plane width / height — keeps the noise lattice square so the warp reads even.
const float ASPECT = 0.8;

void main() {
  vec2 uv = vUv;
  vec2 nuv = vec2(uv.x * ASPECT, uv.y);

  // Distortion swells toward the cursor for a tactile, localized "pull".
  float d = distance(uv, uMouse);
  float prox = smoothstep(0.65, 0.0, d);

  float t = uTime * 0.35;
  float n1 = snoise(nuv * 3.0 + vec2(t, -t * 0.8));
  float n2 = snoise(nuv * 5.5 - vec2(t * 0.6, t));
  vec2 disp = vec2(n1, n2);

  float amp = uHover * (0.045 + prox * 0.065);
  vec2 warped = uv + disp * amp;

  // Chromatic aberration fans out along the cursor direction.
  vec2 dir = normalize(uv - uMouse + 1e-4);
  float split = uHover * (0.012 + prox * 0.020);
  float r = texture2D(uTex, warped + dir * split).r;
  float g = texture2D(uTex, warped).g;
  float b = texture2D(uTex, warped - dir * split).b;
  vec3 col = vec3(r, g, b);

  // Soft luminous lift on hover so the active plane reads brighter.
  float lift = smoothstep(1.0, 0.35, distance(uv, vec2(0.5)));
  col += uHover * 0.07 * lift;

  gl_FragColor = vec4(col, 1.0);
}
