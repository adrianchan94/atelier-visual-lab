precision highp float;

uniform float uTime;   // seconds since mount
uniform vec2  uMouse;  // cursor in 0..1 uv space (smoothed)
uniform vec2  uRes;    // canvas size in px (for aspect)

varying vec2 vUv;

// ----------------------------------------------------------------------------
// Simplex noise 2D (Ashima Arts / Stefan Gustavson, public domain).
// Hand-inlined rather than pulled from a library, per the brief.
// ----------------------------------------------------------------------------
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,  // (3-sqrt(3))/6
                      0.366025403784439,  // 0.5*(sqrt(3)-1)
                     -0.577350269189626,  // -1 + 2*C.x
                      0.024390243902439); // 1/41
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                         + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
                          dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x  = 2.0 * fract(p * C.www) - 1.0;
  vec3 h  = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// 6-octave fractal Brownian motion with an inter-octave rotation to break up
// grid alignment and keep the field organic at every scale.
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 6; i++) {
    v += amp * snoise(p * freq);
    p = rot * p;
    freq *= 2.0;
    amp *= 0.5;
  }
  return v;
}

void main() {
  float aspect = uRes.x / max(uRes.y, 1.0);

  // Centered, aspect-corrected domain so the field stays isotropic.
  vec2 p = vUv - 0.5;
  p.x *= aspect;

  float t = uTime * 0.06;

  // --- Mouse warp: gently pull the domain toward the cursor. ---------------
  vec2 m = uMouse - 0.5;
  m.x *= aspect;
  vec2 toMouse = m - p;
  float md = length(toMouse);
  float pull = exp(-md * 2.6) * 0.32;
  p += toMouse / (md + 1e-4) * pull;

  // --- Double domain warp (fbm of fbm) for ink-in-water flow. --------------
  vec2 q = vec2(fbm(p + vec2(0.0, 1.0) + t),
                fbm(p + vec2(5.2, 1.3) - t));

  vec2 r = vec2(fbm(p + 1.8 * q + vec2(8.3, 2.8) + 0.16 * t),
                fbm(p + 1.8 * q + vec2(1.2, 6.5) - 0.12 * t));

  float f = fbm(p + 2.3 * r + t * 0.5);
  f = clamp(f * 0.5 + 0.5, 0.0, 1.0);

  // --- Refined color ramp: deep indigo -> violet -> magenta -> warm. -------
  vec3 c1 = vec3(0.04, 0.02, 0.11); // near-black indigo
  vec3 c2 = vec3(0.30, 0.07, 0.46); // royal violet
  vec3 c3 = vec3(0.92, 0.27, 0.56); // magenta
  vec3 c4 = vec3(1.00, 0.83, 0.62); // warm highlight

  float flow = dot(r, r);
  vec3 col = mix(c1, c2, smoothstep(0.00, 0.45, f));
  col = mix(col, c3, smoothstep(0.35, 0.74, f));
  col = mix(col, c4, smoothstep(0.80, 1.00, f + 0.14 * flow));

  // Interior glow keyed to the warp magnitude — gives the aurora filaments.
  col += c3 * 0.13 * smoothstep(0.40, 1.20, length(q));

  // --- Subtle animated grain (breaks banding on the deep stops). -----------
  float grain = fract(sin(dot(gl_FragCoord.xy + t * 60.0,
                              vec2(12.9898, 78.233))) * 43758.5453);
  col += (grain - 0.5) * 0.035;

  // --- Soft vignette. ------------------------------------------------------
  float vig = smoothstep(0.95, 0.25, length(vUv - 0.5) * 1.22);
  col *= vig;

  // --- Gentle filmic-ish tonemap + slight gamma lift. ----------------------
  col = col / (col + vec3(0.62)) * 1.62;
  col = pow(max(col, 0.0), vec3(0.90));

  gl_FragColor = vec4(col, 1.0);
}
