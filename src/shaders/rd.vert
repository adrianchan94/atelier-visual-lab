// Passthrough vertex stage shared by the reaction-diffusion sim and render
// passes. The plane spans clip space directly (planeGeometry(2,2)), so the
// quad always fills the frame regardless of camera.
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
