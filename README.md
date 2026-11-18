# EchoLab

A guitar-first, browser-based multitrack recording studio. EchoLab is independently developed software and is not affiliated with BandLab, Soundtrap or Positive Grid.

## Milestone 1 — functional browser studio

- Record from a selected microphone / USB audio interface (including Spark GO when the browser exposes it as an input).
- Import audio files, view waveforms, create and rename tracks, mute, solo, adjust gain/pan, and shift clips along a bar grid.
- Loop playback with adjustable tempo and bar count, overdub into a selected track, pause and restart.
- Export a mixed WAV file using OfflineAudioContext.
- Automatically save audio blobs in IndexedDB and project settings locally in your browser. Use the Reset button to clear the current project.

## Requirements

Node.js 20+ and a recent Chrome or Edge browser. Recording requires HTTPS (Vercel) or localhost, microphone permission, and a real audio input.

## Development

```bash
npm install
npm run dev
npm run lint
npm run build
```

## Audio caveats

This is a working MVP, not yet a latency-calibrated DAW. USB monitoring/driver settings must be configured in your operating system. Bluetooth playback is not a low-latency recording input. Overdubs are recorded using MediaRecorder and placed at the transport position; device latency is not yet measured or compensated. For tight guitar looping, measure latency on your Spark GO before relying on this for performance. Projects are device/browser-local, not cloud synced; clearing site data deletes them. Do not treat the browser as the only backup for important recordings—export mixes.

## Roadmap

1. Robust loop scheduling, count-in, monitoring & latency calibration.
2. Non-destructive clip editing, MIDI/piano roll, virtual instruments and effects.
3. Desktop audio engine for ASIO / low-latency Windows recording, plus optional Spark Bluetooth control.
4. Cloud backup, collaboration, AI-assisted arrangement and stem tools.

## Privacy

This version does not upload recorded audio. Browser-local IndexedDB holds the audio, while localStorage holds the arrangement. No authentication or server-side audio storage is enabled.
