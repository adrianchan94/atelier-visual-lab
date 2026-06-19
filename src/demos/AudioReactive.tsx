import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Audio-reactive visuals — the audio-reactive-visuals skill made literal.
 *
 * Pipeline: Web Audio `AnalyserNode` FFT → 256-bin `Uint8Array` → packed into a
 * 256×1 `RedFormat` `DataTexture` updated every frame → sampled in the vertex
 * shader by longitude to displace an icosahedron, with bass driving a global
 * pulse and emissive bloom. Source is a generative oscillator pad (no mic
 * needed, so it runs autonomously) or the live microphone. When the
 * AudioContext is suspended (e.g. before the first gesture / headless), a
 * procedural spectrum keeps the scene alive instead of going flat.
 */

const BINS = 256

// ─── Audio engine ──────────────────────────────────────────────────
class AudioEngine {
  ctx: AudioContext | null = null
  analyser: AnalyserNode | null = null
  private raw = new Uint8Array(BINS)
  private oscillators: OscillatorNode[] = []
  private micStream: MediaStream | null = null
  mode: 'idle' | 'pad' | 'mic' = 'idle'

  bass = 0
  mid = 0
  treble = 0

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = BINS * 2
      this.analyser.smoothingTimeConstant = 0.82
      this.analyser.connect(this.ctx.destination)
    }
    return this.ctx
  }

  /** Generative ambient pad — detuned saws through an LFO-swept filter. */
  startPad() {
    const ctx = this.ensureCtx()
    void ctx.resume()
    this.stopSources()
    if (!this.analyser) return

    const master = ctx.createGain()
    master.gain.value = 0.0001
    master.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 1.5)

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 600
    filter.Q.value = 8

    // LFO sweeps the cutoff so the spectrum keeps evolving.
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.frequency.value = 0.08
    lfoGain.gain.value = 900
    lfo.connect(lfoGain).connect(filter.frequency)
    lfo.start()

    const roots = [55, 82.4, 110, 164.8, 220, 277.2]
    for (const f of roots) {
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = f
      o.detune.value = (Math.random() - 0.5) * 14
      o.connect(filter)
      o.start()
      this.oscillators.push(o)
    }
    this.oscillators.push(lfo)

    filter.connect(master)
    master.connect(this.analyser)
    this.mode = 'pad'
  }

  async startMic() {
    const ctx = this.ensureCtx()
    await ctx.resume()
    this.stopSources()
    if (!this.analyser) return
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const src = ctx.createMediaStreamSource(this.micStream)
    // Mic feeds the analyser only (not destination) to avoid feedback.
    const tap = ctx.createGain()
    tap.gain.value = 1
    src.connect(tap).connect(this.analyser)
    this.mode = 'mic'
  }

  private stopSources() {
    for (const o of this.oscillators) {
      try {
        o.stop()
      } catch {
        /* already stopped */
      }
    }
    this.oscillators = []
    if (this.micStream) {
      for (const t of this.micStream.getTracks()) t.stop()
      this.micStream = null
    }
  }

  /** Fill `out` with the current spectrum (0..1), or a synthetic one. */
  sample(out: Float32Array, time: number) {
    const live =
      this.analyser != null &&
      this.ctx != null &&
      this.ctx.state === 'running' &&
      this.mode !== 'idle'

    if (live && this.analyser) {
      this.analyser.getByteFrequencyData(this.raw)
      let energy = 0
      for (let i = 0; i < BINS; i++) {
        const v = this.raw[i] / 255
        out[i] = v
        energy += v
      }
      // If the graph hasn't ramped up yet, fall through to synthetic.
      if (energy > 0.5) {
        this.computeBands(out)
        return
      }
    }

    // Synthetic evolving spectrum — keeps the scene alive pre-gesture.
    for (let i = 0; i < BINS; i++) {
      const f = i / BINS
      const env = Math.pow(1 - f, 1.4)
      const wob =
        0.5 +
        0.5 *
          Math.sin(time * 1.7 + f * 22) *
          Math.cos(time * 0.6 + f * 7)
      out[i] = env * (0.35 + 0.65 * wob) * (0.6 + 0.4 * Math.sin(time * 0.9))
    }
    this.computeBands(out)
  }

  private computeBands(out: Float32Array) {
    const avg = (a: number, b: number) => {
      let s = 0
      for (let i = a; i < b; i++) s += out[i]
      return s / Math.max(1, b - a)
    }
    // Frame-rate-independent-ish smoothing toward new band energies.
    this.bass += (avg(0, 16) - this.bass) * 0.25
    this.mid += (avg(16, 80) - this.mid) * 0.25
    this.treble += (avg(80, 256) - this.treble) * 0.25
  }

  dispose() {
    this.stopSources()
    void this.ctx?.close()
    this.ctx = null
    this.analyser = null
  }
}

