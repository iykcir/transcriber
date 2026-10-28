# Swift Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Electron app with a native SwiftUI macOS app that has the same features, reads the same user data, and keeps whisper-cli, ffmpeg and yt-dlp as the engines.

**Architecture:** One Swift package in `mac/`: a `TranscriberCore` library holding all logic, the transcription pipeline, and an `@Observable` `AppModel`, all unit-tested with Swift Testing. A thin `Transcriber` executable target holds the SwiftUI views and the AppKit/AVFoundation/ScreenCaptureKit glue. A shell script turns the release build into a signed `Transcriber.app`, with `whisper-cli` and `ffmpeg` in `Contents/Helpers`. The Electron app stays in place, untouched, until the parity task (Task 19) deletes it.

**Tech Stack:** Swift 6 language mode, SwiftUI + Observation, AVFoundation/AVKit, ScreenCaptureKit, Translation framework, UserNotifications, PDFKit/Core Text, Swift Testing. No third-party Swift packages.

**Spec:** `README.md` (feature list, which is the source of truth for behavior), `docs/superpowers/specs/2026-10-21-ui-refresh-design.md` (layout, states, controls, visual style), and the current `src/*.js` + `test/*.js`. Where this plan says "port", the JS file and its tests are the exact reference: same values, same copy, same edge cases.

## Global Constraints

- macOS 15.0 minimum (`LSMinimumSystemVersion` 15.0), arm64 only (matches the current `electron-builder.json` target).
- Bundle identifier `com.transcriber.app`, product name `Transcriber`.
- No Xcode required: build with `swift build`, test with `mac/scripts/test.sh`, bundle with `mac/scripts/bundle.sh`. Only the Command Line Tools are installed on the dev machine.
- User data directory is `~/Library/Application Support/Transcriber/` and its file formats are unchanged: `config.json`, `history.json`, `models/<ggml file>`, `bin/yt-dlp`, `bin/yt-dlp-meta.json`. The Swift app must read files the Electron app wrote and vice versa.
- External tools are always launched with an argument array via `Process` and never through a shell.
- whisper.cpp pinned to `v1.7.5` (the version the Electron app ships), built static (`-DBUILD_SHARED_LIBS=OFF`). ffmpeg is the `ffmpeg-static` release `b6.1.1`, asset `ffmpeg-darwin-arm64.gz`.
- Models download from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/<file>`. yt-dlp comes from `https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest`, asset `yt-dlp_macos`, re-checked at most every 24 h. The update check uses `https://api.github.com/repos/iykcir/transcriber/releases/latest`.
- All user-facing strings that exist in the Electron app are copied verbatim (error messages, progress labels, notification text, export headings).
- **Decided changes from the Electron app** (confirm with the user before Task 18 / Task 10):
  - Post-transcription "Translate to English" uses Apple's on-device Translation framework instead of the unofficial Google endpoint.
  - The `ytdl-core` YouTube fallback is dropped. If yt-dlp can't be obtained, YouTube links fail with: `YouTube links need yt-dlp, which couldn't be downloaded. Check your connection and try again.`
  - Word export writes the .docx package by hand and zips it with `/usr/bin/zip`.

## Review Focus

1. **Existing users' data:** a `history.json` and `config.json` written by the Electron app (including unknown keys, and a model name the app doesn't know) load correctly, and saving settings keeps keys the Swift app doesn't know about. Existing models are found, not downloaded again. *(Tests in Tasks 4 and 5.)*
2. **Awkward file names:** paths with spaces, quotes, `–` dashes and non-ASCII characters (`Talk – O'Brien é.aiff`) transcribe correctly. *(Test in Task 12.)*
3. **Cancel at any phase** (conversion, inference, YouTube download) leaves no `whisper-*.wav`, `-raw.*` or `.part` file in the temp dir and no running child process. *(Tests in Tasks 10 and 12.)*
4. **Large output on both pipes:** a child process that writes megabytes to stdout and stderr at once (long whisper runs, raw PCM for waveforms) neither deadlocks nor loses data. *(Test in Task 10.)*
5. **Launched from Finder** with a minimal `PATH`: a Homebrew-installed `yt-dlp` in `/opt/homebrew/bin` is still found as the fallback. *(Test in Task 10.)*

---

## File Structure

```
mac/
  Package.swift
  VERSION                         # marketing version, e.g. 2.0.0
  Transcriber.entitlements
  Info.plist.template
  scripts/
    test.sh                       # swift test, adding CLT Testing.framework flags when needed
    vendor.sh                     # builds whisper-cli, fetches ffmpeg → mac/vendor/bin (gitignored)
    bundle.sh                     # release build → mac/dist/Transcriber.app (signed ad hoc)
    run.sh                        # bundle.sh then open the app
    dmg.sh                        # Transcriber.app → mac/dist/Transcriber-<version>.dmg
  Sources/TranscriberCore/
    WhisperArgs.swift             # Task 1
    TranscriptText.swift          # Task 2
    PeakAccumulator.swift         # Task 3
    HistoryStore.swift            # Task 4
    AppPaths.swift, Settings.swift            # Task 5
    UiLogic.swift, JobNotice.swift            # Task 6
    UpdateCheck.swift, HTTP.swift             # Task 7
    Export/TextExports.swift                  # Task 8
    Export/DocxExport.swift, Export/PdfExport.swift   # Task 9
    Process/ProcessRunner.swift, Process/ToolPaths.swift   # Task 10
    ModelDownloader.swift, YtDlpManager.swift # Task 11
    TranscriptionEngine.swift                 # Tasks 12–13
    AppModel.swift                            # Task 14
  Sources/Transcriber/
    TranscriberApp.swift, AppCommands.swift, SettingsView.swift,
    DockProgress.swift, Notifier.swift, AboutPanel.swift      # Task 14
    ContentView.swift, DropZoneView.swift, LoadedBar.swift,
    ControlsBar.swift, TranscribeButton.swift, TranscriptView.swift,
    ExportMenu.swift, RecentsList.swift, ErrorBanner.swift   # Task 15
    WaveformTrimView.swift, MediaPreview.swift               # Task 16
    MicRecorder.swift, SystemAudioRecorder.swift             # Task 17
    Translator.swift                                         # Task 18
  Tests/TranscriberCoreTests/      # one <Name>Tests.swift per core file
    Fixtures/electron-history.json, Fixtures/electron-config.json
```

