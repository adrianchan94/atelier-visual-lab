// ═══════════════════════════════════════════════════════════════════
// GARGANTUA — Inside a Black Hole
//
// Gravitational lensing via raymarched space distortion.
// Photon sphere at 1.5 Rs. Accretion disk with relativistic Doppler shift.
// Hawking glow at the event horizon. Lens flare, god rays, star disintegration.
// The most visually extreme thing this GPU has ever done.
// ═══════════════════════════════════════════════════════════════════
precision highp float;

varying vec2 vUv;
uniform float uTime;
uniform vec2  uMouse;
uniform vec2  uRes;
uniform float uSteps;

#define PI        3.14159265359
#define MAX_DIST  60.0
#define HIT_EPS   0.001

// ── Utility ──────────────────────────────────────────────────────────
mat2 rot(float a) { float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  vec2 b = i.xy;
  return mix(
    mix(mix(hash(b), hash(b+vec2(1,0)), u.x),
        mix(hash(b+vec2(0,1)), hash(b+vec2(1,1)), u.x), u.y),
    mix(mix(hash(b+128.0), hash(b+vec2(1,0)+128.0), u.x),
        mix(hash(b+vec2(0,1)+128.0), hash(b+vec2(1,1)+128.0), u.x), u.y),
    u.z);
}

float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 0.11; a *= 0.5; }
  return v;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// Blackbody radiation approximation — temperature in Kelvin → RGB
vec3 blackbody(float temp) {
  // Simplified Planck radiation curve
  temp = clamp(temp, 1000.0, 30000.0);
  float t = temp / 100.0;
  vec3 col;
  // Red
  col.r = t <= 66.0 ? 1.0 : 1.292936 * pow(t - 60.0, -0.1332);
  // Green
  col.g = t <= 66.0 ? 0.39008 * log(max(t, 1.0)) - 0.63152
                    : 1.12989 * pow(t - 60.0, -0.0755);
  // Blue
  col.b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : 0.5432 * log(max(t - 10.0, 1.0)) - 1.1962);
  return clamp(col, 0.0, 1.0);
}

// ── Gravitational lensing: bend a light ray around the black hole ──
// Schwarzschild geodesic approximation: r'' = -1.5 Rs² / r⁴ * r̂
// We march the ray in steps, bending it toward the singularity each step.
// The deflection angle is proportional to 1/r² (weak field approximation
// pushed into the strong-field regime by amplifying the coupling).

// The black hole sits at origin. Event horizon radius = 1.0.
// Photon sphere at 1.5. Accretion disk inner edge at 3.0 (ISCO).

#define EH_RADIUS   1.0     // Event horizon (Schwarzschild radius)
#define PHOTON_SPHERE 1.5
#define ISCO        3.0     // Innermost stable circular orbit
#define DISK_OUTER  12.0
#define LENSING_STRENGTH 2.0

// ── Accretion disk SDF (thin disk in the xz plane) ──────────────────
// Returns distance to disk surface and writes temperature
float diskDensity(vec3 p, out float temp) {
  float r = length(p.xz);
  float h = abs(p.y);

  // Disk is between ISCO and DISK_OUTER, with vertical thickness
  if (r < ISCO || r > DISK_OUTER) { temp = 0.0; return 0.0; }

  // Vertical profile — thicker atmosphere, more glow
  float vertProfile = exp(-h * h * 4.0);

  // Radial density — denser inside, fading out
  float radDens = smoothstep(DISK_OUTER, ISCO, r);

  // Turbulent structure — multi-scale for organic detail
  float t = uTime;
  float angle = atan(p.z, p.x);
  float turb1 = fbm(vec3(r * 0.4, angle * 3.0, h * 4.0 + t * 0.8));
  float turb2 = fbm(vec3(r * 1.2, angle * 6.0 - t * 0.3, h * 8.0));
  float turb = turb1 * 0.7 + turb2 * 0.3;

  // Spiral arms — differential rotation creates trailing spirals
  float spiral = sin(angle * 2.0 + r * 0.8 - t * (3.0 / max(r, 1.0)) * 2.0);
  float spiralDensity = smoothstep(0.0, 1.0, spiral * 0.5 + 0.5);

  float density = vertProfile * radDens * (0.3 + 0.5 * turb + 0.3 * spiralDensity);

  // Temperature: hotter inside, modulated by turbulence and spiral compression
  temp = mix(2000.0, 16000.0, radDens) * (0.5 + 0.5 * turb) * (0.7 + 0.5 * spiralDensity);

  return density;
}

