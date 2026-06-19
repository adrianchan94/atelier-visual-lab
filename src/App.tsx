import {
  Component,
  lazy,
  Suspense,
  useMemo,
  type ComponentType,
  type ReactNode,
} from 'react'

/**
 * Atelier Visual Lab — demo router.
 *
 * A curated reference implementation of cutting-edge WebGL / WebGPU techniques.
 * Each entry in DEMOS is a self-contained `position:fixed; inset:0` demo with a
 * default export and no props. Pick one with `?demo=Name`; the index menu lists
 * everything otherwise. Demos are code-split via React.lazy so one heavy (or
 * broken) demo never blocks the rest, and an error boundary keeps a throwing
 * demo from taking down the shell.
 */

type DemoLoader = () => Promise<{ default: ComponentType }>

type DemoMeta = {
  group: string
  blurb: string
  load: DemoLoader
}

// ─── Registry ──────────────────────────────────────────────────────
// group → ordering/coloring in the index; blurb → one-line description.
const DEMOS: Record<string, DemoMeta> = {
  // ─── Flagship synthesis hero ─────────────────────────────────────
  Hero: {
    group: 'Flagship',
    blurb: 'SIGNAL ∕ NOISE — scroll-narrative particle morph + magnetic pointer + kinetic type',
    load: () => import('./demos/Hero'),
  },
  // Shaders & GPGPU
  RawShaderField: {
    group: 'Shaders',
    blurb: 'Fullscreen fBm + double domain-warp ink/aurora field',
    load: () => import('./demos/RawShaderField'),
  },
  GPGPUParticles: {
    group: 'Shaders',
    blurb: '65k-particle ping-pong FBO curl-noise simulation',
    load: () => import('./demos/GPGPUParticles'),
  },
  ShaderImageGallery: {
    group: 'Shaders',
    blurb: 'Liquid displacement + chromatic split on hover',
    load: () => import('./demos/ShaderImageGallery'),
  },
  RaymarchSDF: {
    group: 'Shaders',
    blurb: 'Raymarched SDF scene — soft shadows, AO, fresnel, IQ palette',
    load: () => import('./demos/RaymarchSDF'),
  },
  GPUSimulation: {
    group: 'Shaders',
    blurb: 'Gray-Scott reaction-diffusion ping-pong FBO field',
    load: () => import('./demos/GPUSimulation'),
  },
  // Cinematic & interactive
  CinematicPostFX: {
    group: 'Cinematic',
    blurb: 'Bloom + DoF + AO post stack on a PBR scene',
    load: () => import('./demos/CinematicPostFX'),
  },
  ScrollHero: {
    group: 'Interactive',
    blurb: 'Vertex-displaced icosahedron, fresnel iridescence, bloom',
    load: () => import('./demos/ScrollHero'),
  },
  KineticType: {
    group: 'Interactive',
    blurb: 'SplitText kinetic headline + magnetic spring cursor',
    load: () => import('./demos/KineticType'),
  },
  KineticDeck: {
    group: 'Interactive',
    blurb: 'Framer Motion springs, gradient stage, magnetic cards',
    load: () => import('./demos/KineticDeck'),
  },
  // Game & advanced renderers
  GameArena: {
    group: 'Advanced',
    blurb: 'Rapier physics arena — instanced bodies, character controller',
    load: () => import('./demos/GameArena'),
  },
  WebGPUCompute: {
    group: 'Advanced',
    blurb: 'WebGPU capability probe + WebGL2 fallback',
    load: () => import('./demos/WebGPUCompute'),
  },
  SplatField: {
    group: 'Advanced',
    blurb: '3D Gaussian splat field — additive gaussian billboards',
    load: () => import('./demos/SplatField'),
  },
  // ─── Frontier additions (June 2026 gap-closers) ──────────────────
  AudioReactive: {
    group: 'Frontier',
    blurb: 'Web Audio FFT → DataTexture → reactive shader (audio-reactive-visuals)',
    load: () => import('./demos/AudioReactive'),
  },
  ProceduralWorld: {
    group: 'Frontier',
    blurb: 'Marching-cubes isosurface terrain from 3D noise (procedural-generation)',
    load: () => import('./demos/ProceduralWorld'),
  },
  DepthParallax: {
    group: 'Frontier',
    blurb: 'Depth-driven 2.5D parallax + on-demand Depth Anything (browser-ml-visuals)',
    load: () => import('./demos/DepthParallax'),
  },
  ToneAndType: {
    group: 'Frontier',
    blurb: 'AgX/Neutral/ACES tonemap A/B + troika 3D text (postfx + typography)',
    load: () => import('./demos/ToneAndType'),
  },
  PathTraced: {
    group: 'Frontier',
    blurb: 'Progressive GI via three-gpu-pathtracer (realtime-pathtracing)',
    load: () => import('./demos/PathTraced'),
  },
  SpatialScene: {
    group: 'Frontier',
    blurb: 'WebXR-ready hall, VR/AR + flat fallback (webxr-spatial)',
    load: () => import('./demos/SpatialScene'),
  },
  WebGPUParticlesTSL: {
    group: 'Frontier',
    blurb: 'WebGPU-first ~160k TSL compute nebula + WebGL2 fallback (webgpu-tsl-compute)',
    load: () => import('./demos/WebGPUParticlesTSL'),
  },
  BoidsSwarm: {
    group: 'Frontier',
    blurb: 'Boids flocking — 2.6k agents, spatial hash, one instanced draw (procedural + game)',
    load: () => import('./demos/BoidsSwarm'),
  },
  FluidInk: {
    group: 'Frontier',
    blurb: 'Stable-fluids ink — advect/pressure-solve ping-pong FBOs (gpu-simulation-systems)',
    load: () => import('./demos/FluidInk'),
  },
}

