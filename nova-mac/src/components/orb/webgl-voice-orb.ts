/**
 * WebGLVoiceOrb — a floating, animated WebGL orb for voice-assistant UIs.
 * Ported from the user-supplied orb.js reference (fluid plasma sphere, transparent bg).
 *
 * States: 'idle' (grey, listening/wake) | 'thinking' (purple) | 'speaking' (green)
 * | 'bargein' (orange, user interrupted).
 */

export type OrbVisualState = "idle" | "thinking" | "speaking" | "bargein";

const STATE_COLORS: Record<OrbVisualState, [number, number, number]> = {
  idle: [0.6, 0.61, 0.64],
  thinking: [0.62, 0.36, 1.0],
  speaking: [0.2, 0.9, 0.55],
  bargein: [1.0, 0.55, 0.15],
};

interface Motion {
  swirl: number;
  pulseSpeed: number;
  pulseAmt: number;
  glow: number;
  flicker: number;
}

const STATE_MOTION: Record<OrbVisualState, Motion> = {
  idle: { swirl: 0.16, pulseSpeed: 1.2, pulseAmt: 0.05, glow: 1.0, flicker: 0.35 },
  thinking: { swirl: 0.46, pulseSpeed: 2.6, pulseAmt: 0.09, glow: 1.15, flicker: 0.55 },
  speaking: { swirl: 0.3, pulseSpeed: 6.0, pulseAmt: 0.16, glow: 1.35, flicker: 0.75 },
  bargein: { swirl: 0.6, pulseSpeed: 8.0, pulseAmt: 0.22, glow: 1.55, flicker: 0.9 },
};

const STATE_BREATHE: Record<OrbVisualState, { duration: number; scale: number }> = {
  idle: { duration: 4.2, scale: 1.02 },
  thinking: { duration: 2.0, scale: 1.028 },
  speaking: { duration: 1.3, scale: 1.016 },
  bargein: { duration: 0.85, scale: 1.035 },
};

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = `
precision highp float;
varying vec2 v_uv;

uniform float u_time;
uniform float u_aspect;
uniform vec3  u_color;
uniform float u_swirl;
uniform float u_pulseSpeed;
uniform float u_pulseAmt;
uniform float u_glow;
uniform float u_flicker;
uniform float u_intro;

vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p){
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++){
    v += amp * snoise(p);
    p *= 2.02;
    amp *= 0.52;
  }
  return v;
}

void main(){
  vec2 uv = v_uv;
  uv.x *= u_aspect;

  const float SCALE = 1.72;
  uv *= SCALE;

  float r = length(uv);

  float zc = sqrt(max(0.0, 1.0 - r*r));
  vec3 nrm = normalize(vec3(uv, zc));

  float t = u_time;

  vec3 p = vec3(uv * 2.1, t * u_swirl);
  float warpX = fbm(p + vec3(0.0, 0.0, t*0.15));
  float warpY = fbm(p + vec3(5.2, 1.3, t*0.12));
  vec3 warped = vec3(uv * 2.1 + vec2(warpX, warpY) * 0.9, t * u_swirl * 0.7);
  float n = fbm(warped);
  n = n * 0.5 + 0.5;

  float ang = t * 0.05;
  mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 uvR = rot * uv;

  float sparkle = fbm(vec3(uvR * 8.0, t * 0.4));
  sparkle = smoothstep(0.72, 0.98, sparkle) * u_flicker;

  vec3 lightDir = normalize(vec3(-0.4 + 0.22*sin(t*0.18), 0.55 + 0.16*cos(t*0.15), 0.6));
  float diff = clamp(dot(nrm, lightDir), 0.0, 1.0);
  float fres = pow(1.0 - zc, 2.2);

  float pulse = 1.0 + sin(t * u_pulseSpeed) * u_pulseAmt;

  float spec = pow(diff, 48.0) * 0.85;

  vec3 deep = u_color * 0.07;
  vec3 mid  = u_color * (0.30 + 0.45 * n);
  vec3 rim  = mix(u_color, vec3(1.0), 0.6) * fres * 1.7;

  vec3 col = deep + mid * (0.5 + 0.5*diff) + rim * u_glow;
  col += sparkle * mix(u_color, vec3(1.0), 0.7);
  col += vec3(1.0) * spec;
  col *= pulse;

  float inner = 1.0 - smoothstep(0.86, 1.0, r);
  float outerGlow = exp(-max(r - 1.0, 0.0) * 5.0) * 0.85 * u_glow;
  outerGlow *= step(r, 1.9);

  const float GLASS_ALPHA = 0.62;
  float innerAlpha = mix(0.32, 0.9, fres);
  float alpha = clamp(inner * innerAlpha + outerGlow * 0.7, 0.0, 1.0) * GLASS_ALPHA;
  alpha = clamp(alpha + spec * inner * 0.25, 0.0, 1.0);

  vec3 finalColor = col * inner + (u_color * 1.3) * outerGlow;

  alpha *= u_intro;

  gl_FragColor = vec4(finalColor, alpha);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("Failed to create shader");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("Shader compile error: " + info);
  }
  return sh;
}

let breatheStyleInjected = false;
function ensureBreatheStyle(): void {
  if (breatheStyleInjected) return;
  breatheStyleInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes voice-orb-breathe {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(var(--voice-orb-breathe-scale, 1.02)); }
    }
  `;
  document.head.appendChild(style);
}

