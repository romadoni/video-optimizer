import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const ffmpeg = new FFmpeg();

/*
|--------------------------------------------------------------------------
| Global debug access
|--------------------------------------------------------------------------
*/

window.ffmpeg = ffmpeg;

/*
|--------------------------------------------------------------------------
| DOM
|--------------------------------------------------------------------------
*/

const videoInput = document.getElementById("videoInput");
const chooseButton = document.getElementById("chooseButton");
const dropZone = document.getElementById("dropZone");

const analysisCard = document.getElementById("analysisCard");
const compressCard = document.getElementById("compressCard");

const compressionMode = document.getElementById("compressionMode");
const targetSizeField = document.getElementById("targetSizeField");
const targetSize = document.getElementById("targetSize");
const crf = document.getElementById("crf");
const videoEncoder = document.getElementById("videoEncoder");
const preset = document.getElementById("preset");
const audioBitrate = document.getElementById("audioBitrate");

const encodeButton = document.getElementById("encodeButton");

const progressContainer = document.getElementById("progressContainer");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const status = document.getElementById("status");

const resultCard = document.getElementById("resultCard");
const resultVideo = document.getElementById("resultVideo");
const downloadLink = document.getElementById("downloadLink");

const fileSize = document.getElementById("metaSize");
const duration = document.getElementById("metaDuration");
const resolution = document.getElementById("metaResolution");
const frameRate = document.getElementById("metaFPS");
const videoCodec = document.getElementById("metaVideoCodec");
const videoBitrate = document.getElementById("metaVideoBitrate");
const audioCodec = document.getElementById("metaAudioCodec");
const audioBitrateInfo = document.getElementById("metaAudioBitrate");

const rawMetadata = document.getElementById("rawMetadata");

const estimateOriginal = document.getElementById("estimateOriginal");
const estimateTarget = document.getElementById("estimateTarget");
const estimateBitrate = document.getElementById("estimateBitrate");
const estimateReduction = document.getElementById("estimateReduction");

const resultOriginal = document.getElementById("resultOriginal");
const resultOutput = document.getElementById("resultOutput");
const resultSaved = document.getElementById("resultSaved");
const resultStatus = document.getElementById("resultStatus");

/*
|--------------------------------------------------------------------------
| State
|--------------------------------------------------------------------------
*/

let selectedFile = null;
let inputFileName = null;
let inputDuration = 0;
let inputVideoBitrate = 0;
let outputUrl = null;

let ffmpegLoaded = false;
let ffmpegLoadingPromise = null;

let lastLogMessage = "";
let lastErrorMessages = [];

let currentProgress = 0;
let currentFrame = 0;
let currentFps = 0;
let currentSpeed = 0;
let currentEncodingTime = 0;

/*
|--------------------------------------------------------------------------
| Encoder presets
|--------------------------------------------------------------------------
*/

const ENCODER_PRESETS = {
    libx264: [
        "ultrafast",
        "superfast",
        "veryfast",
        "faster",
        "fast",
        "medium",
        "slow",
        "slower",
        "veryslow",
        "placebo",
    ],

    libx265: [
        "ultrafast",
        "superfast",
        "veryfast",
        "faster",
        "fast",
        "medium",
        "slow",
        "slower",
        "veryslow",
        "placebo",
    ],
};

/*
|--------------------------------------------------------------------------
| Utility
|--------------------------------------------------------------------------
*/

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return "-";
    }

    if (bytes === 0) {
        return "0 B";
    }

    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.floor(
        Math.log(bytes) / Math.log(1024)
    );

    const safeIndex = Math.min(index, units.length - 1);

    return `${(
        bytes / Math.pow(1024, safeIndex)
    ).toFixed(safeIndex === 0 ? 0 : 2)} ${units[safeIndex]}`;
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "-";
    }

    const totalSeconds = Math.floor(seconds);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hours > 0) {
        return [
            String(hours).padStart(2, "0"),
            String(minutes).padStart(2, "0"),
            String(secs).padStart(2, "0"),
        ].join(":");
    }

    return [
        String(minutes).padStart(2, "0"),
        String(secs).padStart(2, "0"),
    ].join(":");
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "00:00";
    }

    return formatDuration(seconds);
}