---

### Task 0: Package scaffold and test runner

**Files:**
- Create: `mac/Package.swift`, `mac/VERSION` (`2.0.0`), `mac/scripts/test.sh`, `mac/Sources/TranscriberCore/Core.swift`, `mac/Sources/Transcriber/TranscriberApp.swift`, `mac/Tests/TranscriberCoreTests/SmokeTests.swift`
- Modify: `.gitignore` (add `mac/.build/`, `mac/vendor/`, `mac/dist/`)

**Interfaces:**
- Produces: library `TranscriberCore`, executable `Transcriber`, test target `TranscriberCoreTests` (resources: `Fixtures/`). `public let coreVersion = "2.0.0"` is only a placeholder for the smoke test and is deleted in Task 1.

- [ ] **Step 1:** Write `Package.swift`: tools 6.0, `platforms: [.macOS(.v15)]`, the three targets above, test target `resources: [.copy("Fixtures")]`.
- [ ] **Step 2:** Write `scripts/test.sh`. When `xcode-select -p` is `/Library/Developer/CommandLineTools`, it passes `-Xswiftc -F$F -Xlinker -rpath -Xlinker $F` with `F=/Library/Developer/CommandLineTools/Library/Developer/Frameworks`. It forwards `"$@"` to `swift test` and runs from `mac/` regardless of cwd.
- [ ] **Step 3:** Smoke test `@Test func packageBuilds() { #expect(coreVersion == "2.0.0") }`. The app target is a `WindowGroup { Text("Transcriber") }`.
- [ ] **Step 4:** Run `mac/scripts/test.sh` → `1 test … passed`. Run `swift build --package-path mac` → `Build complete!`
- [ ] **Step 5:** Commit `Scaffold Swift package for native rewrite`.

### Task 1: Whisper arguments and model files

**Files:** Create `Sources/TranscriberCore/WhisperArgs.swift`, `Tests/TranscriberCoreTests/WhisperArgsTests.swift`. Delete `Core.swift`/`SmokeTests.swift`.

**Interfaces:**
- Produces:
  - `public enum WhisperModel: String, CaseIterable, Codable, Sendable { case tiny, base, small, medium, turbo; public var fileName: String; public var displayName: String }`
  - `public let maxPromptChars = 600`
  - `public struct WhisperOptions: Sendable { modelPath: String; wavPath: String; language: String; includeTimestamps: Bool; translate: Bool; prompt: String; arch: String = WhisperOptions.currentArch }`
  - `public func buildWhisperArgs(_ o: WhisperOptions) -> [String]`

- [ ] **Step 1:** Port `test/whisper-args.test.js` 1:1 into Swift Testing. Same assertions: `WhisperModel.turbo.fileName == "ggml-large-v3-turbo-q5_0.bin"`, `-ml` `"0"`/`"60"`, `-ng` only when arch ≠ `arm64`, `--no-prints` only for a non-auto language, `--prompt` trimmed and capped at 600, and absent for blank. Test the empty string `""` for both blank and missing (there is no `undefined` in Swift).
- [ ] **Step 2:** Run `mac/scripts/test.sh --filter WhisperArgs` → fails to compile (missing symbols).
- [ ] **Step 3:** Implement by porting `src/whisper-args.js`. Argument order must be identical. `currentArch` comes from `#if arch(arm64)`. Display names come from the README table (`Tiny`, `Base`, `Small`, `Medium`, `Turbo`).
- [ ] **Step 4:** Run the filtered tests → PASS.
- [ ] **Step 5:** Commit `Port whisper argument building to Swift`.

### Task 2: Transcript text (reflow, filler removal, language detection)

**Files:** Create `TranscriptText.swift`, `TranscriptTextTests.swift`.

**Interfaces:**
- Produces: `public func reflowSegments(_ raw: String, minPara: Int = 300, maxPara: Int = 600, pauseSec: Double = 2) -> String`, `public func removeFillers(_ text: String) -> String`, `public func removeFillersFromRaw(_ raw: String) -> String`, `public func detectedLanguage(_ stderr: String) -> String?`

- [ ] **Step 1:** Port every case of `test/transcript-text.test.js`, keeping the same `seg`/`ts`/`raw` helpers and the same expected strings, including the `keep` sentence and the filler-only-line drop.
- [ ] **Step 2:** Run the filtered tests → fail.
- [ ] **Step 3:** Port `src/transcript-text.js` using `Regex` literals with the same patterns (`SEGMENT_RE`, `SENTENCE_END_RE`, `FILLER_RE`, `TOKEN_RE`, `ENDS_SENTENCE_RE`). Measure paragraph length with `.count`. `FILLER_RE` is case-insensitive.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit `Port transcript reflow and filler removal`.

### Task 3: Waveform peak accumulator

**Files:** Create `PeakAccumulator.swift`, `PeakAccumulatorTests.swift`.

