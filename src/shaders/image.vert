// ShaderImageGallery — pass-through vertex shader.
// Warp + chromatic split happen in the fragment stage; geometry stays flat.
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
