precision highp float;

// Render-pass vertex shader. Each point looks up its world position from the
// current simulation texture using its dedicated texel coordinate (aRef),
// rather than from a CPU-updated position attribute. This is the GPGPU read.

uniform sampler2D uPositions;
uniform float uPointSize;
uniform float uRadius;
uniform float uDpr;

attribute vec2 aRef;

varying float vLife;
varying float vDist;

void main() {
  vec4 data = texture2D(uPositions, aRef);
  vec3 pos = data.xyz;
  vLife = data.w;

  vDist = clamp(length(pos) / uRadius, 0.0, 1.0);

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Perspective size attenuation, scaled by device pixel ratio and life so
  // freshly respawned / dying particles twinkle in and out softly.
  float life = clamp(vLife, 0.0, 1.5);
  float attenuation = uPointSize * uDpr * (8.0 / -mvPosition.z);
  gl_PointSize = attenuation * (0.35 + 0.65 * smoothstep(0.0, 0.4, life));
}
