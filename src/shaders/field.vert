// Fullscreen pass-through: planeGeometry(2,2) positions already span NDC,
// so we emit clip-space directly and ignore the camera entirely. This makes
// the quad fill the frame regardless of aspect / camera setup.
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