**Interfaces:**
- Produces: `public struct PeakAccumulator: Sendable { public init(sampleRate: Int, blockSize: Int = 64); public mutating func push(_ chunk: Data); public mutating func finish(bucketCount: Int) -> Waveform }` and `public struct Waveform: Equatable, Sendable { public var peaks: [Double]; public var duration: Double }`

- [ ] **Step 1:** Port `test/peaks.test.js`, including the odd-byte chunk splits (`cuts = [1, 3, 777, 1001, 4095, 9999, 18001]`) and the empty-input result `Waveform(peaks: [0], duration: 0)`. A `Data` slice with a non-zero `startIndex` takes the place of the odd-`byteOffset` case.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Port `src/peaks.js`. Read samples as little-endian `Int16` byte pairs so alignment can't matter, carry an odd trailing byte forward, and use `abs` on `Int32` so `-32768` maps to `1.0`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Port waveform peak accumulator`.

### Task 4: History store

**Files:** Create `HistoryStore.swift`, `HistoryStoreTests.swift`, `Fixtures/electron-history.json` (two entries copied in shape from a real Electron `history.json`: lowercase UUID `id`, `createdAt` in epoch **milliseconds**, extra unknown key `"pinned": true` on one).

**Interfaces:**
- Produces:
  - `public struct HistoryEntry: Codable, Equatable, Identifiable, Sendable { id, name, fileName, source: String; createdAt: Int64 /* ms */; text: String }`
  - `public struct HistorySummary: Equatable, Identifiable, Sendable { id, name, fileName, source: String; createdAt: Int64; chars: Int }`
  - `public final class HistoryStore: @unchecked Sendable { public init(fileURL: URL, limit: Int = 25, now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }); list() -> [HistorySummary]; get(_ id: String) -> HistoryEntry?; @discardableResult add(name:fileName:source:text:) -> String; @discardableResult update(_ id: String, text: String) -> Bool; remove(_ id: String); clear() }`, with access serialized by an internal lock.

- [ ] **Step 1:** Port `test/history.test.js` 1:1, plus `readsElectronHistoryFile`: copy the fixture to a temp dir. `list()` returns both entries newest first with the correct `chars`, and `get` returns the text. After `add`, the file still decodes as a JSON array whose entries keep the field names `id,name,fileName,source,createdAt,text`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Port `src/history.js`. Write a temp file then rename (`FileManager.replaceItemAt`, or write to `.tmp` then `rename(2)`). A missing or corrupt file reads as `[]`. New ids are `UUID().uuidString.lowercased()`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Port recent-transcripts store`.

### Task 5: App paths and settings

**Files:** Create `AppPaths.swift`, `Settings.swift`, `SettingsTests.swift`, `Fixtures/electron-config.json` (`{"language":"fr","model":"large","timestamps":true,"windowBounds":{"w":900}}`).

**Interfaces:**
- Produces:
  - `public struct AppPaths: Sendable { public let root: URL; public static let standard: AppPaths /* ~/Library/Application Support/Transcriber */; public var models: URL; public var history: URL; public var config: URL; public var bin: URL }`
  - `public struct Settings: Equatable, Sendable { var language = "auto"; var timestamps = false; var model: WhisperModel = .base; var translate = false; var checkUpdates = true; var prompt = ""; var keepHistory = true; var removeFillers = true }`
  - `public final class SettingsStore: @unchecked Sendable { public init(fileURL: URL); public func load() -> Settings; public func save(_ s: Settings) }`
  - `public let supportedLanguages: [(code: String, name: String)]`, listing auto-detect plus the 14 from `src/index.html:881-894`, in that order.

- [ ] **Step 1:** Tests:
  - A missing file → `Settings()` defaults.
  - The fixture → `language == "fr"`, `timestamps == true`, `model == .base` (unknown model falls back), `keepHistory == true`.
  - `save` followed by reading the raw JSON still contains `windowBounds`, and `checkUpdates:false` round-trips.
  - JSON key names are exactly `language,timestamps,model,translate,checkUpdates,prompt,keepHistory,removeFillers`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Implement. Decode via `JSONSerialization` into `[String: Any]` so unknown keys survive. `save` merges into the existing object (the same merge `writeConfig` does in `src/main.js:30`) and writes pretty-printed JSON. Booleans default as in `src/main.js:165-176`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Add settings store compatible with Electron config.json`.

### Task 6: UI logic and job notices

**Files:** Create `UiLogic.swift`, `JobNotice.swift`, `UiLogicTests.swift`, `JobNoticeTests.swift`.

**Interfaces:**
- Produces:
  - `public enum AppState: Sendable { case empty, recording, loaded, transcribing, transcribed }`
  - `public enum ProgressPhase: Sendable { case download, transcribe }`
  - `public func progressText(_ phase: ProgressPhase, _ pct: Int, isStream: Bool) -> String`
  - `public func relativeTime(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String`, always formatted with locale `en_US`
  - `public func canLoadMedia(_ s: AppState) -> Bool`
  - `public struct CommandAvailability: Equatable { public init(state: AppState, settingsOpen: Bool); public let transcribe, export, copy: Bool }` replaces `shortcutAction`. Escape handling is native in SwiftUI. `isCancelledError` and `errorMessage` are not ported (Swift uses `CancellationError` and `LocalizedError`).
  - `public enum JobOutcome: Sendable { case done, failed, cancelled }`, `public struct JobNotice: Equatable { title, body: String }`, `public func jobNotice(outcome: JobOutcome, name: String?, focused: Bool) -> JobNotice?`

