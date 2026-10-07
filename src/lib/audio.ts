/** Audio capture: microphone + call/tab audio, and rolling-window PCM pumping. */

export async function acquireMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

/**
 * Capture the audio of a shared tab or screen (the call you're on).
 * Chrome requires a video request to offer audio sharing, so we ask for both
 * and simply never render the video. The user must tick "share tab audio"
 * (or "share system audio" when sharing the whole screen on Windows).
 */
export async function acquireSystemAudio(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    } as MediaTrackConstraints,
  });
}

const TARGET_RATE = 16_000;

/**
 * AudioWorklet that forwards PCM in ~128 ms blocks to the main thread.
 * Inlined as a Blob URL so the app stays a single static bundle.
 */
const WORKLET_CODE = `
class RingFlushProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.fill = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.fill++] = ch[i];
        if (this.fill === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.fill = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('ring-flush', RingFlushProcessor);
`;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export interface WindowPump {
  /** Stops capture; fires one final window with any remaining audio. */
  stop(): void;
}

export interface WindowPumpOptions {
  windowSeconds: number;
  tickSeconds: number;
}

/**
 * Continuously taps `stream`'s audio into a ring buffer (via an AudioWorklet,
 * resampled to 16 kHz mono) and every `tickSeconds` hands the last
 * `windowSeconds` of audio to `onWindow` as a self-contained WAV blob.
 * Windows overlap, so a streaming transcriber can align consecutive results.
 */
export function startWindowPump(
  stream: MediaStream,
  opts: WindowPumpOptions,
  onWindow: (wav: Blob) => void,
  onEnded?: () => void,
): WindowPump {
  let stopped = false;
  let timer: number | null = null;
  let context: AudioContext | null = null;
  const ring: Float32Array[] = [];
  let ringSamples = 0;

  const consume = (data: Float32Array): void => {
    let block = data;
    if (context && context.sampleRate !== TARGET_RATE) {
      // Context wasn't created at 16 kHz — decimate by averaging.
      const ratio = context.sampleRate / TARGET_RATE;
      const outLen = Math.floor(data.length / ratio);
      const out = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(Math.floor((i + 1) * ratio), data.length);
        let sum = 0;
        for (let j = start; j < end; j++) sum += data[j];
        out[i] = sum / Math.max(1, end - start);
      }
      block = out;
    }
    ring.push(block);
    ringSamples += block.length;
    const maxSamples = Math.ceil((opts.windowSeconds + 2) * TARGET_RATE);
    while (ringSamples > maxSamples && ring.length > 1) {
      const dropped = ring.shift();
      if (dropped) ringSamples -= dropped.length;
    }
  };

  const snapshotWav = (): Blob => {
    const want = Math.floor(opts.windowSeconds * TARGET_RATE);
    const flat = new Float32Array(Math.min(want, ringSamples));
    let fill = flat.length;
    for (let i = ring.length - 1; i >= 0 && fill > 0; i--) {
      const chunk = ring[i];
      const take = Math.min(chunk.length, fill);
      flat.set(chunk.subarray(chunk.length - take), fill - take);
      fill -= take;
    }
    return encodeWav(flat, TARGET_RATE);
  };

  const tick = (): void => {
    if (stopped) return;
    if (ringSamples >= TARGET_RATE * 1.5) onWindow(snapshotWav());
  };

  const cleanup = (): void => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    void context?.close().catch(() => undefined);
    context = null;
  };

  const setup = async (): Promise<void> => {
    context = new AudioContext({ sampleRate: TARGET_RATE });
    void context.resume().catch(() => undefined);
    const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    // Everything must terminate at destination for the graph to be pulled;
    // a zero gain node keeps the audio silent (no echo into the call).
    const silent = context.createGain();
    silent.gain.value = 0;
    silent.connect(context.destination);
    try {
      const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(context, 'ring-flush');
      node.port.onmessage = (e) => consume(e.data as Float32Array);
      source.connect(node);
      node.connect(silent);
    } catch {
      // AudioWorklet unavailable — fall back to the deprecated (but working) processor.
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => consume(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(processor);
      processor.connect(silent);
    }
    timer = window.setInterval(tick, opts.tickSeconds * 1000);
  };

  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () => {
      stopped = true;
      cleanup();
      onEnded?.();
    });
  }

  void setup().catch((err: Error) => {
    stopped = true;
    cleanup();
    onEnded?.();
    console.error('Audio pump failed to start', err);
  });

  return {
    stop() {
      stopped = true;
      cleanup();
      if (ringSamples >= TARGET_RATE * 1.5) onWindow(snapshotWav());
    },
  };
}
