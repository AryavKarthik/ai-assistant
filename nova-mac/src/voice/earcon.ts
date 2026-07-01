// ~80ms 440 Hz sine tone encoded as base64 WAV for instant ack feedback
const EARCON_WAV_B64 =
  "UklGRlQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YTAAAAC" +
  "AgICAgICAgIB/fn18e3p5eHd2dXRzcnFwb25tbGtqaWhnZmVkY2JhYF9eXVxbWllYV1ZVVFNSUVBPUE9OTUxLSklIR0ZFRENCQUA/Pj08Ozk4NzY1NDMyMTAvLi0sKyopKCcmJSQjIiEgHx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQ==";

let _earconBuffer: AudioBuffer | null = null;
let _earconCtx: AudioContext | null = null;

export async function playEarcon(): Promise<void> {
  try {
    if (!_earconCtx || _earconCtx.state === "closed") {
      _earconCtx = new AudioContext();
    }
    if (_earconCtx.state === "suspended") await _earconCtx.resume();

    if (!_earconBuffer) {
      const raw = atob(EARCON_WAV_B64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      _earconBuffer = await _earconCtx.decodeAudioData(bytes.buffer);
    }

    const src = _earconCtx.createBufferSource();
    src.buffer = _earconBuffer;
    src.connect(_earconCtx.destination);
    src.start();
  } catch {
    // earcon is best-effort
  }
}
