// Fullscreen pass-through quad. planeGeometry(2,2) positions already span the
// full NDC cube (-1..1), so we emit clip-space directly and ignore the camera.
// The fragment stage reconstructs view rays from vUv + the resolution aspect.
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
