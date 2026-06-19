// Gray-Scott reaction-diffusion integrator. State is packed as (A,B) in the
// R,G channels of a half-float ping-pong target. One invocation advances a
// single texel by one sub-step using a 3x3 laplacian stencil. Several of these
// sub-steps run per displayed frame to let the pattern actually grow.
precision highp float;

varying vec2 vUv;

uniform sampler2D uState;   // previous (A,B) field
uniform vec2 uTexel;        // 1.0 / resolution
uniform float uFeed;        // feed rate  (coral/mitosis regime)
uniform float uKill;        // kill rate
uniform float uDA;          // diffusion of A
uniform float uDB;          // diffusion of B
uniform float uDt;          // integration step
uniform vec2 uMouse;        // cursor in 0..1 uv
uniform float uDown;        // 1.0 while pressed
uniform float uBrush;       // brush radius in uv
uniform float uAspect;      // width / height, so the brush stays round

// Weighted 9-tap laplacian (the classic Gray-Scott kernel).
vec2 laplacian(vec2 uv, vec2 center) {
  vec2 l = center * -1.0;
  l += texture2D(uState, uv + uTexel * vec2(-1.0, -1.0)).xy * 0.05;
  l += texture2D(uState, uv + uTexel * vec2( 0.0, -1.0)).xy * 0.20;
  l += texture2D(uState, uv + uTexel * vec2( 1.0, -1.0)).xy * 0.05;
  l += texture2D(uState, uv + uTexel * vec2(-1.0,  0.0)).xy * 0.20;
  l += texture2D(uState, uv + uTexel * vec2( 1.0,  0.0)).xy * 0.20;
  l += texture2D(uState, uv + uTexel * vec2(-1.0,  1.0)).xy * 0.05;
  l += texture2D(uState, uv + uTexel * vec2( 0.0,  1.0)).xy * 0.20;
  l += texture2D(uState, uv + uTexel * vec2( 1.0,  1.0)).xy * 0.05;
  return l;
}

void main() {
  vec2 s = texture2D(uState, vUv).xy;
  float a = s.x;
  float b = s.y;

  vec2 lap = laplacian(vUv, s);

  // Gray-Scott update.
  float reaction = a * b * b;
  float da = uDA * lap.x - reaction + uFeed * (1.0 - a);
  float db = uDB * lap.y + reaction - (uKill + uFeed) * b;

  a += da * uDt;
  b += db * uDt;

  // Inject chemical B under the cursor while pressed (round brush).
  if (uDown > 0.5) {
    vec2 d = vUv - uMouse;
    d.x *= uAspect;
    float fall = smoothstep(uBrush, 0.0, length(d));
    b = min(1.0, b + fall * 0.85);
  }

  gl_FragColor = vec4(clamp(a, 0.0, 1.0), clamp(b, 0.0, 1.0), 0.0, 1.0);
}
