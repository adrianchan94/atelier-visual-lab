import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js'
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js'

/**
 * Procedural world — the procedural-generation skill made literal.
 *
 * A 3D isosurface carved by Marching Cubes from an fBm noise field: layered
 * `ImprovedNoise` octaves + a vertical density gradient produce floating
 * terrain with overhangs and caves. Per-cell palette writes give a height-based
 * biome ramp (rock → moss → snow). Deterministic per seed (noise is offset by a
 * seeded vector); "Regenerate" reshapes the world, "Morph" slowly drifts the
 * field. Rendered with AgX tonemapping + bloom.
 */

const RES = 44 // grid resolution per axis (RES^3 cells)

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Height-based biome ramp written into the MarchingCubes palette.
const ROCK = new THREE.Color('#5b4a3a')
const MOSS = new THREE.Color('#3f7d4f')
const GRASS = new THREE.Color('#6fae57')
const SNOW = new THREE.Color('#eef2ff')
const scratch = new THREE.Color()
const cellCol = new THREE.Color()

function biome(ny: number, moisture: number, out: THREE.Color) {
  if (ny < 0.34) out.copy(ROCK)
  else if (ny < 0.52) out.copy(ROCK).lerp(MOSS, (ny - 0.34) / 0.18)
  else if (ny < 0.74) out.copy(MOSS).lerp(GRASS, (ny - 0.52) / 0.22)
  else out.copy(GRASS).lerp(SNOW, Math.min(1, (ny - 0.74) / 0.26))
  // Drier zones tilt toward rock for variety.
  return out.lerp(scratch.copy(ROCK), (1 - moisture) * 0.25)
}

function Terrain({ seed, morph }: { seed: number; morph: boolean }) {
  const noise = useMemo(() => new ImprovedNoise(), [])

  const mc = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.0,
      flatShading: false,
    })
    const cubes = new MarchingCubes(RES, mat, true, true, 120000)
    cubes.isolation = 0
    cubes.scale.setScalar(3.2)
    return cubes
  }, [])

  useEffect(() => () => mc.geometry.dispose(), [mc])

  // (Re)build the density field for a given time offset.
  const build = useMemo(() => {
    const rng = mulberry32(seed)
    const ox = rng() * 100
    const oy = rng() * 100
    const oz = rng() * 100
    return (t: number) => {
      const size = mc.size
      const half = mc.halfsize
      for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
          const ny = y / (size - 1) // 0..1 height
          for (let x = 0; x < size; x++) {
            const fx = (x - half) / half
            const fy = (y - half) / half
            const fz = (z - half) / half
            // fBm: 3 octaves of improved Perlin.
            let n = 0
            let amp = 1
            let freq = 1.1
            for (let o = 0; o < 3; o++) {
              n +=
                amp *
                noise.noise(
                  fx * freq + ox + t * 0.15,
                  fy * freq + oy,
                  fz * freq + oz + t * 0.1,
                )
              amp *= 0.5
              freq *= 2.0
            }
            // Vertical gradient: solid low, air high → overhangs from noise.
            const gradient = 1.0 - 2.0 * ny
            // Radial falloff keeps the world a floating island, not a slab.
            const r = Math.sqrt(fx * fx + fz * fz)
            const island = 0.7 - r * 0.9
            const density = n * 1.3 + gradient + island

            const idx = mc.size2 * z + mc.size * y + x
            mc.field[idx] = density

            const moisture = 0.5 + 0.5 * noise.noise(fx * 0.6 + 9, fy * 0.6, fz * 0.6 + 4)
            const c = biome(ny, moisture, cellCol)
            mc.palette[idx * 3] = c.r
            mc.palette[idx * 3 + 1] = c.g
            mc.palette[idx * 3 + 2] = c.b
          }
        }
      }
      mc.update()
    }
  }, [mc, noise, seed])

  useEffect(() => {
    // Zero normals/field first so a regenerate doesn't keep stale geometry.
    mc.reset()
    build(0)
  }, [mc, build])

  const tRef = useRef(0)
  useFrame((_s, delta) => {
    if (!morph) return
    tRef.current += delta
    // Throttle the (expensive) rebuild to ~8 Hz while morphing.
    mc.userData.acc = (mc.userData.acc ?? 0) + delta
    if (mc.userData.acc > 0.12) {
      mc.userData.acc = 0
      build(tRef.current)
    }
  })

  return <primitive object={mc} />
}

export default function ProceduralWorld() {
  const [seed, setSeed] = useState(1)
  const [morph, setMorph] = useState(false)

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#070a12' }}>
      <Canvas
        camera={{ position: [0, 1.6, 6], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.AgXToneMapping
          gl.toneMappingExposure = 1.05
        }}
      >
        <color attach="background" args={['#070a12']} />
        <fog attach="fog" args={['#070a12', 8, 16]} />
        <hemisphereLight args={['#bcd0ff', '#20160f', 0.7]} />
        <directionalLight position={[5, 8, 4]} intensity={2.4} color="#fff3e0" />
        <directionalLight position={[-6, 2, -4]} intensity={0.6} color="#5b78ff" />
        <Terrain key={seed} seed={seed} morph={morph} />
        <OrbitControls
          autoRotate
          autoRotateSpeed={morph ? 0.4 : 0.9}
          enablePan={false}
          minDistance={3.5}
          maxDistance={11}
        />
        <EffectComposer>
          <Bloom intensity={0.5} luminanceThreshold={0.75} luminanceSmoothing={0.25} mipmapBlur />
        </EffectComposer>
      </Canvas>

      <div style={ui.bar}>
        <span style={ui.tag}>PROCEDURAL WORLD · MARCHING CUBES</span>
        <button style={ui.btn} onClick={() => setSeed((s) => s + 1)}>
          ⟳ Regenerate
        </button>
        <button style={morph ? ui.btnOn : ui.btn} onClick={() => setMorph((m) => !m)}>
          {morph ? '● Morphing' : '○ Morph'}
        </button>
        <a href="?" style={ui.back}>
          ← index
        </a>
      </div>
    </div>
  )
}

const ui: Record<string, React.CSSProperties> = {
  bar: {
    position: 'fixed',
    left: 16,
    bottom: 16,
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  tag: { letterSpacing: '0.2em', fontSize: 11, color: '#86a0d8' },
  btn: {
    background: 'rgba(16,22,38,0.7)',
    color: '#dce6ff',
    border: '1px solid #28324c',
    borderRadius: 999,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    backdropFilter: 'blur(8px)',
  },
  btnOn: {
    background: 'rgba(90,140,255,0.3)',
    color: '#fff',
    border: '1px solid #6a8aff',
    borderRadius: 999,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    backdropFilter: 'blur(8px)',
  },
  back: { color: '#9ab0e0', textDecoration: 'none', fontSize: 13, marginLeft: 4 },
}