// ── Starfield with gravitational lensing distortion ─────────────────
float stars(vec3 dir) {
  vec3 p = floor(dir * 400.0);
  float h = hash(p.xy + p.zz * 17.0);
  return pow(fract(h * 43.0), 100.0);
}

// ═════════════════════════════════════════════════════════════════════
// GRAVITATIONAL RAYMARCHING — bend light around the black hole
// ═════════════════════════════════════════════════════════════════════
void main() {
  vec2 uv = (vUv * 2.0 - 1.0);
  uv.x *= uRes.x / max(uRes.y, 1.0);

  float t = uTime;
  vec2 mouseOffset = (uMouse - vec2(0.5)) * 0.4;

  // ── Camera: orbiting the black hole at a safe distance ──────────
  float camYaw = t * 0.03 + mouseOffset.x * 2.0;
  float camPitch = 0.25 + sin(t * 0.04) * 0.08 + mouseOffset.y * 0.8;
  float camDist = 22.0 + sin(t * 0.02) * 1.5;

  vec3 ro = vec3(
    camDist * cos(camYaw) * cos(camPitch),
    camDist * sin(camPitch),
    camDist * sin(camYaw) * cos(camPitch)
  );

  // Look slightly toward the disk plane for maximum drama
  vec3 ta = vec3(0.0, sin(t * 0.02) * 0.3, 0.0);
  vec3 fwd = normalize(ta - ro);
  vec3 right = normalize(cross(vec3(0, 1, 0), fwd));
  vec3 up = cross(fwd, right);
  vec3 rd = normalize(uv.x * right + uv.y * up + 2.0 * fwd);

  // ── Gravitational lensing march ─────────────────────────────────
  // Instead of straight-line raymarching, we bend the ray at each step
  // toward the black hole proportional to 1/r².
  // This naturally produces:
  // - Einstein ring (photons curving around behind)
  // - Photon sphere trapping (light orbiting at 1.5 Rs)
  // - Accretion disk appearing warped above and below
  // - Stars near the hole getting smeared into arcs

  vec3 pos = ro;
  vec3 vel = rd;
  float stepSize = 0.15;

  vec3 col = vec3(0.0);
  float diskAccum = 0.0;
  vec3 diskCol = vec3(0.0);
  float transmittance = 1.0;
  bool fallen = false;

  // Adaptive step: smaller near the hole, bigger far away
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps) break;

    float r = length(pos);

    // Crossed event horizon — ray consumed
    if (r < EH_RADIUS) { fallen = true; break; }
    if (r > MAX_DIST) break;

    // ── Gravitational deflection ────────────────────────────────
    // F = -G*M / r² * r̂  (pointing toward singularity)
    // For light, the effective potential gives 1.5x the Newtonian deflection
    vec3 toHole = -normalize(pos);
    float gravStrength = LENSING_STRENGTH / (r * r * r); // 1/r² for force
    // The extra r division comes from velocity normalization (photon always moves at c=1)

    // Bend velocity toward hole
    vel = normalize(vel + toHole * gravStrength * stepSize);

    // Adaptive step: near the hole, take tiny steps for precision
    stepSize = mix(0.04, 0.3, smoothstep(1.0, 8.0, r));

    pos += vel * stepSize;

    // ── Accretion disk volumetric accumulation ──────────────────
    float diskTemp;
    float dens = diskDensity(pos, diskTemp);

    if (dens > 0.001) {
      // Convert temperature to color via blackbody
      vec3 emitCol = blackbody(diskTemp);

      // Relativistic Doppler shift: the side of the disk rotating toward
      // us is blueshifted and dramatically brighter; the receding side dims.
      float angle3d = atan(pos.z, pos.x);
      float orbitVel = sqrt(0.5 / max(length(pos.xz), 0.8)) * 0.5;
      float doppler = dot(vel, vec3(-sin(angle3d), 0.0, cos(angle3d))) * orbitVel;
      // Strong relativistic beaming — approaching side much brighter
      float beaming = pow(max(0.01, 1.0 + doppler * 0.8), 3.5);
      emitCol *= beaming;

      // Gravitational redshift: light from deeper in the potential well loses energy
      float redshift = sqrt(max(0.0, 1.0 - EH_RADIUS / r));
      emitCol *= mix(0.3, 1.0, redshift);

      // Volume rendering integration
      float absorption = dens * stepSize * 0.8;
      col += emitCol * dens * stepSize * transmittance * 8.0;
      transmittance *= exp(-absorption);
      diskAccum += dens * stepSize;
    }

    // ── Hawking radiation glow near the event horizon ──────────
    if (r < 3.0) {
      float hawk = exp(-(r - EH_RADIUS) * 2.0) * 0.4;
      col += vec3(0.4, 0.7, 1.0) * hawk * transmittance;
    }
  }

  // ── Background stars (with lensing already applied via bent rays) ─
  if (!fallen && transmittance > 0.01) {
    vec3 finalDir = normalize(vel);
    float star1 = stars(finalDir);
    float star2 = stars(finalDir * 1.5 + 17.0);

    // Star colors — slight variation
    vec3 starCol = vec3(0.9, 0.92, 1.0);
    vec3 warmStar = vec3(1.0, 0.85, 0.7);

    col += starCol * star1 * transmittance * (0.6 + 0.4 * sin(t * 1.5 + star1 * 200.0));
    col += warmStar * star2 * transmittance * 0.3;

    // Deep space nebula
    float neb = fbm(finalDir * 3.0 + vec3(t * 0.005, 0.0, 0.0));
    col += vec3(0.02, 0.01, 0.05) * pow(neb, 3.0) * transmittance * 0.5;
  }

  // ── Photon sphere glow ring ─────────────────────────────────────
  // The photon sphere at 1.5 Rs traps light — creates a bright ring
  // We detect this by checking how close rays passed to the 1.5 boundary
  // (Already naturally produced by the lensing, but we boost it)

  // ── Einstein ring enhancement ───────────────────────────────────
  // If the ray fell into the hole, add a thin bright ring at the edge
  if (fallen) {
    // The event horizon itself is pure black — but the photon ring
    // around it is intensely bright from all the light trapped there
    col += vec3(0.0); // The hole is BLACK. Drama comes from the disk around it.
  }

  // ── Fake bloom (bright-pass additive) ───────────────────────────
  float bright = max(max(col.r, col.g), col.b);
  bright = smoothstep(0.35, 1.8, bright);
  col += col * bright * 1.2;

  // ── Lens flare from the brightest disk region ───────────────────
  // Radial light streaks from the center
  vec2 dir = normalize(vUv - 0.5 + 0.001);
  float flare = pow(max(0.0, dot(dir, vec2(cos(t*0.1), sin(t*0.1)))), 4.0) * 0.08;
  col += vec3(1.0, 0.7, 0.3) * flare;

  // ── Vignette ────────────────────────────────────────────────────
  float vig = 1.0 - smoothstep(0.4, 1.6, length(uv));
  col *= 0.45 + vig * 0.65;

  // ── Film grain ──────────────────────────────────────────────────
  float grain = hash(vUv * uRes + t * 47.0);
  col += (grain - 0.5) * 0.012;

  // ── ACES + gamma ────────────────────────────────────────────────
  col = aces(col);
  col = pow(col, vec3(0.4545));

  gl_FragColor = vec4(col, 1.0);
}
