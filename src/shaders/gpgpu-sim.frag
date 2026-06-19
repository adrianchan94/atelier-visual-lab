precision highp float;

// Ping-pong GPGPU simulation pass.
// Reads previous particle state (xyz = position, w = life) from uPositions
// and writes the integrated next state. Motion = divergence-free curl noise
// flow field + gentle radial attraction toward the origin. Particles respawn
// on a fresh point inside a sphere when their life expires or they drift past
// the containment radius.

uniform sampler2D uPositions;
uniform float uTime;
uniform float uDelta;
uniform float uNoiseScale;
uniform float uSpeed;
uniform float uAttraction;
uniform float uRadius;

varying vec2 vUv;

// ---------------------------------------------------------------------------
// Ashima Arts simplex noise (webgl-noise) — public domain / MIT.
// ---------------------------------------------------------------------------
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;

  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
            i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
            i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec3 snoiseVec3(vec3 x) {
  return vec3(
    snoise(x),
    snoise(x + vec3(123.4, 56.7, 89.0)),
    snoise(x + vec3(-45.6, 78.9, -12.3))
  );
}

// Curl of a vector potential field => divergence-free (incompressible) flow.
vec3 curlNoise(vec3 p) {
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);

  vec3 px0 = snoiseVec3(p - dx);
  vec3 px1 = snoiseVec3(p + dx);
  vec3 py0 = snoiseVec3(p - dy);
  vec3 py1 = snoiseVec3(p + dy);
  vec3 pz0 = snoiseVec3(p - dz);
  vec3 pz1 = snoiseVec3(p + dz);

  float x = (py1.z - py0.z) - (pz1.y - pz0.y);
  float y = (pz1.x - pz0.x) - (px1.z - px0.z);
  float z = (px1.y - px0.y) - (py1.x - py0.x);

  const float divisor = 1.0 / (2.0 * e);
  return normalize(vec3(x, y, z) * divisor);
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

// Uniform random point inside a unit sphere (radius cube-root for even density).
vec3 randomSphere(vec2 seed) {
  float u = hash11(seed.x * 78.233 + seed.y * 12.9898);
  float v = hash11(seed.y * 39.346 + seed.x * 11.135);
  float w = hash11(seed.x * 27.16 + seed.y * 94.673);
  float theta = u * 6.28318530718;
  float phi = acos(2.0 * v - 1.0);
  float r = pow(w, 1.0 / 3.0);
  return vec3(
    r * sin(phi) * cos(theta),
    r * sin(phi) * sin(theta),
    r * cos(phi)
  );
}

void main() {
  vec4 data = texture2D(uPositions, vUv);
  vec3 pos = data.xyz;
  float life = data.w;

  // Curl-noise advection field, slowly evolving over time.
  vec3 vel = curlNoise(pos * uNoiseScale + uTime * 0.05) * uSpeed;

  // Gentle pull back toward the origin so the cloud stays coherent.
  vel += -pos * uAttraction;

  pos += vel * uDelta;
  life -= uDelta * 0.15;

  float dist = length(pos);
  if (life <= 0.0 || dist > uRadius) {
    vec2 seed = vUv + fract(uTime) * 1.7;
    pos = randomSphere(seed) * (uRadius * 0.55);
    life = 1.0 + hash11(seed.x + seed.y * 3.17) * 1.5;
  }

  gl_FragColor = vec4(pos, life);
}
