// Custom filmic color-grade — runs as a postprocessing `Effect` fragment.
// Implements an ASC-CDL-style lift / gamma / gain, contrast around an 18%
// grey pivot, a teal-orange split-tone (cool shadows, warm highlights) and a
// final saturation trim. The whole grade is cross-faded by uIntensity so the
// effect is honestly visible yet tasteful.

uniform vec3  uLift;          // additive shadow pedestal (per-channel)
uniform vec3  uGamma;         // midtone power (per-channel)
uniform vec3  uGain;          // highlight multiplier (per-channel)
uniform vec3  uShadowTint;    // split-tone colour pulled into shadows  (teal)
uniform vec3  uHighlightTint; // split-tone colour pushed into highs    (orange)
uniform float uSplit;         // split-tone strength
uniform float uContrast;      // contrast around 18% grey
uniform float uSaturation;    // 1.0 = neutral
uniform float uIntensity;     // overall grade mix [0,1]

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 col = inputColor.rgb;
  vec3 graded = col;

  // Lift / Gamma / Gain (cinematic primary grade).
  graded *= uGain;                                  // gain  — scale highlights
  graded += uLift * (1.0 - graded);                 // lift  — raise the floor
  graded  = pow(max(graded, vec3(0.0)), uGamma);    // gamma — bend midtones

  // Contrast about the standard 18% grey pivot.
  graded = (graded - 0.18) * uContrast + 0.18;

  // Teal-orange split-tone: cool the shadows, warm the highlights.
  float l = clamp(luma(graded), 0.0, 1.0);
  graded += (uShadowTint    - 0.5) * uSplit * (1.0 - l);
  graded += (uHighlightTint - 0.5) * uSplit * l;

  // Saturation trim around final luminance.
  float g = luma(graded);
  graded = mix(vec3(g), graded, uSaturation);

  // Honest, visible cross-fade of the full grade.
  vec3 finalCol = mix(col, graded, uIntensity);
  outputColor = vec4(clamp(finalCol, 0.0, 1.0), inputColor.a);
}