export class WebGLVoiceOrb {
  private container: HTMLElement;
  private size: number;
  private wrapper: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private u_time: WebGLUniformLocation | null;
  private u_aspect: WebGLUniformLocation | null;
  private u_color: WebGLUniformLocation | null;
  private u_swirl: WebGLUniformLocation | null;
  private u_pulseSpeed: WebGLUniformLocation | null;
  private u_pulseAmt: WebGLUniformLocation | null;
  private u_glow: WebGLUniformLocation | null;
  private u_flicker: WebGLUniformLocation | null;
  private u_intro: WebGLUniformLocation | null;

  private state: OrbVisualState = "idle";
  private curColor: number[];
  private targetColor: number[];
  private curMotion: Motion;
  private targetMotion: Motion;

  private audioLevel = 0;
  private introProgress = 0;
  private visible = false;
  private aspect = 1;

  private resizeObserver: ResizeObserver;
  private raf = 0;
  private start = 0;

  constructor(container: HTMLElement, opts: { size?: number } = {}) {
    this.container = container;
    this.size = opts.size ?? 320;

    this.wrapper = document.createElement("div");
    this.wrapper.className = "voice-orb-wrapper";
    Object.assign(this.wrapper.style, {
      width: this.size + "px",
      height: this.size + "px",
      opacity: "0",
      transform: "scale(0.75)",
      transition:
        "opacity 420ms cubic-bezier(0.16, 1, 0.3, 1), transform 420ms cubic-bezier(0.16, 1, 0.3, 1)",
      pointerEvents: "none",
      willChange: "opacity, transform",
    });

    ensureBreatheStyle();

    this.canvas = document.createElement("canvas");
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.canvas.style.transformOrigin = "50% 50%";
    this.wrapper.appendChild(this.canvas);
    this.container.appendChild(this.wrapper);

    const glOpts = { alpha: true, premultipliedAlpha: false, antialias: true };
    const gl = (this.canvas.getContext("webgl", glOpts) ??
      this.canvas.getContext("experimental-webgl", glOpts)) as WebGLRenderingContext | null;
    if (!gl) throw new Error("WebGL is not available in this renderer");
    this.gl = gl;

    const prog = gl.createProgram();
    if (!prog) throw new Error("Failed to create WebGL program");
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT_SRC));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("Program link error: " + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    this.u_time = gl.getUniformLocation(prog, "u_time");
    this.u_aspect = gl.getUniformLocation(prog, "u_aspect");
    this.u_color = gl.getUniformLocation(prog, "u_color");
    this.u_swirl = gl.getUniformLocation(prog, "u_swirl");
    this.u_pulseSpeed = gl.getUniformLocation(prog, "u_pulseSpeed");
    this.u_pulseAmt = gl.getUniformLocation(prog, "u_pulseAmt");
    this.u_glow = gl.getUniformLocation(prog, "u_glow");
    this.u_flicker = gl.getUniformLocation(prog, "u_flicker");
    this.u_intro = gl.getUniformLocation(prog, "u_intro");

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.curColor = [...STATE_COLORS.idle];
    this.targetColor = [...STATE_COLORS.idle];
    this.curMotion = { ...STATE_MOTION.idle };
    this.targetMotion = { ...STATE_MOTION.idle };
    this.applyBreathe("idle");

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.wrapper);

    this.start = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 4);
    const SUPERSAMPLE = 2.5;
    const w = Math.max(1, this.wrapper.clientWidth);
    const h = Math.max(1, this.wrapper.clientHeight);
    this.canvas.width = Math.round(w * dpr * SUPERSAMPLE);
    this.canvas.height = Math.round(h * dpr * SUPERSAMPLE);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.aspect = this.canvas.width / this.canvas.height;
  }

  setState(state: OrbVisualState): void {
    if (state === this.state) return;
    this.state = state;
    this.targetColor = STATE_COLORS[state];
    this.targetMotion = STATE_MOTION[state];
    this.applyBreathe(state);
  }

  private applyBreathe(state: OrbVisualState): void {
    const b = STATE_BREATHE[state];
    this.canvas.style.setProperty("--voice-orb-breathe-scale", String(b.scale));
    this.canvas.style.animation = `voice-orb-breathe ${b.duration}s ease-in-out infinite`;
  }

  setAudioLevel(level: number): void {
    this.audioLevel = Math.max(0, Math.min(1, level));
  }

  show(): void {
    this.visible = true;
    this.wrapper.style.opacity = "1";
    this.wrapper.style.transform = "scale(1)";
  }

  hide(): void {
    this.visible = false;
    this.wrapper.style.opacity = "0";
    this.wrapper.style.transform = "scale(0.75)";
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.wrapper.remove();
  }

  private tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    const t = (now - this.start) / 1000;

    const introTarget = this.visible ? 1 : 0;
    this.introProgress += (introTarget - this.introProgress) * 0.12;

    // Higher = snappier state-color transitions (0.06 took ~1s to read as
    // "arrived"; barge-in/thinking need to register almost immediately).
    const lerp = 0.22;
    for (let i = 0; i < 3; i++) {
      this.curColor[i] += (this.targetColor[i]! - this.curColor[i]!) * lerp;
    }
    (Object.keys(this.curMotion) as Array<keyof Motion>).forEach((k) => {
      this.curMotion[k] += (this.targetMotion[k] - this.curMotion[k]) * lerp;
    });

    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const audioBoost = this.state === "speaking" ? this.audioLevel * 0.5 : 0;

    gl.uniform1f(this.u_time, t);
    gl.uniform1f(this.u_aspect, this.aspect);
    gl.uniform3f(this.u_color, this.curColor[0]!, this.curColor[1]!, this.curColor[2]!);
    gl.uniform1f(this.u_swirl, this.curMotion.swirl);
    gl.uniform1f(this.u_pulseSpeed, this.curMotion.pulseSpeed);
    gl.uniform1f(this.u_pulseAmt, this.curMotion.pulseAmt + audioBoost);
    gl.uniform1f(this.u_glow, this.curMotion.glow + audioBoost * 0.6);
    gl.uniform1f(this.u_flicker, this.curMotion.flicker);
    gl.uniform1f(this.u_intro, Math.max(0, this.introProgress));

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}