- [ ] **Step 1:** Port the `progressText`, `canLoadMedia` and `relativeTime` cases from `test/ui-logic.test.js` (same dates: now = 2026-10-21 15:00 local → `Just now`, `5 min ago`, `3 hr ago`, `Yesterday`, `Oct 3`, `Dec 30, 2025`). Port `test/notify.test.js`. `CommandAvailability`: transcribe only in `.loaded`; export and copy only in `.transcribed`; everything false while `settingsOpen`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Implement. The progress strings use the `…` character, exactly as in JS.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Port UI state logic and job notices`.

### Task 7: Update check

**Files:** Create `HTTP.swift`, `UpdateCheck.swift`, `UpdateCheckTests.swift`.

**Interfaces:**
- Produces:
  - `public typealias Fetch = @Sendable (URLRequest) async throws -> (Data, URLResponse)` and `public let defaultFetch: Fetch` (wraps `URLSession.shared.data(for:)`)
  - `public func isNewerVersion(_ candidate: String?, than current: String) -> Bool`
  - `public struct AvailableUpdate: Equatable, Sendable { version: String; url: URL }`
  - `public func checkForUpdate(currentVersion: String, fetch: Fetch = defaultFetch) async -> AvailableUpdate?`

- [ ] **Step 1:** Port `test/update-check.test.js` with a fake `Fetch`: `HTTPURLResponse` status 200/403, a thrown error, `{}`, and `tag_name: "v9.9.9/../../evil"` → nil. Also check that the request URL is the latest-release endpoint, `timeoutInterval == 10`, and the headers `Accept: application/vnd.github+json` and `User-Agent: transcriber-app`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Port `src/update-check.js`. The release URL is built from the validated tag: `https://github.com/iykcir/transcriber/releases/tag/<tag>`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Port GitHub update check`.

### Task 8: Text, Markdown and SRT export

**Files:** Create `Export/TextExports.swift`, `TextExportsTests.swift`.

**Interfaces:**
- Produces:
  - `public enum ExportFormat: String, CaseIterable, Sendable { case txt, md, srt, docx, pdf; public var ext: String; public var menuTitle: String /* Text, Markdown, Subtitles, Word Document, PDF */; public var contentType: UTType }`
  - `public func transcribedOnLine(_ date: Date) -> String` → `"Transcribed on October 28, 2026"` (en_US, `MMMM d, y`)
  - `public func exportMarkdown(_ transcript: String, title: String, date: Date) -> String`
  - `public func exportSRT(_ transcript: String) -> String`

