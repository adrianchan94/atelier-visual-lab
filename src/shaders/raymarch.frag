// ─────────────────────────────────────────────────────────────────────────
// RaymarchSDF — a hand-written signed-distance-field scene marched per pixel.
//
// Scene: a smooth-union ("metaball") of morphing primitives — a breathing
// sphere, an orbiting torus and a tumbling rounded box — fused into one
// organic body, floating above a soft reflective floor. Lit with a key light,
// soft shadows (penumbra approximation), 5-tap ambient occlusion, a fresnel
// rim, distance fog and an Inigo-Quilez cosine palette that drifts over time.
//
// Everything (camera ray, SDF, normals, shading) is computed here. GLSL ES 1.00.
// ─────────────────────────────────────────────────────────────────────────
precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform vec2  uMouse; // 0..1, eased cursor
uniform vec2  uRes;   // device-pixel resolution

#define MAX_STEPS 96
#define MAX_DIST  60.0
#define SURF_EPS  0.0006
#define PI        3.14159265359

// IQ cosine gradient palette — cheap, smooth, endlessly tunable.
vec3 palette(float t) {
  vec3 a = vec3(0.55, 0.45, 0.55);
  vec3 b = vec3(0.45, 0.40, 0.45);
  vec3 c = vec3(1.00, 1.00, 1.00);
  vec3 d = vec3(0.10, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}

// 2D rotation helper.
mat2 rot(float a) {
  float s = sin(a), co = cos(a);
  return mat2(co, -s, s, co);
}

// ── Primitive SDFs ───────────────────────────────────────────────────────
float sdSphere(vec3 p, float r) { return length(p) - r; }

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// Polynomial smooth-union (IQ): blends two fields with a soft seam of width k.
float opSmoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

// ── Scene SDF ──────────────────────────────────────────────────────────────
// Returns distance; writes a 0..1 material id into `mat` for palette mixing.
float mapScene(vec3 p, out float mat) {
  float t = uTime;

  // Breathing central sphere.
  vec3 ps = p;
  float rad = 0.95 + 0.10 * sin(t * 1.3);
  float dSphere = sdSphere(ps, rad);

  // Orbiting, tilting torus.
  vec3 pt = p;
  pt.xz = rot(t * 0.6) * pt.xz;
  pt.yz = rot(0.55 + 0.25 * sin(t * 0.4)) * pt.yz;
  float dTorus = sdTorus(pt, vec2(1.35, 0.34));

  // Tumbling rounded box that swings around the body.
  vec3 pb = p;
  pb -= vec3(1.25 * cos(t * 0.8), 0.55 * sin(t * 1.1), 1.25 * sin(t * 0.8));
  pb.xy = rot(t * 0.9) * pb.xy;
  pb.yz = rot(t * 0.7) * pb.yz;
  float dBox = sdRoundBox(pb, vec3(0.42), 0.12);

  // Fuse everything with progressively wider seams.
  float blob = opSmoothUnion(dSphere, dTorus, 0.55);
  blob = opSmoothUnion(blob, dBox, 0.45);

  // Soft reflective floor a little below the body.
  float dFloor = p.y + 1.9;

  float d;
  if (dFloor < blob) {
    d = dFloor;
    mat = 0.0; // floor
  } else {
    d = blob;
    // Material id driven by which lobe is nearest + position, for palette flow.
    mat = 0.35 + 0.4 * smoothstep(0.0, 1.0, length(p.xz) * 0.4) + 0.15 * sin(t * 0.5);
  }
  return d;
}

// Convenience wrapper when material id is not needed.
float mapDist(vec3 p) {
  float m;
  return mapScene(p, m);
}

// Gradient normal via central finite differences.
vec3 calcNormal(vec3 p) {
  vec2 e = vec2(1.0, -1.0) * 0.0008;
  return normalize(
    e.xyy * mapDist(p + e.xyy) +
    e.yyx * mapDist(p + e.yyx) +
    e.yxy * mapDist(p + e.yxy) +
    e.xxx * mapDist(p + e.xxx)
  );
}

// Soft shadow (IQ): marches toward the light, shrinking the penumbra by k.
float softShadow(vec3 ro, vec3 rd, float k) {
  float res = 1.0;
  float t = 0.04;
  for (int i = 0; i < 40; i++) {
    float h = mapDist(ro + rd * t);
    if (h < 0.001) return 0.0;
    res = min(res, k * h / t);
    t += clamp(h, 0.02, 0.6);
    if (t > 18.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

// 5-tap ambient occlusion along the normal.
float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float hr = 0.02 + 0.13 * float(i);
    float dd = mapDist(p + n * hr);
    occ += (hr - dd) * sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 2.2 * occ, 0.0, 1.0);
}

// March a ray; returns hit distance (or -1.0 for a miss) and material id.
float raymarch(vec3 ro, vec3 rd, out float mat) {
  float t = 0.0;
  mat = 0.0;
  for (int i = 0; i < MAX_STEPS; i++) {
    vec3 p = ro + rd * t;
    float m;
    float d = mapScene(p, m);
    if (d < SURF_EPS * t || t > MAX_DIST) {
      mat = m;
      break;
    }
    t += d;
  }
  if (t > MAX_DIST) return -1.0;
  return t;
}

void main() {
  // Reconstruct a centered, aspect-correct screen coordinate.
  vec2 uv = (vUv * 2.0 - 1.0);
  uv.x *= uRes.x / max(uRes.y, 1.0);

  // ── Orbiting camera, nudged by the mouse ──────────────────────────────
  float t = uTime * 0.18;
  float yaw   = t + (uMouse.x - 0.5) * 3.0;
  float pitch = 0.30 + (uMouse.y - 0.5) * 1.4;
  pitch = clamp(pitch, -1.2, 1.3);

  float camDist = 5.2;
  vec3 ro = vec3(
    camDist * cos(yaw) * cos(pitch),
    camDist * sin(pitch) + 0.4,
    camDist * sin(yaw) * cos(pitch)
  );
  vec3 ta = vec3(0.0, 0.0, 0.0);

  // Camera basis → primary ray.
  vec3 fwd = normalize(ta - ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  vec3 rd = normalize(uv.x * right + uv.y * up + 1.6 * fwd);

  // Animated sky / background gradient.
  vec3 sky = mix(vec3(0.015, 0.02, 0.04), vec3(0.06, 0.05, 0.12), uv.y * 0.5 + 0.5);
  sky += 0.04 * palette(uTime * 0.05 + 0.3);

  vec3 col = sky;

  float mat;
  float d = raymarch(ro, rd, mat);

  if (d > 0.0) {
    vec3 p = ro + rd * d;
    vec3 n = calcNormal(p);

    // Key light orbits slowly opposite the camera for rim separation.
    vec3 lightPos = vec3(4.0 * cos(uTime * 0.25), 5.0, 4.0 * sin(uTime * 0.25));
    vec3 l = normalize(lightPos - p);

    float diff = clamp(dot(n, l), 0.0, 1.0);
    float sh = softShadow(p + n * 0.02, l, 12.0);
    float ao = calcAO(p, n);

    // Fill + specular.
    vec3 h = normalize(l - rd);
    float spec = pow(clamp(dot(n, h), 0.0, 1.0), 48.0);
    float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);

    vec3 base;
    if (mat < 0.05) {
      // Floor: cool checker-free tint, takes the body's reflection cheaply.
      base = vec3(0.10, 0.12, 0.16);
      // Mirror-ish bounce of the sky toward the body.
      base += 0.06 * palette(0.55);
    } else {
      base = palette(mat + uTime * 0.04);
    }

    vec3 lit = base * (0.18 + 0.05 * ao);          // ambient
    lit += base * diff * sh * ao * 1.15;            // diffuse key
    lit += vec3(1.0) * spec * sh * 0.9;             // specular
    lit += palette(0.6 + uTime * 0.03) * fres * 0.9; // fresnel rim

    // Distance fog toward the sky color.
    float fog = 1.0 - exp(-0.012 * d * d);
    col = mix(lit, sky, clamp(fog, 0.0, 1.0));
  }

  // Subtle vignette + filmic-ish tonemap.
  float vig = smoothstep(1.6, 0.2, length(uv) * 0.7);
  col *= mix(0.7, 1.0, vig);
  col = col / (col + vec3(1.0));            // Reinhard
  col = pow(col, vec3(0.4545));             // gamma

  gl_FragColor = vec4(col, 1.0);
}
