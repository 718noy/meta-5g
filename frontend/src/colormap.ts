// RSRP/SINR 컬러맵 — RF 플래닝 관례(강함=빨강 → 약함=파랑 → 임계 이하 투명).
// JS(범례·HUD)와 GLSL(볼륨·슬라이스 셰이더) 양쪽에서 동일한 정의를 사용한다.

export interface ColorStop {
  t: number
  rgba: [number, number, number, number]
}

export const STOPS: ColorStop[] = [
  { t: 0.0, rgba: [0.03, 0.05, 0.3, 0.0] },
  { t: 0.15, rgba: [0.1, 0.25, 0.85, 0.22] },
  { t: 0.35, rgba: [0.0, 0.75, 0.9, 0.4] },
  { t: 0.5, rgba: [0.15, 0.85, 0.3, 0.52] },
  { t: 0.65, rgba: [0.95, 0.88, 0.1, 0.62] },
  { t: 0.8, rgba: [1.0, 0.5, 0.05, 0.75] },
  { t: 1.0, rgba: [0.9, 0.05, 0.05, 0.88] },
]

// 표시 범위 (컬러맵 정규화 기준)
export const RSRP_VIZ_MIN = -115
export const RSRP_VIZ_MAX = -45
export const SINR_VIZ_MIN = -10
export const SINR_VIZ_MAX = 40

export function mapColor(t: number): [number, number, number, number] {
  const x = Math.min(Math.max(t, 0), 1)
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i].t) {
      const a = STOPS[i - 1]
      const b = STOPS[i]
      const f = (x - a.t) / (b.t - a.t)
      return [
        a.rgba[0] + (b.rgba[0] - a.rgba[0]) * f,
        a.rgba[1] + (b.rgba[1] - a.rgba[1]) * f,
        a.rgba[2] + (b.rgba[2] - a.rgba[2]) * f,
        a.rgba[3] + (b.rgba[3] - a.rgba[3]) * f,
      ]
    }
  }
  return STOPS[STOPS.length - 1].rgba
}

export function cssGradient(): string {
  const parts = STOPS.map(
    (s) =>
      `rgba(${Math.round(s.rgba[0] * 255)},${Math.round(s.rgba[1] * 255)},${Math.round(
        s.rgba[2] * 255,
      )},${Math.max(s.rgba[3], 0.15).toFixed(2)}) ${(s.t * 100).toFixed(0)}%`,
  )
  return `linear-gradient(to right, ${parts.join(', ')})`
}

// 셀별(라디오별) 오라 색 — 서로 잘 구분되는 16색. 셀 인덱스로 순환.
export const CELL_COLORS: [number, number, number][] = [
  [0.30, 0.64, 1.0], // blue
  [1.0, 0.54, 0.24], // orange
  [0.17, 0.84, 0.5], // green
  [0.69, 0.43, 1.0], // purple
  [1.0, 0.82, 0.24], // yellow
  [1.0, 0.36, 0.54], // pink
  [0.24, 0.84, 0.82], // teal
  [0.54, 1.0, 0.24], // lime
  [1.0, 0.42, 0.42], // red
  [0.63, 0.66, 1.0], // periwinkle
  [1.0, 0.63, 0.82], // rose
  [0.36, 1.0, 0.81], // mint
  [0.82, 0.63, 0.24], // gold
  [0.43, 1.0, 0.62], // seagreen
  [1.0, 0.62, 0.43], // salmon
  [0.62, 0.43, 1.0], // violet
]

export function cellColorCss(idx: number): string {
  const [r, g, b] = CELL_COLORS[((idx % CELL_COLORS.length) + CELL_COLORS.length) % CELL_COLORS.length]
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`
}

// GLSL 상수 배열 (셀 색)
export const GLSL_CELL_COLORS = `
const vec3 CELL_COLORS[16] = vec3[16](
  vec3(0.30,0.64,1.0), vec3(1.0,0.54,0.24), vec3(0.17,0.84,0.5), vec3(0.69,0.43,1.0),
  vec3(1.0,0.82,0.24), vec3(1.0,0.36,0.54), vec3(0.24,0.84,0.82), vec3(0.54,1.0,0.24),
  vec3(1.0,0.42,0.42), vec3(0.63,0.66,1.0), vec3(1.0,0.63,0.82), vec3(0.36,1.0,0.81),
  vec3(0.82,0.63,0.24), vec3(0.43,1.0,0.62), vec3(1.0,0.62,0.43), vec3(0.62,0.43,1.0)
);
`

export function rsrpColorCss(rsrp: number): string {
  const t = (rsrp - RSRP_VIZ_MIN) / (RSRP_VIZ_MAX - RSRP_VIZ_MIN)
  let [r, g, b] = mapColor(t)
  // 어두운 텍스트 색(파란 저신호 등)은 다크 배경에서 안 보이므로 밝기 하한 적용
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  if (lum < 0.5) {
    const f = 0.5 / Math.max(lum, 0.06)
    r = Math.min(r * f, 1)
    g = Math.min(g * f, 1)
    b = Math.min(b * f, 1)
  }
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`
}

// GLSL: colormap(t) → vec4
export const GLSL_COLORMAP = `
vec4 colormap(float t) {
  t = clamp(t, 0.0, 1.0);
  vec4 c0 = vec4(0.03, 0.05, 0.3, 0.0);
  vec4 c1 = vec4(0.1, 0.25, 0.85, 0.22);
  vec4 c2 = vec4(0.0, 0.75, 0.9, 0.4);
  vec4 c3 = vec4(0.15, 0.85, 0.3, 0.52);
  vec4 c4 = vec4(0.95, 0.88, 0.1, 0.62);
  vec4 c5 = vec4(1.0, 0.5, 0.05, 0.75);
  vec4 c6 = vec4(0.9, 0.05, 0.05, 0.88);
  if (t < 0.15) return mix(c0, c1, t / 0.15);
  if (t < 0.35) return mix(c1, c2, (t - 0.15) / 0.2);
  if (t < 0.5)  return mix(c2, c3, (t - 0.35) / 0.15);
  if (t < 0.65) return mix(c3, c4, (t - 0.5) / 0.15);
  if (t < 0.8)  return mix(c4, c5, (t - 0.65) / 0.15);
  return mix(c5, c6, (t - 0.8) / 0.2);
}
`
