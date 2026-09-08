'use client'

import { useEffect, useRef } from 'react'

/**
 * Ambient background: the constant-product family x·y = k, drawn as soft
 * contour lines that drift under a slow domain warp. It's the math the whole
 * product runs on, rendered as weather. Full-screen shader quad via three.js;
 * one static frame under reduced-motion; pauses when the tab is hidden.
 */
const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uInk;
uniform vec3 uAccent;
uniform float uDark;
varying vec2 vUv;

float line(float v, float w) {
  float f = fract(v);
  float d = min(f, 1.0 - f);
  return 1.0 - smoothstep(0.0, w, d);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.2;
  float t = uTime * 0.05;
  // slow domain warp
  p += 0.10 * vec2(sin(p.y * 1.7 + t * 1.3), cos(p.x * 1.4 - t * 1.1));
  // shift into the positive quadrant so x*y is a clean hyperbola family
  vec2 q = p + vec2(1.9, 1.5);
  float k = q.x * q.y;
  float v = log(max(k, 1e-3)) * 2.4 + t * 0.6;
  float l1 = line(v, 0.05);
  float l2 = line(v * 0.5 + 0.25, 0.035);
  // fade toward the edges and the center of the viewport (keep text areas calm)
  float vign = smoothstep(1.7, 0.4, length(p)) * 0.55 + 0.45;
  float center = smoothstep(0.15, 0.9, length(vUv - vec2(0.5, 0.42)));
  float a = (l1 * 0.9 + l2 * 0.5) * vign * center;
  float alpha = mix(0.10, 0.16, uDark) * a;
  vec3 col = mix(uInk, uAccent, 0.55);
  gl_FragColor = vec4(col, alpha);
}
`
const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
function hexToRgb(h: string): [number, number, number] {
  const m = h.replace('#', '')
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const v = parseInt(n, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

export default function Ambient() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let raf = 0
    let cleanup: (() => void) | undefined
    const host = ref.current
    if (!host) return

    ;(async () => {
      const THREE = await import('three')
      if (disposed) return
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      renderer.setClearColor(0x000000, 0)
      host.appendChild(renderer.domElement)

      const isDark = () =>
        document.documentElement.dataset.theme === 'dark' ||
        (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)

      const uniforms = {
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uInk: { value: new THREE.Vector3(...hexToRgb(css('--ink') || '#0b0f14')) },
        uAccent: { value: new THREE.Vector3(...hexToRgb(css('--up') || '#00b86b')) },
        uDark: { value: isDark() ? 1 : 0 },
      }
      const scene = new THREE.Scene()
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
      const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false })
      scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat))

      const resize = () => {
        const w = host.clientWidth
        const h = host.clientHeight
        renderer.setSize(w, h, false)
        uniforms.uRes.value.set(w, h)
      }
      resize()

      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
      const start = performance.now()
      let running = true
      const frame = () => {
        if (!running) return
        uniforms.uTime.value = (performance.now() - start) / 1000
        renderer.render(scene, cam)
        if (!reduced) raf = requestAnimationFrame(frame)
      }
      frame()

      const onVis = () => {
        running = !document.hidden
        if (running && !reduced) frame()
      }
      const mq = matchMedia('(prefers-color-scheme: dark)')
      const onTheme = () => {
        uniforms.uDark.value = isDark() ? 1 : 0
        uniforms.uInk.value.set(...hexToRgb(css('--ink')))
        uniforms.uAccent.value.set(...hexToRgb(css('--up')))
        if (reduced) renderer.render(scene, cam)
      }
      window.addEventListener('resize', resize)
      document.addEventListener('visibilitychange', onVis)
      mq.addEventListener('change', onTheme)

      cleanup = () => {
        running = false
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', resize)
        document.removeEventListener('visibilitychange', onVis)
        mq.removeEventListener('change', onTheme)
        mat.dispose()
        renderer.dispose()
        renderer.domElement.remove()
      }
    })()

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [])

  return <div ref={ref} className="ambient" aria-hidden="true" />
}