- [ ] **Step 1:** Port `test/export.test.js` (both SRT cases, same strings). Add a Markdown test: `exportMarkdown("  body \n", title: "Talk", date: <2026-10-28>) == "# Talk\n\n*Transcribed on October 28, 2026*\n\n---\n\nbody\n"`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Port `exportSRT` and `exportMarkdown` from `src/export.js`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Port text, Markdown and SRT export`.

### Task 9: Word and PDF export

**Files:** Create `Export/DocxExport.swift`, `Export/PdfExport.swift`, `DocxExportTests.swift`, `PdfExportTests.swift`.

**Interfaces:**
- Consumes: `transcribedOnLine` (Task 8).
- Produces: `public func exportDOCX(_ transcript: String, title: String, date: Date, to url: URL) throws`, `public func exportPDF(_ transcript: String, title: String, date: Date, to url: URL) throws`

- [ ] **Step 1:** Tests.
  - DOCX: export `"Line <one> & \"two\"\nSecond"` with title `"Q&A"`. Then `/usr/bin/unzip -p out.docx word/document.xml` contains `Q&amp;A`, `Line &lt;one&gt; &amp; &quot;two&quot;`, `Transcribed on`, two body `<w:p>` paragraphs after the date, and `w:val="Heading1"`. `unzip -l` lists `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/styles.xml`.
  - PDF: a 20 000-word transcript gives `PDFDocument(url:)!.pageCount > 1`. Page 1's `string` contains the title, `Transcribed on` and `Page 1 of N`, and the last page contains `Page N of N`.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** DOCX: write the four XML parts into a temp dir and run `/usr/bin/zip -X -r out.docx [Content_Types].xml _rels word` with the temp dir as cwd, via `Process` with an argument array. Formatting matches `exportDOCX` in `src/export.js`:
  - Times New Roman throughout.
  - Title: bold, `w:sz` 48, `Heading1`, spacing after 80.
  - Date: italic, color `666666`, size 20, spacing after 240.
  - Body: one paragraph per line, size 24, spacing after 120, `xml:space="preserve"`.

  PDF: a Core Text frame-per-page layout into a `CGContext(url:mediaBox:)` PDF context, then a second pass for the page footers. Letter 612×792, margins 72.
  - Title: Times-Bold 20.
  - Date: Times-Roman 11, `#666666`.
  - Divider: 0.5 pt `#cccccc`.
  - Body: Times-Roman 12, `#1a1a1a`, line spacing 4.
  - Footer: `Page i of n`, Times-Roman 10, `#999999`, centered at y = 50 from the bottom.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Add Word and PDF export`.

### Task 10: Vendored tools, tool paths and the process runner

**Files:** Create `scripts/vendor.sh`, `Process/ProcessRunner.swift`, `Process/ToolPaths.swift`, `ProcessRunnerTests.swift`, `ToolPathsTests.swift`.

**Interfaces:**
- Produces:
  - `public struct ProcessResult: Sendable { status: Int32; stdout: Data; stderr: Data }`
  - `public func runProcess(_ executable: URL, _ args: [String], environment: [String: String]? = nil, collectStdout: Bool = true, onStdout: (@Sendable (Data) -> Void)? = nil, onStderr: (@Sendable (Data) -> Void)? = nil) async throws -> ProcessResult`. When the calling task is cancelled it sends SIGTERM, then SIGKILL after 2 s, waits for exit and throws `CancellationError`.
  - `public struct ToolPaths: Sendable { whisperCLI: URL; ffmpeg: URL; public static func bundled(_ b: Bundle = .main) -> ToolPaths /* Contents/Helpers */; public static func fromEnvironment() -> ToolPaths? /* $TRANSCRIBER_HELPERS dir */ }`
  - `public func findExecutable(_ name: String, path: String?, extraDirs: [String] = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin"]) -> URL?`

- [ ] **Step 1:** `vendor.sh`:
  - Shallow-clone `https://github.com/ggerganov/whisper.cpp` at tag `v1.7.5` into `mac/vendor/whisper.cpp`, then `cmake -B build -DBUILD_SHARED_LIBS=OFF -DGGML_METAL_EMBED_LIBRARY=ON && cmake --build build --config Release -j`, and copy `build/bin/whisper-cli` to `mac/vendor/bin/`.
  - Download `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz`, gunzip it to `mac/vendor/bin/ffmpeg` and `chmod 755`.
  - Idempotent: skip a binary that already exists.

  Run it. `mac/vendor/bin/whisper-cli --help` and `mac/vendor/bin/ffmpeg -version` both exit 0.
- [ ] **Step 2:** Write the failing tests:
  - `runsAndCollects`: `/bin/echo hi` → status 0, stdout `"hi\n"`.
  - `bothPipesLargeNoDeadlock`: `/bin/sh -c 'head -c 4000000 /dev/zero; head -c 4000000 /dev/zero >&2'` (the shell is the *test's* child process, not app code) → stdout.count == 4_000_000 and stderr.count == 4_000_000, within a 20 s time limit.
  - `streamsWithoutCollecting`: `collectStdout: false` → `onStdout` chunks total 4 000 000 and `result.stdout` is empty.
  - `cancelKillsChild`: start `/bin/sleep 30` in a `Task`, cancel after 0.2 s → throws `CancellationError` within 3 s, and `kill(pid, 0)` then fails (expose the pid through an `onLaunch: (@Sendable (pid_t) -> Void)?` parameter).
  - `argvNotShell`: `/bin/echo` with the argument `"$(rm -rf x); 'q'"` echoes it literally.
  - `findsHomebrewToolWithMinimalPath`: create a temp dir holding an executable `yt-dlp`. `findExecutable("yt-dlp", path: "/usr/bin:/bin", extraDirs: [tmp])` returns it, and returns nil when extraDirs is empty.
- [ ] **Step 3:** Run → fail.
- [ ] **Step 4:** Implement. Read both pipes on their own `readabilityHandler`s, finish on `terminationHandler`, and drain the remaining data after exit. Wrap the run in `withTaskCancellationHandler`. `ToolPaths.bundled` points at `Bundle.main.bundleURL/Contents/Helpers/{whisper-cli,ffmpeg}`.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit `Add vendored tool build, tool paths and cancellable process runner`.

### Task 11: Model downloader and yt-dlp manager

**Files:** Create `ModelDownloader.swift`, `YtDlpManager.swift`, `ModelDownloaderTests.swift`, `YtDlpManagerTests.swift`.

**Interfaces:**
- Consumes: `AppPaths` (Task 5), `Fetch` (Task 7), `findExecutable` (Task 10).
- Produces:
  - `public typealias Download = @Sendable (URL, _ progress: @escaping @Sendable (Int) -> Void) async throws -> URL /* temp file */`. The default uses `URLSession.download(from:delegate:)` and reports a whole-percent value when `Content-Length` is known.
  - `public struct ModelDownloader: Sendable { public init(modelsDir: URL, baseURL: URL = URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main")!, download: Download = defaultDownload); public func isDownloaded(_ m: WhisperModel) -> Bool; public func ensure(_ m: WhisperModel, onProgress: @escaping @Sendable (Int) -> Void) async throws -> URL }`
  - `public actor YtDlpManager { public init(binDir: URL, fetch: Fetch = defaultFetch, download: Download = defaultDownload, now: @escaping @Sendable () -> Date = { .now }, systemPath: String? = ProcessInfo.processInfo.environment["PATH"]); public func ensure() async -> URL? }`

- [ ] **Step 1:** Write the failing tests.
  - Model:
    - A file already present at `models/ggml-base.bin` → `download` is never called and the result is that path.
    - Success → the final file exists, no `.download` file remains, and progress reports reach 100.
    - `download` throws → no final file and no `.download` file.
    - A stale `ggml-base.bin.download` left over from a crash is not treated as the model.
  - yt-dlp:
    - Binary present and `yt-dlp-meta.json` `{"tag":"2026.10.01","checkedAt":<now-1h ms>}` → no fetch.
    - Stale check with the same tag → no download, and `checkedAt` is updated.
    - Newer tag → downloads the `yt-dlp_macos` asset, sets mode 0755 and writes the meta.
    - Fetch throws with no binary and a `systemPath` holding a fake `yt-dlp` → returns the system one.
    - Nothing anywhere (and `extraDirs` empty via an internal init) → nil.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Implement by porting `downloadModel` and `ensureYtdlp` from `src/transcribe.js`. Write to `<file>.download` and move it into place. The meta JSON keys `tag` and `checkedAt` (ms) stay the same so the Electron app's file is reused.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Add model downloader and managed yt-dlp`.

### Task 12: Transcription engine

**Files:** Create `TranscriptionEngine.swift`, `TranscriptionEngineTests.swift` (unit tests), `TranscriptionIntegrationTests.swift` (runs only when `TRANSCRIBER_HELPERS` is set and `ggml-tiny.bin` exists in `AppPaths.standard.models`).

**Interfaces:**
- Consumes: Tasks 1, 2, 5, 10, 11.
- Produces:
  - `public enum MediaSource: Equatable, Sendable { case file(URL), remote(URL); public var isYouTube: Bool; public var isStream: Bool }`. YouTube detection uses `YOUTUBE_RE` from `src/transcribe.js:87`.
  - `public struct TranscribeRequest: Sendable { source: MediaSource; start: Double?; end: Double?; settings: Settings }`
  - `public enum TranscribeEvent: Sendable { case downloadingModel(Int), progress(Int) }`
  - `public enum TranscribeError: LocalizedError, Equatable { case whisperMissing, conversionFailed, urlLoadFailed, youTubeUnavailable, whisperFailed(code: Int32, tail: String) }`. Its messages are verbatim from `src/transcribe.js` (`Audio conversion failed. The file may be corrupted or in an unsupported format.`, `Could not load URL. Check the link is accessible and points to audio or video.`, `whisper-cli exited with code N.\n<last 300 chars of stderr>`), plus the YouTube copy from Global Constraints.
  - `public protocol TranscriptionServing: Sendable { func transcribe(_ r: TranscribeRequest, onEvent: @escaping @Sendable (TranscribeEvent) -> Void) async throws -> String; func waveform(for s: MediaSource, buckets: Int) async throws -> (Waveform, previewURL: URL) }`
  - `public actor TranscriptionEngine: TranscriptionServing { public init(tools: ToolPaths, models: ModelDownloader, ytdlp: YtDlpManager, tempDir: URL = FileManager.default.temporaryDirectory) }`
  - `static func ffmpegWavArgs(input: String, output: String, start: Double?, end: Double?) -> [String]` (internal, tested)

- [ ] **Step 1:** Unit tests (no binaries needed):
  - `ffmpegWavArgs` with start 5 and end 12 → `["-nostats","-loglevel","error","-y","-i",IN,"-ss","5.0","-t","7.0","-ar","16000","-ac","1","-c:a","pcm_s16le",OUT]` (numbers formatted with no exponent; assert parsed `Double`s).
  - `MediaSource.isYouTube` for `youtu.be/<11 chars>`, `youtube.com/shorts/<11>` and `watch?v=` → true; `https://example.com/a.mp3` → false.
  - Fake-whisper flow: point `ToolPaths.whisperCLI` at a test-written script that prints `progress = 50%` to stderr and two segment lines to stdout. Events are `progress(0)`, `progress(5)`, `progress(52)` (5 + round(50 × 0.94)), `progress(100)`, and the result is the reflowed text. With `removeFillers` on and `language: "de"`, fillers are kept.
  - The model-missing path emits `downloadingModel(0)` first.
- [ ] **Step 2:** Integration tests (gated):
  - Generate `Talk – O'Brien é.aiff` in a temp dir with `/usr/bin/say -o <path> "Hello world. This is a test."`. Transcribe with `.tiny` and `language: "en"`. The lowercased result contains `hello` and `test`.
  - Trim: `start: 0, end: 1.0` gives a shorter result.
  - Cancel during conversion: transcribe a 10-minute generated file (`ffmpeg -f lavfi -i sine=d=600`), cancel after 0.3 s → `CancellationError`, with no `whisper-*.wav` in `tempDir` afterwards.
  - Cancel during inference → the same check, and no `whisper-cli` process remains (`pgrep -f <unique wav name>` is empty).
- [ ] **Step 3:** Run both → fail.
- [ ] **Step 4:** Implement by porting `transcribeAudio`, `convertToWav`, `ffmpegToWav`, `downloadYouTube` (the yt-dlp path only: `-x --audio-format best -o <tmp>/whisper-<ts>-raw.%(ext)s --no-playlist URL`, deleting `-raw.*`/`.part` siblings on failure or cancel) and `runWhisper`.
  - Progress milestones are 0 → 2 (converting) → 5 → 5 + round(p × 0.94) → 100.
  - A local `.wav` with no trim skips conversion.
  - Filler removal applies only when `translate` is on or the spoken language (explicit, or `detectedLanguage(stderr)` in auto mode) is `en`.
  - Empty output → `(no speech detected)`. Timestamps off → `reflowSegments(raw)` (raw text if that comes back empty).
  - The model download runs in `Task.detached` and is awaited, so a cancel doesn't interrupt it (the model still finishes and is cached). `Task.checkCancellation()` runs right after it.
  - Remove the temp WAV in `defer`.
- [ ] **Step 5:** Run `mac/scripts/test.sh` → unit tests PASS. Run `TRANSCRIBER_HELPERS=$PWD/mac/vendor/bin mac/scripts/test.sh --filter Integration` → PASS.
- [ ] **Step 6:** Commit `Add transcription engine`.

### Task 13: Waveform peaks and the YouTube preview cache

**Files:** Modify `TranscriptionEngine.swift`; create `WaveformTests.swift`.

**Interfaces:**
- Consumes: `PeakAccumulator` (Task 3), `runProcess(collectStdout: false, onStdout:)` (Task 10).
- Produces: `TranscriptionEngine.waveform(for:buckets:)` (default `buckets` 800). For a YouTube source, the downloaded WAV is cached by URL and reused by the next `transcribe` of the same URL. The previous cache file is deleted when another URL is previewed.

- [ ] **Step 1:** Gated test: the `say` fixture → `peaks.count == 800` (or the sample count if that's smaller), `0 < duration < 5`, and `previewURL == input`. A non-media file throws with the message `Could not read audio for waveform preview.`
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Port `computePeaksFromLocalFile` (ffmpeg args `-nostats -loglevel error -vn -i IN -ar 8000 -ac 1 -f s16le pipe:1`) and `getWaveformPeaks`, feeding chunks to the accumulator as they arrive.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `Add waveform peaks and YouTube preview cache`.

### Task 14: App model, bundle script and app shell

**Files:**
- Create `Sources/TranscriberCore/AppModel.swift`, `Tests/.../AppModelTests.swift`.
- Create `mac/Info.plist.template`, `mac/Transcriber.entitlements`, `mac/scripts/bundle.sh`, `mac/scripts/run.sh`.
- Create the Task 14 files under `Sources/Transcriber/` (see File Structure).

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `@MainActor @Observable public final class AppModel`, initialised with `init(engine: TranscriptionServing, history: HistoryStore, settingsStore: SettingsStore)`.
  - State: `state: AppState`, `media: LoadedMedia?` (`name`, `byteSize: Int64?`, `source: MediaSource`, `waveform: Waveform?`, `previewURL: URL?`, `isVideo: Bool`), `start: Double?`, `end: Double?`, `transcript: String`, `progressLabel: String?`, `progressFraction: Double`, `errorMessage: String?`, `recents: [HistorySummary]`, `settings: Settings` (its `didSet` saves, and turning `keepHistory` off clears history and recents), `currentHistoryID: String?`.
  - Actions:
    - `load(_ s: MediaSource) async` (ignored unless `canLoadMedia`)
    - `transcribe() async`, `cancel()`, `close()`
    - `openRecent(_ id: String)`, `removeRecent(_ id: String)`
    - `editTranscript(_ text: String)` (saves to history)
    - `beginRecording()`, `finishRecording(_ file: URL?) async`
    - `onJobFinished: ((JobOutcome, String) -> Void)?`, used by the app for the Dock and notifications
  - `public var commands: CommandAvailability`.

- [ ] **Step 1:** `AppModelTests` with a fake `TranscriptionServing`:
  - load → `.loaded` with the waveform set.
  - transcribe success → `.transcribed`, history gets one entry with `name`, `fileName` (name without extension) and `source`, and `onJobFinished(.done, name)` fires.
  - The engine throws `CancellationError` → back to `.loaded`, `errorMessage == nil`, `.cancelled`.
  - The engine throws `TranscribeError.conversionFailed` → `.loaded` with `errorMessage` set to that message.
  - `keepHistory = false` → recents empty and nothing added on the next run.
  - `load` while `.transcribing` → ignored.
  - `editTranscript` → `history.get(id)!.text` is updated.
  - Progress events map to `progressLabel` via `progressText`, with `isStream` true for `.remote`.
- [ ] **Step 2:** Run → fail. Implement `AppModel` → PASS.
- [ ] **Step 3:** `bundle.sh`:
  - Run `swift build -c release --arch arm64 --package-path mac`.
  - Assemble `mac/dist/Transcriber.app`: `Contents/MacOS/Transcriber`, `Contents/Helpers/{whisper-cli,ffmpeg}` from `mac/vendor/bin`, `Contents/Resources/icon.icns` from `assets/icon.icns`, and `Info.plist` from the template with the version from `mac/VERSION`.
  - The Info.plist sets `CFBundleIdentifier com.transcriber.app`, `LSMinimumSystemVersion 15.0`, `CFBundleIconFile icon` and `NSMicrophoneUsageDescription "Transcriber records from your microphone so it can transcribe what you say."`.
  - Sign the helpers first, then the app: `codesign --force --options runtime --entitlements mac/Transcriber.entitlements -s -`. The entitlements are `com.apple.security.device.audio-input` only.
  - `run.sh` runs `bundle.sh`, then `open mac/dist/Transcriber.app`.
- [ ] **Step 4:** App shell:
  - Window 900×700, minimum 700×550, hidden title bar, translucent background.
  - A `Settings` scene with the Timestamps, Translate to English, Remove filler words, Keep recent transcripts and Check for updates toggles (⌘,).
  - Menus mirror `src/main.js:72-152`, using `CommandAvailability` to enable Open Audio… ⌘O, Transcribe ⌘↩, Export ⌘S and Copy ⌘⇧C. Help → whisper.cpp on GitHub. About uses the standard panel with credits `Offline audio transcription powered by whisper.cpp.`
  - `DockProgress` draws a progress bar over the app icon (`NSDockTile.contentView`).
  - `Notifier` uses `UNUserNotificationCenter` with `jobNotice` (focused = `NSApp.isActive`). Clicking a notification activates the window.
  - The launch update check runs after 3 s when enabled, and a banner opens the release URL.
- [ ] **Step 5:** Verify: `mac/scripts/run.sh` opens a window. ⌘, opens Settings, and a toggled setting appears in `config.json`. `codesign --verify --deep --strict mac/dist/Transcriber.app` exits 0.
- [ ] **Step 6:** Commit `Add app model, bundling and app shell`.

### Task 15: Main window: load, transcribe, edit, export, recents

**Files:** Create the Task 15 files under `Sources/Transcriber/`.

**Interfaces:**
- Consumes: `AppModel` (Task 14), `ExportFormat` and the export functions (Tasks 8–9), `supportedLanguages` (Task 5).

- [ ] **Step 1:** Build the views to the UI spec's Layout, States and Controls sections:
  - The drop zone accepts drops anywhere in the window and opens a file dialog when clicked. Allowed extensions are the list in `src/main.js:101`.
  - The URL field loads on Enter or **Load**.
  - The loaded state collapses to a slim bar showing the name and size, with **Change** and **×**.
  - Model and Language pickers and the Spelling hints field sit beside Transcribe. The hints field shows the explanation from `src/index.html` while it has focus and text.
  - The Transcribe button fills as a progress bar showing `progressLabel`, with Cancel next to it.
  - The transcript is an editable `TextEditor`. Edits save to history, debounced by 500 ms.
  - The Export menu (⌘S) lists `ExportFormat.allCases`. It uses an `NSSavePanel` with default name `<fileName>.<ext>` and title `Save Transcript as <menuTitle>`.
  - Copy (⌘⇧C) puts the transcript on the pasteboard.
  - Recents appear under the drop zone when nothing is loaded, with `relativeTime` and a hover **×**.
  - Errors show in a dismissible banner.
- [ ] **Step 2:** Verify with `run.sh`, step by step:
  - Drop the `say` fixture → it loads. Transcribe with Tiny → the bar fills and the text appears.
  - Edit the text, quit and reopen → the recent entry shows the edit.
  - Export each of the 5 formats → each file opens (TextEdit, Pages/Word, Preview).
  - Cancel mid-run → the state returns to loaded with no error.
  - An Electron-era recent entry opens.
- [ ] **Step 3:** Commit `Build main window`.

### Task 16: Trim waveform and media preview

**Files:** Create `WaveformTrimView.swift`, `MediaPreview.swift`.

**Interfaces:**
- Consumes: `AppModel.media.waveform`, `previewURL`, `isVideo`, `start`, `end`.

- [ ] **Step 1:**
  - `WaveformTrimView` is a `Canvas` that draws the peaks, dims the area outside the selection, and has two draggable handles. Handles clamp to `0…duration` and keep at least 0.5 s between them.
  - Dragging a handle plays a 0.6 s snippet from the handle's position.
  - The play/pause button plays the selection and stops at `end`.
  - `MediaPreview` shows an `AVPlayerView` (wrapped with `NSViewRepresentable`) above the waveform for video files. Audio files get a hidden `AVPlayer`.
  - `start`/`end` are nil when the selection covers the whole file, so no trim is passed.
- [ ] **Step 2:** Verify with `run.sh`:
  - Trim the fixture to its second half, then transcribe → only the second sentence.
  - An `.mp4` shows video.
  - A YouTube URL loads its waveform once, and transcribing it does not download again (watch for a single `yt-dlp` process).
- [ ] **Step 3:** Commit `Add trim waveform and media preview`.

### Task 17: Microphone and system-audio recording

**Files:** Create `MicRecorder.swift`, `SystemAudioRecorder.swift`.

**Interfaces:**
- Consumes: `AppModel.beginRecording()`, `finishRecording(_:)`.
- Produces: `@MainActor final class MicRecorder { func start() throws; func stop() -> URL }`, `@MainActor final class SystemAudioRecorder { func start() async throws; func stop() async -> URL? }`, with an `elapsed: TimeInterval` property for the timer.

- [ ] **Step 1:**
  - Mic: `AVAudioRecorder` writing AAC `.m4a` to `tmp/recording-<ts>.m4a`.
  - System audio: `SCShareableContent` picks the main display; `SCStream` with `capturesAudio = true`, `excludesCurrentProcessAudio = true`, and a 2×2 video size at 1 fps; audio sample buffers are written through `AVAssetWriter` to `.m4a`.
  - The recording state shows a red dot, an `m:ss` timer and Stop.
  - Permission errors use the Electron copy: `Microphone access denied. Check System Settings → Privacy & Security → Microphone.` / `Screen recording access denied. Check System Settings → Privacy & Security → Screen Recording.` If a system recording contains no audio, show `No audio captured.`
- [ ] **Step 2:** Verify with `run.sh`:
  - Record 5 s of speech from the mic → it loads, then transcribes.
  - Play a YouTube video in Safari, capture system audio for 10 s → it transcribes.
  - Deny the mic permission in System Settings → the error banner shows the copy above.
- [ ] **Step 3:** Commit `Add microphone and system audio recording`.

### Task 18: Translate a finished transcript

**Files:** Create `Translator.swift`; modify `TranscriptView.swift`.

- [ ] **Step 1:** Add a **Translate to English** button on a finished transcript. It uses `.translationTask(configuration)` with source `nil` (auto) and target `en`, translates paragraph by paragraph (`split(separator: "\n\n")`) and joins with `\n\n`, so timestamps and layout survive. The result replaces the transcript and saves to history. If the language pack is missing, the system download sheet appears.
- [ ] **Step 2:** Verify: transcribe a French clip (`say -v Thomas -o fr.aiff "Bonjour tout le monde"`), translate → English text, and the recent entry shows the translation after reopening.
- [ ] **Step 3:** Commit `Add on-device translation`.

### Task 19: Parity check, DMG and Electron removal

**Files:** Create `mac/scripts/dmg.sh`. Modify `README.md`, `.claude/skills/run-app/` (point it at `mac/scripts/run.sh`). Delete `src/`, `test/`, `package.json`, `package-lock.json`, `electron-builder.json`, `eslint.config.js`, `jsconfig.json`, `generate-icon.js`, `build/`.

- [ ] **Step 1:** Walk the README feature list top to bottom against the built app and tick each item in the PR description. Any gap goes back to the task that owns it.
- [ ] **Step 2:** `dmg.sh`: `hdiutil create -volname "Transcriber <version>" -srcfolder mac/dist/Transcriber.app -format ULFO mac/dist/Transcriber-<version>.dmg`. Verify that it mounts and the app launches from it.
- [ ] **Step 3:** Delete the Electron files. Update the README: requirements (macOS 15, Apple Silicon), build instructions (`vendor.sh`, `bundle.sh`), the translation now being on-device, and the File size section (ffmpeg is still bundled). Run `mac/scripts/test.sh` → all PASS.
- [ ] **Step 4:** Commit `Replace Electron app with native Swift app` and bump the version to 2.0.0, following the repo's `Bump version` commit pattern.