function formatBitrate(bitsPerSecond) {
    if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) {
        return "-";
    }

    if (bitsPerSecond >= 1_000_000) {
        return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`;
    }

    return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

function parseFrameRate(value) {
    if (!value) {
        return 0;
    }

    if (typeof value === "number") {
        return value;
    }

    if (String(value).includes("/")) {
        const [num, den] = String(value)
            .split("/")
            .map(Number);

        if (den && Number.isFinite(num) && Number.isFinite(den)) {
            return num / den;
        }
    }

    return Number(value) || 0;
}

function parseBitrate(value) {
    if (!value) {
        return 0;
    }

    if (typeof value === "number") {
        return value;
    }

    const text = String(value).trim().toLowerCase();

    if (text.endsWith("k")) {
        return parseFloat(text) * 1000;
    }

    if (text.endsWith("m")) {
        return parseFloat(text) * 1_000_000;
    }

    return parseFloat(text) || 0;
}

function setStatus(message, type = "normal") {
    status.textContent = message;

    if (type === "error") {
        status.style.color = "#dc2626";
    } else if (type === "success") {
        status.style.color = "#16a34a";
    } else {
        status.style.color = "";
    }
}

function resetProgress() {
    currentProgress = 0;
    currentFrame = 0;
    currentFps = 0;
    currentSpeed = 0;
    currentEncodingTime = 0;

    progressFill.style.width = "0%";
    progressText.textContent = "0%";
}

function showProgress() {
    progressContainer.classList.remove("hidden");
}

function hideProgress() {
    progressContainer.classList.add("hidden");
}

/*
|--------------------------------------------------------------------------
| Encoding detail UI
|--------------------------------------------------------------------------
|
| Current index.html does not contain a detailed encoding panel.
| We create it automatically from JavaScript.
|--------------------------------------------------------------------------
*/

let encodingInfo = null;
let encodingTime = null;
let encodingFrame = null;
let encodingFps = null;
let encodingSpeed = null;
let encodingEncoder = null;

function createEncodingInfo() {
    if (encodingInfo) {
        return;
    }

    encodingInfo = document.createElement("div");

    encodingInfo.style.marginTop = "15px";
    encodingInfo.style.padding = "15px";
    encodingInfo.style.borderRadius = "10px";
    encodingInfo.style.background = "#f8fafc";
    encodingInfo.style.display = "grid";
    encodingInfo.style.gridTemplateColumns =
        "repeat(auto-fit,minmax(130px,1fr))";
    encodingInfo.style.gap = "10px";

    const createItem = (label) => {
        const item = document.createElement("div");

        const labelElement = document.createElement("div");
        labelElement.textContent = label;
        labelElement.style.fontSize = "12px";
        labelElement.style.color = "#64748b";
        labelElement.style.marginBottom = "4px";

        const valueElement = document.createElement("div");
        valueElement.textContent = "-";
        valueElement.style.fontWeight = "700";

        item.appendChild(labelElement);
        item.appendChild(valueElement);

        encodingInfo.appendChild(item);

        return valueElement;
    };

    encodingEncoder = createItem("Encoder");
    encodingTime = createItem("Time");
    encodingFrame = createItem("Frame");
    encodingFps = createItem("FPS");
    encodingSpeed = createItem("Speed");

    progressContainer.appendChild(encodingInfo);
}

function resetEncodingInfo() {
    createEncodingInfo();

    encodingEncoder.textContent = "-";
    encodingTime.textContent = "00:00";
    encodingFrame.textContent = "0";
    encodingFps.textContent = "0";
    encodingSpeed.textContent = "0x";
}

/*
|--------------------------------------------------------------------------
| FFmpeg log parser
|--------------------------------------------------------------------------
*/

function parseFFmpegLog(message) {
    if (!message) {
        return;
    }

    lastLogMessage = message;

    /*
     * frame= 123
     */
    const frameMatch = message.match(
        /frame=\s*(\d+)/
    );

    if (frameMatch) {
        currentFrame = Number(frameMatch[1]);
    }

    /*
     * fps= 45.2
     */
    const fpsMatch = message.match(
        /fps=\s*([\d.]+)/
    );

    if (fpsMatch) {
        currentFps = Number(fpsMatch[1]);
    }

    /*
     * speed=0.84x
     */
    const speedMatch = message.match(
        /speed=\s*([\d.]+)x/
    );

    if (speedMatch) {
        currentSpeed = Number(speedMatch[1]);
    }

    /*
     * time=00:00:12.34
     */
    const timeMatch = message.match(
        /time=(\d+):(\d+):([\d.]+)/
    );

    if (timeMatch) {
        const hours = Number(timeMatch[1]);
        const minutes = Number(timeMatch[2]);
        const seconds = Number(timeMatch[3]);

        currentEncodingTime =
            hours * 3600 +
            minutes * 60 +
            seconds;
    }

    /*
     * Update detailed UI
     */
    updateEncodingInfo();
}

function updateEncodingInfo() {
    if (!encodingInfo) {
        return;
    }

    encodingTime.textContent =
        formatTime(currentEncodingTime);

    encodingFrame.textContent =
        currentFrame.toLocaleString();

    encodingFps.textContent =
        Number.isFinite(currentFps)
            ? currentFps.toFixed(1)
            : "0";

    encodingSpeed.textContent =
        Number.isFinite(currentSpeed)
            ? `${currentSpeed.toFixed(2)}x`
            : "0x";
}

/*
|--------------------------------------------------------------------------
| FFmpeg events
|--------------------------------------------------------------------------
*/

ffmpeg.on("log", ({ type, message }) => {
    console.log(`[FFmpeg ${type}] ${message}`);

    parseFFmpegLog(message);

    /*
     * Capture possible error messages.
     */
    const lower = String(message).toLowerCase();

    if (
        lower.includes("error") ||
        lower.includes("failed") ||
        lower.includes("invalid") ||
        lower.includes("unable")
    ) {
        lastErrorMessages.push(message);

        if (lastErrorMessages.length > 20) {
            lastErrorMessages.shift();
        }
    }
});

ffmpeg.on("progress", ({ progress, time }) => {
    /*
     * ffmpeg.wasm progress is normally 0..1.
     */
    if (Number.isFinite(progress)) {
        currentProgress = Math.max(
            0,
            Math.min(1, progress)
        );
    }

    /*
     * time is generally microseconds.
     */
    if (Number.isFinite(time)) {
        currentEncodingTime = time / 1_000_000;
    }

    const percent = Math.round(
        currentProgress * 100
    );

    progressFill.style.width = `${percent}%`;

    progressText.textContent =
        `${percent}% • ${formatTime(currentEncodingTime)} / ${formatTime(inputDuration)}`;

    updateEncodingInfo();
});

/*
|--------------------------------------------------------------------------
| FFmpeg loading
|--------------------------------------------------------------------------
*/

async function loadFFmpeg() {
    if (ffmpeg.loaded) {
        ffmpegLoaded = true;
        return;
    }

    if (ffmpegLoadingPromise) {
        return ffmpegLoadingPromise;
    }

    ffmpegLoadingPromise = (async () => {
        console.log("Loading FFmpeg...");

        const baseURL = "/ffmpeg";

        await ffmpeg.load({
            coreURL: await toBlobURL(
                `${baseURL}/ffmpeg-core.js`,
                "text/javascript"
            ),

            wasmURL: await toBlobURL(
                `${baseURL}/ffmpeg-core.wasm`,
                "application/wasm"
            ),
        });

        ffmpegLoaded = true;

        console.log(
            "FFmpeg loaded successfully."
        );

        console.log(
            "ffmpeg.loaded:",
            ffmpeg.loaded
        );
    })();

    try {
        await ffmpegLoadingPromise;
    } catch (error) {
        ffmpegLoadingPromise = null;
        ffmpegLoaded = false;

        console.error(
            "FFmpeg loading failed:",
            error
        );

        throw error;
    }
}

/*
|--------------------------------------------------------------------------
| Expose debug functions
|--------------------------------------------------------------------------
*/

window.loadFFmpeg = loadFFmpeg;

/*
|--------------------------------------------------------------------------
| Debug encoder
|--------------------------------------------------------------------------
*/

async function debugEncoder(encoder) {
    await loadFFmpeg();

    console.log(
        `Testing encoder: ${encoder}`
    );

    try {
        const result = await ffmpeg.exec([
            "-hide_banner",
            "-h",
            `encoder=${encoder}`,
        ]);

        console.log(
            `${encoder} exit code:`,
            result
        );

        return result;
    } catch (error) {
        console.error(
            `${encoder} test failed:`,
            error
        );

        throw error;
    }
}

window.debugEncoder = debugEncoder;

/*
|--------------------------------------------------------------------------
| Debug all encoders
|--------------------------------------------------------------------------
*/

async function debugEncoders() {
    await loadFFmpeg();

    const result = await ffmpeg.exec([
        "-hide_banner",
        "-encoders",
    ]);

    console.log(
        "Encoder list exit code:",
        result
    );

    return result;
}

window.debugEncoders = debugEncoders;

/*
|--------------------------------------------------------------------------
| File writing
|--------------------------------------------------------------------------
*/

async function writeInputFile(file) {
    const fileName = "input.mp4";

    try {
        await ffmpeg.deleteFile(fileName);
    } catch {
        // File may not exist.
    }

    await ffmpeg.writeFile(
        fileName,
        await fetchFile(file)
    );

    return fileName;
}

/*
|--------------------------------------------------------------------------
| Video metadata
|--------------------------------------------------------------------------
*/

async function analyzeVideo(file) {
    await loadFFmpeg();

    const inputName = await writeInputFile(file);

    let metadataOutput = "";

    const metadataHandler = ({ message }) => {
        metadataOutput += `${message}\n`;
    };

    ffmpeg.on("log", metadataHandler);

    try {
        /*
         * First try ffprobe if included in the core.
         */
        try {
            const probeResult = await ffmpeg.ffprobe([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                inputName,
            ]);

            if (probeResult) {
                /*
                 * @ffmpeg/ffmpeg may return a string,
                 * Uint8Array, or undefined depending
                 * on version/build.
                 */

                let probeText = "";

                if (typeof probeResult === "string") {
                    probeText = probeResult;
                } else if (
                    probeResult instanceof Uint8Array
                ) {
                    probeText =
                        new TextDecoder().decode(
                            probeResult
                        );
                }

                if (probeText) {
                    const data =
                        JSON.parse(probeText);

                    applyMetadata(data);

                    rawMetadata.textContent =
                        JSON.stringify(
                            data,
                            null,
                            2
                        );

                    return data;
                }
            }
        } catch (probeError) {
            console.warn(
                "ffprobe unavailable or failed:",
                probeError
            );
        }

        /*
         * Fallback:
         * Use browser video metadata.
         */
        await analyzeVideoWithBrowser(file);

        rawMetadata.textContent =
            metadataOutput ||
            "Metadata loaded from browser video element.";

        return null;
    } finally {
        /*
         * ffmpeg.off may not exist in every build.
         * Ignore if unavailable.
         */
        try {
            if (typeof ffmpeg.off === "function") {
                ffmpeg.off(
                    "log",
                    metadataHandler
                );
            }
        } catch {
            // Ignore.
        }
    }
}

function applyMetadata(data) {
    if (!data) {
        return;
    }

    const streams = Array.isArray(data.streams)
        ? data.streams
        : [];

    const format = data.format || {};

    const videoStream =
        streams.find(
            stream =>
                stream.codec_type === "video"
        ) || null;

    const audioStream =
        streams.find(
            stream =>
                stream.codec_type === "audio"
        ) || null;

    if (format.duration) {
        inputDuration =
            Number(format.duration) || 0;
    }

    if (videoStream) {
        inputVideoBitrate =
            Number(videoStream.bit_rate) ||
            Number(format.bit_rate) ||
            0;

        resolution.textContent =
            videoStream.width &&
            videoStream.height
                ? `${videoStream.width} × ${videoStream.height}`
                : "-";

        const fps =
            parseFrameRate(
                videoStream.avg_frame_rate ||
                videoStream.r_frame_rate
            );

        frameRate.textContent =
            fps > 0
                ? `${fps.toFixed(2)} fps`
                : "-";

        videoCodec.textContent =
            videoStream.codec_name || "-";

        videoBitrate.textContent =
            videoStream.bit_rate
                ? formatBitrate(
                      Number(
                          videoStream.bit_rate
                      )
                  )
                : formatBitrate(
                      Number(format.bit_rate)
                  );
    }

    if (audioStream) {
        audioCodec.textContent =
            audioStream.codec_name || "-";

        audioBitrateInfo.textContent =
            audioStream.bit_rate
                ? formatBitrate(
                      Number(
                          audioStream.bit_rate
                      )
                  )
                : "-";
    }

    if (format.duration) {
        duration.textContent =
            formatDuration(
                Number(format.duration)
            );
    }
}

async function analyzeVideoWithBrowser(file) {
    const video = document.createElement(
        "video"
    );

    video.preload = "metadata";

    const url = URL.createObjectURL(file);

    try {
        await new Promise(
            (resolve, reject) => {
                video.onloadedmetadata =
                    resolve;

                video.onerror = reject;

                video.src = url;
            }
        );

        inputDuration =
            Number(video.duration) || 0;

        duration.textContent =
            formatDuration(
                inputDuration
            );

        resolution.textContent =
            `${video.videoWidth} × ${video.videoHeight}`;

        /*
         * Browser cannot reliably provide
         * codec / bitrate / FPS for every file.
         */
        if (
            !videoCodec.textContent ||
            videoCodec.textContent === "-"
        ) {
            videoCodec.textContent =
                "Detected by FFmpeg";
        }
    } finally {
        URL.revokeObjectURL(url);
    }
}

/*
|--------------------------------------------------------------------------
| Update metadata UI
|--------------------------------------------------------------------------
*/

async function processSelectedFile(file) {
    if (!file) {
        return;
    }

    selectedFile = file;

    /*
     * Keep original filename in browser-safe form.
     */
    inputFileName = file.name;

    fileSize.textContent =
        formatBytes(file.size);

    duration.textContent = "-";
    resolution.textContent = "-";
    frameRate.textContent = "-";
    videoCodec.textContent = "-";
    videoBitrate.textContent = "-";
    audioCodec.textContent = "-";
    audioBitrateInfo.textContent = "-";

    rawMetadata.textContent =
        "Analyzing video...";

    analysisCard.classList.remove(
        "hidden"
    );

    compressCard.classList.remove(
        "hidden"
    );

    resultCard.classList.add("hidden");

    setStatus(
        "⚙ Analyzing video..."
    );

    try {
        await analyzeVideo(file);

        estimateOriginal.textContent =
            formatBytes(file.size);

        updateEstimate();

        setStatus(
            "✓ Video siap untuk diproses.",
            "success"
        );
    } catch (error) {
        console.error(
            "Video analysis failed:",
            error
        );

        /*
         * Browser fallback
         */
        try {
            await analyzeVideoWithBrowser(
                file
            );

            estimateOriginal.textContent =
                formatBytes(file.size);

            updateEstimate();

            setStatus(
                "✓ Video siap untuk diproses.",
                "success"
            );
        } catch (fallbackError) {
            console.error(
                "Browser metadata failed:",
                fallbackError
            );

            setStatus(
                `Gagal membaca video: ${
                    fallbackError.message ||
                    fallbackError
                }`,
                "error"
            );
        }
    }
}

/*
|--------------------------------------------------------------------------
| Estimate bitrate
|--------------------------------------------------------------------------
*/

function getAudioBitrateKbps() {
    const value =
        String(audioBitrate.value || "");

    return parseBitrate(value) / 1000;
}

function calculateTargetVideoBitrateKbps() {
    if (!selectedFile || !inputDuration) {
        return 0;
    }

    const targetMB =
        Number(targetSize.value);

    if (
        !Number.isFinite(targetMB) ||
        targetMB <= 0
    ) {
        return 0;
    }

    /*
     * Target bytes -> total bits.
     */
    const totalBits =
        targetMB *
        1024 *
        1024 *
        8;

    const totalKbps =
        totalBits /
        inputDuration /
        1000;

    const audioKbps =
        getAudioBitrateKbps();

    /*
     * Reserve a small amount for
     * container overhead.
     */
    const overheadKbps =
        Math.max(
            8,
            totalKbps * 0.02
        );

    const videoKbps =
        totalKbps -
        audioKbps -
        overheadKbps;

    return Math.max(
        1,
        videoKbps
    );
}

function updateEstimate() {
    if (!selectedFile) {
        return;
    }

    estimateOriginal.textContent =
        formatBytes(
            selectedFile.size
        );

    if (
        compressionMode.value === "target"
    ) {
        const targetMB =
            Number(targetSize.value);

        const bitrate =
            calculateTargetVideoBitrateKbps();

        estimateTarget.textContent =
            Number.isFinite(targetMB)
                ? `${targetMB} MB`
                : "-";

        estimateBitrate.textContent =
            bitrate > 0
                ? `${Math.round(bitrate)} kbps`
                : "-";

        if (
            targetMB > 0 &&
            selectedFile.size > 0
        ) {
            const reduction =
                100 -
                (
                    targetMB *
                    1024 *
                    1024 /
                    selectedFile.size *
                    100
                );

            estimateReduction.textContent =
                `${Math.max(
                    0,
                    reduction
                ).toFixed(1)}%`;
        } else {
            estimateReduction.textContent =
                "-";
        }
    } else {
        estimateTarget.textContent =
            "CRF mode";

        estimateBitrate.textContent =
            "Variable";

        estimateReduction.textContent =
            "Variable";
    }
}

/*
|--------------------------------------------------------------------------
| Preset handling
|--------------------------------------------------------------------------
*/

function updatePresetOptions() {
    const encoder =
        videoEncoder.value;

    const presets =
        ENCODER_PRESETS[encoder] ||
        ENCODER_PRESETS.libx264;

    const previousValue =
        preset.value;

    preset.innerHTML = "";

    for (const value of presets) {
        const option =
            document.createElement(
                "option"
            );

        option.value = value;
        option.textContent = value;

        preset.appendChild(option);
    }

    /*
     * Keep medium whenever possible.
     * Otherwise use first available preset.
     */
    if (presets.includes("medium")) {
        preset.value = "medium";
    } else if (
        presets.includes(previousValue)
    ) {
        preset.value = previousValue;
    } else {
        preset.value = presets[0];
    }
}

/*
|--------------------------------------------------------------------------
| Compression mode
|--------------------------------------------------------------------------
*/

function updateCompressionMode() {
    if (
        compressionMode.value === "target"
    ) {
        targetSizeField.classList.remove(
            "hidden"
        );

        crf.closest(".field")
            ?.classList.add("hidden");
    } else {
        targetSizeField.classList.add(
            "hidden"
        );

        crf.closest(".field")
            ?.classList.remove("hidden");
    }

    updateEstimate();
}

/*
|--------------------------------------------------------------------------
| Calculate CRF
|--------------------------------------------------------------------------
*/

function getCRF() {
    const value = Number(crf.value);

    if (!Number.isFinite(value)) {
        return 28;
    }

    return Math.max(
        0,
        Math.min(63, Math.round(value))
    );
}

/*
|--------------------------------------------------------------------------
| Encode
|--------------------------------------------------------------------------
*/

async function encodeVideo() {
    if (!selectedFile) {
        setStatus(
            "Pilih video terlebih dahulu.",
            "error"
        );

        return;
    }

    encodeButton.disabled = true;

    lastErrorMessages = [];
    lastLogMessage = "";

    resetProgress();
    resetEncodingInfo();

    showProgress();

    resultCard.classList.add("hidden");

    const encoder =
        videoEncoder.value;

    const selectedPreset =
        preset.value;

    encodingEncoder.textContent =
        encoder === "libx264"
            ? `H.264 • ${selectedPreset}`
            : `H.265 • ${selectedPreset}`;

    setStatus(
        "⚙ Encoding video..."
    );

    console.log(
        "Starting encoding:",
        {
            encoder,
            preset: selectedPreset,
            mode: compressionMode.value,
        }
    );

    try {
        await loadFFmpeg();

        /*
         * Make sure the input exists.
         */
        const inputName =
            await writeInputFile(
                selectedFile
            );

        /*
         * Remove previous output.
         */
        try {
            await ffmpeg.deleteFile(
                "output.mp4"
            );
        } catch {
            // Ignore.
        }

        const args = [
            "-hide_banner",

            "-i",
            inputName,

            "-map",
            "0:v:0",

            "-map",
            "0:a:0?",

            "-c:v",
            encoder,

            "-preset",
            selectedPreset,

            /*
             * Browser-friendly pixel format.
             */
            "-pix_fmt",
            "yuv420p",
        ];

        /*
         * Target Size mode
         */
        if (
            compressionMode.value === "target"
        ) {
            const videoKbps =
                calculateTargetVideoBitrateKbps();

            if (
                !Number.isFinite(
                    videoKbps
                ) ||
                videoKbps <= 0
            ) {
                throw new Error(
                    "Target bitrate tidak valid. Naikkan target size atau turunkan audio bitrate."
                );
            }

            console.log(
                "Target video bitrate:",
                `${Math.round(videoKbps)}k`
            );

            args.push(
                "-b:v",
                `${Math.round(
                    videoKbps
                )}k`
            );
        }

        /*
         * CRF mode
         */
        else {
            args.push(
                "-crf",
                String(getCRF())
            );
        }

        /*
         * Audio
         */
        args.push(
            "-c:a",
            "aac",

            "-b:a",
            audioBitrate.value,

            "output.mp4"
        );

        console.log(
            "FFmpeg command:",
            args
        );

        const exitCode =
            await ffmpeg.exec(args);

        console.log(
            "FFmpeg exit code:",
            exitCode
        );

        /*
         * ffmpeg.wasm should normally return 0.
         */
        if (exitCode !== 0) {
            let errorText =
                lastErrorMessages.join(
                    "\n"
                );

            if (!errorText) {
                errorText =
                    lastLogMessage ||
                    `FFmpeg gagal dengan exit code ${exitCode}`;
            }

            throw new Error(
                errorText
            );
        }

        /*
         * Read output.
         */
        const outputData =
            await ffmpeg.readFile(
                "output.mp4"
            );

        if (
            !outputData ||
            !outputData.length
        ) {
            throw new Error(
                "FFmpeg selesai tetapi output.mp4 kosong."
            );
        }

        const outputBlob =
            new Blob(
                [outputData.buffer],
                {
                    type: "video/mp4",
                }
            );

        /*
         * Force 100%.
         */
        currentProgress = 1;

        progressFill.style.width =
            "100%";

        progressText.textContent =
            `100% • ${formatTime(
                inputDuration
            )} / ${formatTime(
                inputDuration
            )}`;

        setStatus(
            "✓ Encoding selesai.",
            "success"
        );

        showResult(outputBlob);

        /*
         * Cleanup FFmpeg filesystem.
         */
        try {
            await ffmpeg.deleteFile(
                inputName
            );
        } catch {
            // Ignore.
        }

        try {
            await ffmpeg.deleteFile(
                "output.mp4"
            );
        } catch {
            // Ignore.
        }
    } catch (error) {
        console.error(
            "Encoding failed:",
            error
        );

        const message =
            error?.message ||
            String(error);

        setStatus(
            `✕ Encoding gagal: ${message}`,
            "error"
        );

        console.error(
            "Last FFmpeg log:",
            lastLogMessage
        );

        console.error(
            "FFmpeg errors:",
            lastErrorMessages
        );
    } finally {
        encodeButton.disabled = false;
    }
}

/*
|--------------------------------------------------------------------------
| Result
|--------------------------------------------------------------------------
*/

function showResult(blob) {
    if (outputUrl) {
        URL.revokeObjectURL(
            outputUrl
        );
    }

    outputUrl =
        URL.createObjectURL(blob);

    resultVideo.src =
        outputUrl;

    const originalSize =
        selectedFile
            ? selectedFile.size
            : 0;

    const outputSize =
        blob.size;

    const saved =
        originalSize > 0
            ? (
                100 -
                (
                    outputSize /
                    originalSize *
                    100
                )
            )
            : 0;

    resultOriginal.textContent =
        formatBytes(
            originalSize
        );

    resultOutput.textContent =
        formatBytes(
            outputSize
        );

    if (saved >= 0) {
        resultSaved.textContent =
            `${saved.toFixed(1)}%`;
    } else {
        resultSaved.textContent =
            `+${Math.abs(
                saved
            ).toFixed(1)}%`;
    }

    resultStatus.textContent =
        "Completed";

    const originalName =
        inputFileName ||
        "video";

    const baseName =
        originalName
            .replace(
                /\.[^/.]+$/,
                ""
            )
            .replace(
                /[^a-zA-Z0-9_\-]+/g,
                "_"
            );

    downloadLink.href =
        outputUrl;

    downloadLink.download =
        `${baseName}-optimized.mp4`;

    resultCard.classList.remove(
        "hidden"
    );

    /*
     * Scroll to result.
     */
    setTimeout(() => {
        resultCard.scrollIntoView({
            behavior: "smooth",
            block: "start",
        });
    }, 100);
}

/*
|--------------------------------------------------------------------------
| File selection
|--------------------------------------------------------------------------
*/

chooseButton.addEventListener(
    "click",
    () => {
        videoInput.click();
    }
);

dropZone.addEventListener(
    "click",
    event => {
        if (
            event.target ===
            chooseButton
        ) {
            return;
        }

        videoInput.click();
    }
);

videoInput.addEventListener(
    "change",
    async event => {
        const file =
            event.target.files?.[0];

        if (!file) {
            return;
        }

        await processSelectedFile(
            file
        );
    }
);

/*
|--------------------------------------------------------------------------
| Drag & Drop
|--------------------------------------------------------------------------
*/

dropZone.addEventListener(
    "dragover",
    event => {
        event.preventDefault();

        dropZone.classList.add(
            "dragover"
        );
    }
);

dropZone.addEventListener(
    "dragleave",
    () => {
        dropZone.classList.remove(
            "dragover"
        );
    }
);

dropZone.addEventListener(
    "drop",
    async event => {
        event.preventDefault();

        dropZone.classList.remove(
            "dragover"
        );

        const file =
            event.dataTransfer.files?.[0];

        if (!file) {
            return;
        }

        if (
            !file.type.startsWith(
                "video/"
            )
        ) {
            setStatus(
                "File yang dipilih bukan video.",
                "error"
            );

            return;
        }

        /*
         * Keep input element synchronized.
         * This is optional but useful.
         */
        try {
            const dataTransfer =
                new DataTransfer();

            dataTransfer.items.add(
                file
            );

            videoInput.files =
                dataTransfer.files;
        } catch {
            // Ignore.
        }

        await processSelectedFile(
            file
        );
    }
);

/*
|--------------------------------------------------------------------------
| Compression controls
|--------------------------------------------------------------------------
*/

compressionMode.addEventListener(
    "change",
    updateCompressionMode
);

targetSize.addEventListener(
    "input",
    updateEstimate
);

crf.addEventListener(
    "input",
    updateEstimate
);

audioBitrate.addEventListener(
    "change",
    updateEstimate
);

videoEncoder.addEventListener(
    "change",
    () => {
        updatePresetOptions();
    }
);

/*
|--------------------------------------------------------------------------
| Quick target-size buttons
|--------------------------------------------------------------------------
*/

document
    .querySelectorAll(
        ".quick-size"
    )
    .forEach(button => {
        button.addEventListener(
            "click",
            () => {
                const size =
                    button.dataset.size;

                if (size) {
                    targetSize.value =
                        size;

                    compressionMode.value =
                        "target";

                    updateCompressionMode();
                    updateEstimate();
                }
            }
        );
    });

/*
|--------------------------------------------------------------------------
| Encode button
|--------------------------------------------------------------------------
*/

encodeButton.addEventListener(
    "click",
    encodeVideo
);

/*
|--------------------------------------------------------------------------
| Default configuration
|--------------------------------------------------------------------------
*/

videoEncoder.value =
    "libx264";

updatePresetOptions();

preset.value =
    "medium";

compressionMode.value =
    "target";

updateCompressionMode();

resetProgress();

createEncodingInfo();

console.log(
    "Video Optimizer loaded successfully."
);

/*
|--------------------------------------------------------------------------
| Automatically load FFmpeg
|--------------------------------------------------------------------------
|
| This is the important fix.
| The application now loads FFmpeg when the
| page starts instead of waiting until encoding.
|--------------------------------------------------------------------------
*/

(async () => {
    try {
        setStatus(
            "⚙ Loading FFmpeg..."
        );

        await loadFFmpeg();

        setStatus(
            "✓ FFmpeg siap.",
            "success"
        );

        console.log(
            "FFmpeg ready:",
            ffmpeg.loaded
        );
    } catch (error) {
        console.error(
            "FFmpeg initialization failed:",
            error
        );

        setStatus(
            `✕ FFmpeg gagal dimuat: ${
                error?.message ||
                error
            }`,
            "error"
        );
    }
})();
