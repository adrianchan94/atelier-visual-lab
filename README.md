# Atelier Visual Lab

A personal R&D lab for cutting-edge **WebGL / WebGPU / GPU-driven** web visuals — 22 self-contained demos spanning raw GLSL, raymarching, GPU simulation, WebGPU compute (TSL), real-time path tracing, 3D Gaussian splatting, physics, WebXR, audio-reactive and browser-ML effects, and a full scroll-narrative hero.

Every demo: production-built (`tsc` strict + Vite) and verified to render headless with **zero console errors**.

## ✨ Flagship — `?demo=Hero`
**SIGNAL ∕ NOISE** — one cohesive scroll-driven narrative. A 24,000-particle field morphs across three acts (a chaotic noise cloud → an ordered sphere → the literal word **SIGNAL**), with magnetic pointer repulsion as the through-line, additive-baked glow, Lenis smooth scroll, and kinetic typography. The thesis — *remove everything that isn't the message* — made literal.

## Run
```bash
pnpm install
pnpm dev        # http://localhost:5173  (use the index, or append ?demo=Name)
pnpm build      # tsc -b && vite build
pnpm preview
```
Open the index for a menu of every demo, or deep-link with `?demo=<Name>`.

## Demos

### Flagship
| Route | What it does |
|---|---|
| `Hero` | SIGNAL ∕ NOISE — 3-act scroll particle morph (cloud → sphere → word), magnetic pointer, kinetic type |

### Shaders & GPGPU
| Route | What it does |
|---|---|
| `RawShaderField` | Hand-written GLSL: fBm + double domain-warp ink/aurora field |
| `GPGPUParticles` | 65k-particle ping-pong FBO curl-noise simulation |
| `ShaderImageGallery` | Liquid displacement + RGB chromatic split on hover |
| `RaymarchSDF` | Raymarched SDF scene — soft shadows, AO, fresnel, IQ palette |
| `GPUSimulation` | Gray-Scott reaction-diffusion ping-pong FBO field |
| `FluidInk` | Stable-fluids (Navier-Stokes) ink — advect / divergence / Jacobi pressure / gradient-subtract |

### Cinematic & interactive
| Route | What it does |
|---|---|
| `CinematicPostFX` | Bloom + DoF + AO post stack on a PBR scene |
| `ScrollHero` | Vertex displacement + fresnel iridescence + bloom; GSAP ScrollTrigger + Lenis |
| `KineticType` | GSAP SplitText kinetic headline + magnetic spring cursor/buttons |
| `KineticDeck` | Framer Motion springs, gradient stage, magnetic cards |
| `ToneAndType` | Live AgX / PBR-Neutral / ACES tonemap A/B + in-scene 3D text (`<Text3D>`) |

### Advanced renderers, GPU & games
| Route | What it does |
|---|---|
| `GameArena` | Rapier physics arena — instanced bodies, character controller |
| `BoidsSwarm` | 2.6k-agent 3D flocking — spatial-hash neighbors, one instanced draw |
| `WebGPUCompute` | WebGPU capability probe + WebGL2 fallback |
| `WebGPUParticlesTSL` | WebGPU-first ~160k-particle TSL nebula (GPU compute + WebGL2 fallback) |
| `PathTraced` | `three-gpu-pathtracer` — physical metal/glass/clearcoat, IBL, progressive GI |
| `SplatField` | 3D Gaussian splat field — additive gaussian billboards |

### Frontier
| Route | What it does |
|---|---|
| `AudioReactive` | Web Audio FFT → DataTexture → displaced-sphere shader (generative pad + mic) |
| `ProceduralWorld` | Marching-cubes isosurface terrain from a 3D fBm field, biome palette, AgX |
| `DepthParallax` | Depth-driven 2.5D parallax + on-demand Depth Anything (transformers.js, WebGPU) |
| `SpatialScene` | WebXR-ready hall — Enter VR/AR + flat-screen orbit fallback |

## Stack
React 19 · Vite 8 · TypeScript (strict) · three r184 · @react-three/fiber 9 · @react-three/drei 10 · @react-three/postprocessing 3 · @react-three/rapier 2 · @react-three/xr 6 · three-gpu-pathtracer · three-mesh-bvh · n8ao · GSAP 3 · Lenis · Framer Motion · vite-plugin-glsl.

## Notes
- WebGPU demos use `WebGPURenderer` + TSL with automatic WebGL2 fallback.
- Demos avoid CDN-fetched HDRIs/fonts so they render reliably offline and in CI.
- Self-hostable static build (`dist/`) — no backend.

## License
MIT
