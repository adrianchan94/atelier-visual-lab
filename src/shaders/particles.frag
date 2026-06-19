precision highp float;

// Soft additive glowing sprite with a color ramp driven by radial position.
// Additive blending (set on the material) turns overlapping points into bloom.

uniform vec3 uColorCore;
uniform vec3 uColorMid;
uniform vec3 uColorEdge;

varying float vLife;
varying float vDist;

void main() {
  // Circular falloff from the point quad.
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;

  float glow = smoothstep(0.5, 0.0, d);
  glow = pow(glow, 1.6);

  // Two-stop ramp: hot core near origin -> cool mid -> dim edge outward.
  vec3 col = mix(uColorCore, uColorMid, smoothstep(0.0, 0.55, vDist));
  col = mix(col, uColorEdge, smoothstep(0.55, 1.0, vDist));

  // Bright specular pip in the very center of each sprite.
  col += vec3(0.18) * smoothstep(0.28, 0.0, d);

  // Fade particles in/out at the extremes of their life.
  float fade = smoothstep(0.0, 0.35, vLife) * (1.0 - smoothstep(2.0, 2.6, vLife));

  gl_FragColor = vec4(col * glow, glow * fade);
}
