import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import vertexShader from '../shaders/field.vert'
import fragmentShader from '../shaders/field.frag'

type FieldUniforms = {
  uTime: { value: number }
  uMouse: { value: THREE.Vector2 }
  uRes: { value: THREE.Vector2 }
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Fullscreen pass-through quad driven entirely by a hand-written fragment
 * shader. The vertex stage emits clip-space directly (planeGeometry(2,2)),
 * so the quad always fills the frame; all the craft lives in field.frag.
 */
function FieldPlane() {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const { size, gl } = useThree()

  // Smoothed cursor in 0..1 uv space; starts centered so the field is alive
  // on first frame even before the pointer moves.
  const mouse = useRef(new THREE.Vector2(0.5, 0.5))
  const reduced = useRef(prefersReducedMotion())

  const uniforms = useMemo<FieldUniforms>(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uRes: { value: new THREE.Vector2(1, 1) },
    }),
    [],
  )

  useFrame((state, delta) => {
    if (!materialRef.current) return

    const speed = reduced.current ? 0.18 : 1.0
    uniforms.uTime.value = state.clock.elapsedTime * speed

    // state.pointer is NDC (-1..1); remap to 0..1 uv and ease toward it.
    const tx = state.pointer.x * 0.5 + 0.5
    const ty = state.pointer.y * 0.5 + 0.5
    const ease = reduced.current ? 1 : Math.min(1, delta * 3.5)
    mouse.current.x += (tx - mouse.current.x) * ease
    mouse.current.y += (ty - mouse.current.y) * ease
    uniforms.uMouse.value.copy(mouse.current)

    const dpr = gl.getPixelRatio()
    uniforms.uRes.value.set(size.width * dpr, size.height * dpr)
  })

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  )
}

export default function RawShaderField() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#06030d' }}>
      <Canvas
        orthographic
        camera={{ zoom: 1, position: [0, 0, 1] }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <FieldPlane />
      </Canvas>
    </div>
  )
}
