# EchoLab Windows Desktop — first packaging milestone

## What it is

EchoLab Desktop wraps the **built static Next.js frontend** inside a secure Electron window with a private `echolab://studio/` protocol. It does not load a remote web application. Audio remains device-local. The Vercel web studio still builds from the same frontend.

This is **not yet an ASIO-native recording engine**. Electron's Chromium Web Audio and MediaRecorder path are still used for recording. The desktop packaging milestone exists to make future audio-engine improvements and USB device configuration possible.

## Build and run

Requirements: Node.js 22, npm, Windows 10/11 for Windows packaging.

```bash
npm install
npm run build
npm run desktop:dev
# On Windows, after npm run build:
npm run desktop:win
```

The `desktop:win` script builds an unsigned NSIS installer in `dist/` from the static `out/` output. Do not distribute it as a signed official release.

## Spark GO setup

1. Plug your guitar into Spark GO.
2. Connect Spark GO via data USB-C to the Windows PC.
3. Follow the vendor's official setup at https://help.positivegrid.com/hc/en-us/articles/15708382773901-Installing-Windows-Driver-for-Spark-GO.
4. Launch EchoLab Desktop, open Studio → Audio settings → Spark GO connection check.
5. Grant microphone permission, detect the device and select it from the input list.
6. Start the input test and strum. The input meter should move.
7. Record and replay a short take; compare timing to a metronome recording.

Drivers are **not bundled**. Electron does not have authority to silently install Windows kernel/audio drivers. Installer elevation and license terms belong to the vendor installer.

## Security

The local renderer is isolated from Node.js, with a sandboxed preload and an allowlisted IPC API for opening two official Positive Grid help pages. Only microphone/media permission is approved. App static file requests resolve inside the packaged `out/` directory.

## Not yet available

- ASIO interface or sample-accurate native audio recorder
- Round-trip latency calibration
- OS-level driver state detection and installation
- Bluetooth amp preset control
- Hardware testing on a Spark GO
- Code-signed Windows installer

## Acceptance gates

- [ ] Windows GitHub Actions workflow completes and outputs installer
- [ ] Installer launches offline and loads `echolab://studio/`
- [ ] Local storage survives app restart
- [ ] Windows microphone permission works
- [ ] Spark GO appears and input meter moves
- [ ] Record and replay a WAV/MP3 session
- [ ] Measure overdub drift and recording latency
