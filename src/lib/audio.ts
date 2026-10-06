/** Audio capture: microphone + call/tab audio, and chunked recording. */

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

function pickAudioMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported) {
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c;
    }
  }
  return '';
}

export interface ChunkPump {
  stop(): void;
}

/**
 * Record `stream`'s audio as a sequence of self-contained blobs of roughly
 * `chunkSeconds` each. MediaRecorder's built-in timeslicing emits headerless
 * chunks that transcription APIs can't decode individually, so we instead
 * restart the recorder every cycle — each blob is a complete, decodable file.
 */
export function startChunkPump(
  stream: MediaStream,
  chunkSeconds: number,
  onChunk: (blob: Blob) => void,
  onEnded?: () => void,
): ChunkPump {
  const audioOnly = new MediaStream(stream.getAudioTracks());
  const mime = pickAudioMime();
  let recorder: MediaRecorder | null = null;
  let stopped = false;

  const spawn = () => {
    if (stopped) return;
    const options: MediaRecorderOptions = { audioBitsPerSecond: 96_000 };
    if (mime) options.mimeType = mime;
    try {
      recorder = new MediaRecorder(audioOnly, options);
    } catch {
      recorder = new MediaRecorder(audioOnly);
    }
    const local = recorder;
    let rotated = false;
    const rotate = () => {
      if (rotated) return;
      rotated = true;
      if (local.state !== 'inactive') {
        try {
          local.stop(); // fires a final ondataavailable with the tail
        } catch {
          // already stopped
        }
      }
      if (!stopped) spawn();
    };
    local.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) onChunk(e.data);
    };
    local.onerror = () => rotate();
    local.start(chunkSeconds * 1000);
    window.setTimeout(rotate, chunkSeconds * 1000 + 250);
  };

  for (const track of stream.getAudioTracks()) {
    track.addEventListener('ended', () => {
      stopped = true;
      try {
        recorder?.stop();
      } catch {
        // noop
      }
      onEnded?.();
    });
  }

  spawn();
  return {
    stop() {
      stopped = true;
      try {
        recorder?.stop();
      } catch {
        // noop
      }
    },
  };
}