// ─── Shaders ───────────────────────────────────────────────────────
const vert = /* glsl */ `
  uniform sampler2D uAudio;
  uniform float uTime;
  uniform float uBass;
  varying float vDisp;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // Longitude → frequency bin so the spectrum wraps the sphere.
    float lon = (atan(position.z, position.x) + 3.141592653589793) / 6.283185307179586;
    float amp = texture2D(uAudio, vec2(lon, 0.0)).r;
    // Latitude tilts which part of the spectrum each ring samples.
    float lat = position.y * 0.5 + 0.5;
    float amp2 = texture2D(uAudio, vec2(fract(lon + lat * 0.3), 0.0)).r;
    float disp = mix(amp, amp2, 0.5) * 0.55 + uBass * 0.35;
    disp += 0.04 * sin(uTime * 2.0 + position.y * 8.0);
    vec3 p = position + normal * disp;
    vDisp = disp;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const frag = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uTreble;
  varying float vDisp;
  varying vec3 vNormal;
  varying vec3 vView;

  vec3 palette(float t) {
    vec3 a = vec3(0.45, 0.32, 0.62);
    vec3 b = vec3(0.55, 0.45, 0.55);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.10, 0.42, 0.78);
    return a + b * cos(6.28318 * (c * t + d));
  }

  void main() {
    float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.2);
    vec3 base = palette(vDisp * 1.6 + uTime * 0.05 + uTreble * 0.4);
    vec3 col = base * (0.35 + vDisp * 2.4);
    col += fres * vec3(0.4, 0.6, 1.0) * (0.6 + uTreble);
    col += vDisp * vDisp * vec3(1.2, 0.7, 1.4) * 1.5; // emissive peaks → bloom
    gl_FragColor = vec4(col, 1.0);
  }
`

type Uniforms = {
  uAudio: { value: THREE.DataTexture }
  uTime: { value: number }
  uBass: { value: number }
  uTreble: { value: number }
}

// ─── Reactive mesh ─────────────────────────────────────────────────
function ReactiveOrb({ engine }: { engine: AudioEngine }) {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const group = useRef<THREE.Group>(null)
  const spectrum = useRef(new Float32Array(BINS))

  const tex = useMemo(() => {
    const data = new Uint8Array(BINS)
    const t = new THREE.DataTexture(data, BINS, 1, THREE.RedFormat, THREE.UnsignedByteType)
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
    return t
  }, [])

  const uniforms = useMemo<Uniforms>(
    () => ({
      uAudio: { value: tex },
      uTime: { value: 0 },
      uBass: { value: 0 },
      uTreble: { value: 0 },
    }),
    [tex],
  )

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    engine.sample(spectrum.current, t)

    const img = tex.image.data
    if (img instanceof Uint8Array) {
      for (let i = 0; i < BINS; i++) img[i] = Math.min(255, spectrum.current[i] * 255)
      tex.needsUpdate = true
    }

    uniforms.uTime.value = t
    uniforms.uBass.value = engine.bass
    uniforms.uTreble.value = engine.treble

    if (group.current) {
      group.current.rotation.y += delta * (0.15 + engine.mid * 0.8)
      const s = 1 + engine.bass * 0.25
      group.current.scale.setScalar(s)
    }
  })

  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[1.3, 32]} />
        <shaderMaterial
          ref={mat}
          vertexShader={vert}
          fragmentShader={frag}
          uniforms={uniforms}
        />
      </mesh>
    </group>
  )
}

// ─── App ───────────────────────────────────────────────────────────
export default function AudioReactive() {
  const engineRef = useRef<AudioEngine | null>(null)
  if (!engineRef.current) engineRef.current = new AudioEngine()
  const engine = engineRef.current
  const [mode, setMode] = useState<'idle' | 'pad' | 'mic'>('idle')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => () => engine.dispose(), [engine])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#04030a' }}>
      <Canvas camera={{ position: [0, 0, 4.2], fov: 50 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={['#04030a']} />
        <ReactiveOrb engine={engine} />
      </Canvas>

      <div style={ui.bar}>
        <span style={ui.tag}>AUDIO-REACTIVE</span>
        <button
          style={mode === 'pad' ? ui.btnOn : ui.btn}
          onClick={() => {
            try {
              engine.startPad()
              setMode('pad')
              setErr(null)
            } catch {
              setErr('AudioContext unavailable')
            }
          }}
        >
          ▶ Generative pad
        </button>
        <button
          style={mode === 'mic' ? ui.btnOn : ui.btn}
          onClick={() => {
            engine
              .startMic()
              .then(() => {
                setMode('mic')
                setErr(null)
              })
              .catch(() => setErr('Microphone denied'))
          }}
        >
          🎤 Microphone
        </button>
        {err && <span style={ui.err}>{err}</span>}
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
  tag: { letterSpacing: '0.22em', fontSize: 11, color: '#8a8ad0' },
  btn: {
    background: 'rgba(20,20,40,0.7)',
    color: '#d8d8f0',
    border: '1px solid #2c2c4a',
    borderRadius: 999,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    backdropFilter: 'blur(8px)',
  },
  btnOn: {
    background: 'rgba(120,90,255,0.28)',
    color: '#fff',
    border: '1px solid #8a6aff',
    borderRadius: 999,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    backdropFilter: 'blur(8px)',
  },
  err: { color: '#ff9aa8', fontSize: 12 },
  back: { color: '#9a9ac8', textDecoration: 'none', fontSize: 13, marginLeft: 4 },
}
