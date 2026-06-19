import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import vertexShader from '../shaders/fs.vert'
import fragmentShader from '../shaders/raymarch.frag'

type RaymarchUniforms = {
  uTime: { value: number }
  uMouse: { value: THREE.Vector2 }
  uRes: { value: THREE.Vector2 }
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Fullscreen raymarched SDF scene. A planeGeometry(2,2) spans NDC so the
 * fragment stage owns every pixel; the camera ray, scene SDF, normals, soft
 * shadows, AO, fresnel, fog and IQ palette are all hand-written in
 * raymarch.frag. The camera orbits via uTime and is nudged by uMouse.
 */
function RaymarchPlane() {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const { size, gl } = useThree()

  // Eased cursor in 0..1 space; starts centered so the orbit is well-framed
  // before the pointer ever moves.
  const mouse = useRef(new THREE.Vector2(0.5, 0.5))
  const reduced = useRef(prefersReducedMotion())

  const uniforms = useMemo<RaymarchUniforms>(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uRes: { value: new THREE.Vector2(1, 1) },
    }),
    [],
  )

  useFrame((state, delta) => {
    if (!materialRef.current) return

    const speed = reduced.current ? 0.2 : 1.0
    uniforms.uTime.value = state.clock.elapsedTime * speed

    // pointer is NDC (-1..1); remap to 0..1 and ease toward it.
    const tx = state.pointer.x * 0.5 + 0.5
    const ty = state.pointer.y * 0.5 + 0.5
    const ease = reduced.current ? 1 : Math.min(1, delta * 3.0)
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

export default function RaymarchSDF() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#04030a' }}>
      <Canvas
        orthographic
        camera={{ zoom: 1, position: [0, 0, 1] }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <RaymarchPlane />
      </Canvas>
    </div>
  )
}
