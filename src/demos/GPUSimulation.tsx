import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useFBO } from '@react-three/drei'
import simFragment from '../shaders/rd-sim.frag'
import renderFragment from '../shaders/rd-render.frag'
import passVertex from '../shaders/rd.vert'

// Square simulation grid. 512 keeps the laplacian crisp while staying cheap
// enough to run several sub-steps per frame on integrated GPUs.
const SIZE = 512
const TEXEL = 1 / SIZE

// Gray-Scott parameters tuned for the "coral / mitosis" regime: branching,
// budding growth rather than spots or stripes.
const FEED = 0.0545
const KILL = 0.062
const DA = 1.0
const DB = 0.5
const DT = 1.0
const SUBSTEPS = 8 // simulation iterations per displayed frame

type SimUniforms = {
  uState: { value: THREE.Texture | null }
  uTexel: { value: THREE.Vector2 }
  uFeed: { value: number }
  uKill: { value: number }
  uDA: { value: number }
  uDB: { value: number }
  uDt: { value: number }
  uMouse: { value: THREE.Vector2 }
  uDown: { value: number }
  uBrush: { value: number }
  uAspect: { value: number }
}

type RenderUniforms = {
  uState: { value: THREE.Texture | null }
  uTexel: { value: THREE.Vector2 }
  uTime: { value: number }
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Initial chemical field: A saturates everywhere (R = 1, G = 0), with a
// scattering of B "spores" that the reaction grows outward from.
function makeSeedTexture(): THREE.DataTexture {
  const data = new Float32Array(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) {
    data[i * 4 + 0] = 1.0 // A
    data[i * 4 + 1] = 0.0 // B
    data[i * 4 + 2] = 0.0
    data[i * 4 + 3] = 1.0
  }

  const blobs = 11
  for (let n = 0; n < blobs; n++) {
    const cx = Math.floor(SIZE * (0.15 + 0.7 * Math.random()))
    const cy = Math.floor(SIZE * (0.15 + 0.7 * Math.random()))
    const r = 4 + Math.floor(Math.random() * 6)
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue
        const px = cx + x
        const py = cy + y
        if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) continue
        const idx = (py * SIZE + px) * 4
        data[idx + 1] = 1.0 // B
      }
    }
  }

  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType)
  tex.needsUpdate = true
  return tex
}

function ReactionDiffusion() {
  const { gl, viewport } = useThree()

  const reduced = useRef(prefersReducedMotion())
  const seed = useMemo(makeSeedTexture, [])

  // Two half-float targets, nearest-sampled (exact texel taps for the
  // laplacian), no depth/stencil.
  const fboSettings = {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
  } as const
  const fboA = useFBO(SIZE, SIZE, fboSettings)
  const fboB = useFBO(SIZE, SIZE, fboSettings)

  const read = useRef<THREE.WebGLRenderTarget>(fboA)
  const write = useRef<THREE.WebGLRenderTarget>(fboB)
  const seeded = useRef(false)

  // Cursor state (uv 0..1) written by DOM pointer events, consumed in useFrame.
  const mouse = useRef(new THREE.Vector2(0.5, 0.5))
  const down = useRef(0)

  const renderMatRef = useRef<THREE.ShaderMaterial>(null)

  const simUniforms = useMemo<SimUniforms>(
    () => ({
      uState: { value: seed },
      uTexel: { value: new THREE.Vector2(TEXEL, TEXEL) },
      uFeed: { value: FEED },
      uKill: { value: KILL },
      uDA: { value: DA },
      uDB: { value: DB },
      uDt: { value: DT },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uDown: { value: 0 },
      uBrush: { value: 0.035 },
      uAspect: { value: 1 },
    }),
    [seed],
  )

  const renderUniforms = useMemo<RenderUniforms>(
    () => ({
      uState: { value: null },
      uTexel: { value: new THREE.Vector2(TEXEL, TEXEL) },
      uTime: { value: 0 },
    }),
    [],
  )

  // Dedicated offscreen scene + ortho camera + fullscreen quad for the sim.
  const { simScene, simCamera, simMaterial } = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      vertexShader: passVertex,
      fragmentShader: simFragment,
      uniforms: simUniforms,
      depthTest: false,
      depthWrite: false,
    })
    const scene = new THREE.Scene()
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    quad.frustumCulled = false
    scene.add(quad)
    return { simScene: scene, simCamera: cam, simMaterial: material }
  }, [simUniforms])

  // Keep the brush round even though the screen is wider than the square grid.
  useEffect(() => {
    simUniforms.uAspect.value = viewport.width / viewport.height
  }, [simUniforms, viewport.width, viewport.height])

  // Pointer handling on the canvas element: map client coords to uv.
  useEffect(() => {
    const canvas = gl.domElement
    const toUv = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.current.set(
        (e.clientX - rect.left) / rect.width,
        1 - (e.clientY - rect.top) / rect.height, // flip Y to uv space
      )
    }
    const onDown = (e: PointerEvent) => {
      toUv(e)
      down.current = 1
    }
    const onMove = (e: PointerEvent) => toUv(e)
    const onUp = () => {
      down.current = 0
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [gl])

  useEffect(() => {
    const mat = simMaterial
    return () => {
      mat.dispose()
      seed.dispose()
    }
  }, [simMaterial, seed])

  useFrame((state) => {
    const steps = reduced.current ? 3 : SUBSTEPS

    simUniforms.uMouse.value.copy(mouse.current)
    simUniforms.uDown.value = down.current

    // Multiple ping-pong sub-steps so the chemistry visibly advances each frame.
    for (let i = 0; i < steps; i++) {
      simUniforms.uState.value = seeded.current ? read.current.texture : seed
      seeded.current = true

      gl.setRenderTarget(write.current)
      gl.render(simScene, simCamera)

      const tmp = read.current
      read.current = write.current
      write.current = tmp
    }
    gl.setRenderTarget(null)

    // Present the most recent state (now in read after the final swap).
    renderUniforms.uState.value = read.current.texture
    renderUniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={renderMatRef}
        vertexShader={passVertex}
        fragmentShader={renderFragment}
        uniforms={renderUniforms}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  )
}

export default function GPUSimulation() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#03070a' }}>
      <Canvas
        orthographic
        camera={{ zoom: 1, position: [0, 0, 1] }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <color attach="background" args={['#03070a']} />
        <ReactionDiffusion />
      </Canvas>
    </div>
  )
}
