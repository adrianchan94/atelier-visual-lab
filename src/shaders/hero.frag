// ScrollHero fragment shader — fresnel rim + Inigo-Quilez cosine-palette
// iridescence over a deep base, modulated by scroll progress. Rim values are
// deliberately pushed above 1.0 so the postprocessing Bloom pass blooms them.

precision highp float;

uniform float uTime;
uniform float uProgress;
uniform vec3 uColorA;
uniform vec3 uColorB;

varying vec3 vNormalW;
varying vec3 vWorldPos;
varying float vNoise;
varying vec2 vUv;

// iq cosine palette — smooth iridescent sweep across the spectrum
vec3 palette(float t) {
  vec3 a = vec3(0.50, 0.45, 0.55);
  vec3 b = vec3(0.45, 0.42, 0.50);
  vec3 c = vec3(1.00, 1.00, 1.00);
  vec3 d = vec3(0.00, 0.18, 0.40);
  return a + b * cos(6.28318530718 * (c * t + d));
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);

  // fresnel rim — strong at grazing angles
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);

  // iridescence driven by view angle, surface noise, scroll and slow drift
  float t = fres * 0.6 + vNoise * 0.35 + uProgress * 0.5 + uTime * 0.02;
  vec3 irid = palette(t);

  // deep base color crossfades as the user scrolls
  vec3 base = mix(uColorA, uColorB, clamp(uProgress, 0.0, 1.0));
  base *= 0.22 + 0.40 * smoothstep(-0.6, 0.8, vNoise);

  // bloom-friendly rim glow that intensifies with progress
  vec3 rim = irid * fres * (1.5 + uProgress * 1.6);

  // subtle inner sheen reacting to the displacement field
  vec3 sheen = irid * 0.08 * (0.5 + 0.5 * sin(vNoise * 8.0 + uTime));

  vec3 col = base + rim + sheen;

  gl_FragColor = vec4(col, 1.0);
}
