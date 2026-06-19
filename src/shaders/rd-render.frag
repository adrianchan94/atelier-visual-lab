// Cinematic presentation of the reaction-diffusion field. The B concentration
// drives a deep-teal -> gold -> white ramp, and the gradient of B is treated as
// a height field so the coral structures pick up bump-style lighting and a thin
// specular rim — turning a 2D chemical map into something that reads as wet,
// living matter.
precision highp float;

varying vec2 vUv;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uTime;

vec3 ramp(float t) {
  vec3 abyss = vec3(0.012, 0.045, 0.060);
  vec3 teal  = vec3(0.020, 0.300, 0.360);
  vec3 gold  = vec3(0.960, 0.690, 0.250);
  vec3 white = vec3(1.000, 0.980, 0.920);
  vec3 c = mix(abyss, teal, smoothstep(0.02, 0.32, t));
  c = mix(c, gold, smoothstep(0.30, 0.62, t));
  c = mix(c, white, smoothstep(0.62, 0.96, t));
  return c;
}

void main() {
  float b = texture2D(uState, vUv).y;

  // Central-difference gradient -> surface normal of the B height field.
  float bl = texture2D(uState, vUv - vec2(uTexel.x, 0.0)).y;
  float br = texture2D(uState, vUv + vec2(uTexel.x, 0.0)).y;
  float bd = texture2D(uState, vUv - vec2(0.0, uTexel.y)).y;
  float bu = texture2D(uState, vUv + vec2(0.0, uTexel.y)).y;
  vec3 normal = normalize(vec3((bl - br) * 2.2, (bd - bu) * 2.2, 0.05));

  // Slowly drifting key light so the relief shimmers as patterns evolve.
  vec3 lightDir = normalize(vec3(0.55 * cos(uTime * 0.15), 0.6, 0.75));
  float diff = clamp(dot(normal, lightDir), 0.0, 1.0);
  float spec = pow(diff, 28.0);

  float v = smoothstep(0.0, 0.55, b);
  vec3 base = ramp(v);
  vec3 col = base * (0.40 + 0.75 * diff);
  col += spec * 0.55 * vec3(1.0, 0.95, 0.85);

  // Faint emissive glow in the dense cores.
  col += base * smoothstep(0.45, 0.85, b) * 0.25;

  // Cinematic vignette.
  vec2 q = vUv - 0.5;
  float vig = smoothstep(1.05, 0.30, length(q));
  col *= mix(0.62, 1.0, vig);

  // Filmic-ish tone curve + gentle desaturation of highlights.
  col = col / (col + vec3(0.85));
  col = pow(col, vec3(0.85));

  gl_FragColor = vec4(col, 1.0);
}