// ─── Error boundary ────────────────────────────────────────────────
class DemoBoundary extends Component<
  { name: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <Shell>
          <h1 style={styles.h1}>{this.props.name} crashed</h1>
          <pre style={styles.pre}>{this.state.error.message}</pre>
          <a href="?" style={styles.back}>
            ← back to index
          </a>
        </Shell>
      )
    }
    return this.props.children
  }
}

// ─── Index menu ────────────────────────────────────────────────────
function Index() {
  const groups = useMemo(() => {
    const out: Record<string, [string, DemoMeta][]> = {}
    for (const [name, meta] of Object.entries(DEMOS)) {
      ;(out[meta.group] ??= []).push([name, meta])
    }
    return out
  }, [])

  return (
    <Shell>
      <p style={styles.eyebrow}>ATELIER · VISUAL LAB</p>
      <h1 style={styles.title}>WebGL / GPU demo index</h1>
      <p style={styles.lede}>
        {Object.keys(DEMOS).length} demos. Append <code style={styles.code}>?demo=Name</code> or
        click below.
      </p>
      {Object.entries(groups).map(([group, items]) => (
        <section key={group} style={styles.section}>
          <h2 style={styles.h2}>{group}</h2>
          <ul style={styles.list}>
            {items.map(([name, meta]) => (
              <li key={name} style={styles.item}>
                <a href={`?demo=${name}`} style={styles.link}>
                  {name}
                </a>
                <span style={styles.blurb}>{meta.blurb}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={styles.shell}>
      <div style={styles.inner}>{children}</div>
    </div>
  )
}

// ─── App ───────────────────────────────────────────────────────────
export default function App() {
  const name =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('demo')
      : null

  if (!name) return <Index />

  const meta = DEMOS[name]
  if (!meta) {
    return (
      <Shell>
        <h1 style={styles.h1}>Unknown demo: {name}</h1>
        <a href="?" style={styles.back}>
          ← back to index
        </a>
      </Shell>
    )
  }

  const Demo = lazy(meta.load)
  return (
    <DemoBoundary name={name}>
      <Suspense fallback={<Loading name={name} />}>
        <Demo />
      </Suspense>
    </DemoBoundary>
  )
}

function Loading({ name }: { name: string }) {
  return (
    <div style={styles.loading}>
      <span style={styles.spinner} />
      loading {name}…
    </div>
  )
}

// ─── Styles (inline; no external CSS dependency) ───────────────────
const styles: Record<string, React.CSSProperties> = {
  shell: {
    position: 'fixed',
    inset: 0,
    overflow: 'auto',
    background: 'radial-gradient(120% 120% at 50% 0%, #0b0b18 0%, #05050a 60%)',
    color: '#e8e8f0',
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial',
  },
  inner: { maxWidth: 860, margin: '0 auto', padding: '64px 28px 96px' },
  eyebrow: {
    letterSpacing: '0.34em',
    fontSize: 11,
    color: '#7a7aa0',
    margin: '0 0 12px',
  },
  title: { fontSize: 'clamp(28px, 5vw, 46px)', fontWeight: 700, margin: '0 0 12px' },
  lede: { color: '#a6a6c6', margin: '0 0 40px', lineHeight: 1.6 },
  code: { background: '#16162a', padding: '2px 7px', borderRadius: 6, fontSize: '0.9em' },
  section: { marginBottom: 36 },
  h2: {
    fontSize: 12,
    letterSpacing: '0.2em',
    color: '#8888b8',
    textTransform: 'uppercase',
    margin: '0 0 14px',
    borderBottom: '1px solid #1c1c30',
    paddingBottom: 8,
  },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 },
  item: { display: 'flex', flexDirection: 'column', gap: 2 },
  link: { color: '#c9b8ff', textDecoration: 'none', fontSize: 17, fontWeight: 600 },
  blurb: { color: '#8c8cac', fontSize: 13 },
  h1: { fontSize: 26, margin: '0 0 16px' },
  lede2: {},
  back: { color: '#c9b8ff', textDecoration: 'none' },
  pre: {
    background: '#16162a',
    padding: 16,
    borderRadius: 10,
    color: '#ff9aa8',
    overflow: 'auto',
    fontSize: 13,
    margin: '0 0 16px',
  },
  loading: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    background: '#05050a',
    color: '#8c8cac',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  spinner: {
    width: 14,
    height: 14,
    border: '2px solid #2a2a45',
    borderTopColor: '#c9b8ff',
    borderRadius: '50%',
    display: 'inline-block',
    animation: 'spin 0.8s linear infinite',
  },
}
