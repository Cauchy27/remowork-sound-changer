/**
 * Offscreen Document for Hand Pose & Face Expression Detection
 * MediaPipe Tasks Vision + face-api.js を使用
 *
 * Note: fetch ポリフィルは fetch-polyfill.js で適用済み
 */

import { HandLandmarker, FilesetResolver } from './lib/mediapipe/vision_bundle.js';

let handLandmarker = null;
let isInitialized = false;

// 表情分析の初期化状態
let isFaceApiInitialized = false;
let faceApiInitPromise = null;

// 初期化中のPromiseを保持（複数の呼び出しを待機させるため）
let initPromise = null;

// 最後の初期化エラーを保持
let lastInitError = null;

/**
 * MediaPipe Hand Landmarker を初期化
 * 複数の呼び出しがあっても、一度だけ初期化を実行し、他は完了を待つ
 */
async function initDetector() {
  // 既に初期化済み
  if (isInitialized) return { success: true };

  // 初期化中なら、そのPromiseを待つ
  if (initPromise) {
    console.log('[Offscreen] Waiting for existing initialization...');
    return initPromise;
  }

  // 初期化を開始
  initPromise = (async () => {
    lastInitError = null;

    try {
      console.log('[Offscreen] Initializing MediaPipe Hand Landmarker...');

      // FilesetResolver を使ってWASMファイルを読み込む
      const wasmPath = chrome.runtime.getURL('lib/mediapipe/');
      console.log('[Offscreen] WASM path:', wasmPath);

      const vision = await FilesetResolver.forVisionTasks(wasmPath);
      console.log('[Offscreen] FilesetResolver ready');

      const modelPath = chrome.runtime.getURL('lib/mediapipe/hand_landmarker.task');
      console.log('[Offscreen] Model path:', modelPath);

      // Hand Landmarker を作成（GPU優先、失敗時はCPUにフォールバック）
      try {
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelPath,
            delegate: 'GPU'
          },
          runningMode: 'IMAGE',
          numHands: 2
        });
        console.log('[Offscreen] Using GPU delegate');
      } catch (gpuError) {
        const gpuErrorMsg = gpuError?.message || String(gpuError);
        console.warn('[Offscreen] GPU delegate failed, falling back to CPU:', gpuErrorMsg);
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelPath,
            delegate: 'CPU'
          },
          runningMode: 'IMAGE',
          numHands: 2
        });
        console.log('[Offscreen] Using CPU delegate');
      }

      isInitialized = true;
      console.log('[Offscreen] MediaPipe Hand Landmarker initialized successfully');
      return { success: true };
    } catch (error) {
      const errorMsg = error?.message || String(error);
      console.error('[Offscreen] Failed to initialize:', errorMsg);
      lastInitError = errorMsg;
      // 失敗時はPromiseをクリアして再試行可能にする
      initPromise = null;
      return { success: false, error: errorMsg };
    }
  })();

  return initPromise;
}

/**
 * 2点間の距離を計算
 */
function distance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

/**
 * 手のランドマークからジェスチャーを検出
 *
 * MediaPipe Hand Landmarks:
 * 0: WRIST
 * 1-4: THUMB (CMC, MCP, IP, TIP)
 * 5-8: INDEX (MCP, PIP, DIP, TIP)
 * 9-12: MIDDLE (MCP, PIP, DIP, TIP)
 * 13-16: RING (MCP, PIP, DIP, TIP)
 * 17-20: PINKY (MCP, PIP, DIP, TIP)
 *
 * 検出対象ジェスチャー（片手）:
 * 1. Thumbs Up 👍: 親指が上向き + 4本指が閉じている
 * 2. Peace ✌️: 人差し指と中指が伸びている + 他が閉じている
 * 3. Open Palm 👋: 複数のパターンで検出
 *    - パターンA: 4本指が伸びている（指先がPIPより上）
 *    - パターンB: 指が揃っている（隣接する指先の距離が近い）
 *    - パターンC: 3本以上の指が伸びている
 *
 * 両手ジェスチャー（detectHeadInHands関数で検出）:
 * - Head in Hands 😢: 両手が顔の両側にある（頭を抱えるポーズ）
 */
function detectGesture(landmarks) {
  if (!landmarks || landmarks.length === 0) return null;

  // 各指のランドマーク
  const wrist = landmarks[0];

  // 親指
  const thumbTip = landmarks[4];
  const thumbIP = landmarks[3];
  const thumbMCP = landmarks[2];
  const thumbCMC = landmarks[1];
  const thumbExtended = Math.abs(thumbTip.x - wrist.x) > Math.abs(thumbIP.x - wrist.x);
  // 親指が上向き判定を厳しく: 0.05 → 0.12（より明確に上を向いている必要あり）
  const thumbUp = thumbTip.y < thumbMCP.y - 0.12;
  // 追加: 親指が手のひらより明確に上にある
  const thumbClearlyUp = thumbTip.y < wrist.y - 0.05;

  // 人差し指
  const indexTip = landmarks[8];
  const indexPIP = landmarks[6];
  const indexMCP = landmarks[5];
  // 指が伸びている判定（Open Palm用）
  const indexExtended = indexTip.y < indexPIP.y - 0.02;
  // 指が曲がっている判定（Thumbs Up用）: より厳しく
  const indexBent = indexTip.y > indexPIP.y + 0.03;

  // 中指
  const middleTip = landmarks[12];
  const middlePIP = landmarks[10];
  const middleMCP = landmarks[9];
  const middleExtended = middleTip.y < middlePIP.y - 0.02;
  const middleBent = middleTip.y > middlePIP.y + 0.03;

  // 薬指
  const ringTip = landmarks[16];
  const ringPIP = landmarks[14];
  const ringMCP = landmarks[13];
  const ringExtended = ringTip.y < ringPIP.y - 0.02;
  const ringBent = ringTip.y > ringPIP.y + 0.03;

  // 小指
  const pinkyTip = landmarks[20];
  const pinkyPIP = landmarks[18];
  const pinkyMCP = landmarks[17];
  const pinkyExtended = pinkyTip.y < pinkyPIP.y - 0.02;
  const pinkyBent = pinkyTip.y > pinkyPIP.y + 0.03;

  // 4本指の状態
  const fourFingersClosed = !indexExtended && !middleExtended && !ringExtended && !pinkyExtended;
  // 4本指が曲がっている（Thumbs Up用のより厳しい判定）
  const fourFingersBent = indexBent && middleBent && ringBent && pinkyBent;
  const fourFingersOpen = indexExtended && middleExtended && ringExtended && pinkyExtended;

  // 親指が下を向いているか（y座標がMCPより下）
  const thumbDown = thumbTip.y > thumbMCP.y + 0.05;

  // === Thumbs Up 検出 ===
  // 親指が明確に立っていて、他の4本指が曲がっている
  if (thumbUp && thumbClearlyUp && thumbExtended && fourFingersBent) {
    console.log('[Offscreen] Detected: Thumbs Up (strict)');
    return { type: 'thumbsup', emoji: '👍', message: 'いつでもお話しいいですよ！！' };
  }

  // === Peace 検出 ===
  // 人差し指と中指が伸びていて、薬指と小指が閉じている
  const peaceSign = indexExtended && middleExtended && !ringExtended && !pinkyExtended;
  if (peaceSign) {
    console.log('[Offscreen] Detected: Peace');
    return { type: 'peace', emoji: '✌️', message: '調子いいから聞いて聞いて！！！' };
  }

  // === Open Palm 検出（複数パターン） ===

  // パターンA: 4本指が伸びている（従来の検出）
  if (fourFingersOpen) {
    console.log('[Offscreen] Detected: Open Palm (Pattern A: fingers extended)');
    return { type: 'wave', emoji: '👋', message: 'お話ししたいです！！！' };
  }

  // パターンB: 指が揃っている（閉じた手のひら）
  // 隣接する指先の距離が近い = 指が揃っている
  const indexMiddleDist = distance(indexTip, middleTip);
  const middleRingDist = distance(middleTip, ringTip);
  const ringPinkyDist = distance(ringTip, pinkyTip);
  const avgFingerTipDist = (indexMiddleDist + middleRingDist + ringPinkyDist) / 3;

  // 手のひらの幅（人差し指MCPから小指MCPまで）
  const palmWidth = distance(indexMCP, pinkyMCP);

  // 指先が揃っている（隣接指先の平均距離が手のひら幅の25%以下）
  const fingersAligned = avgFingerTipDist < palmWidth * 0.25;

  // 指がある程度伸びている（MCPから指先までの距離）
  const indexLength = distance(indexMCP, indexTip);
  const middleLength = distance(middleMCP, middleTip);
  const ringLength = distance(ringMCP, ringTip);
  const pinkyLength = distance(pinkyMCP, pinkyTip);
  const avgFingerLength = (indexLength + middleLength + ringLength + pinkyLength) / 4;

  // 指の長さが手のひら幅の40%以上ならある程度伸びている
  const fingersLongEnough = avgFingerLength > palmWidth * 0.4;

  // パターンB: 指が揃っていて、ある程度伸びている
  if (fingersAligned && fingersLongEnough) {
    console.log('[Offscreen] Detected: Open Palm (Pattern B: fingers aligned)');
    return { type: 'wave', emoji: '👋', message: 'お話ししたいです！！！' };
  }

  // パターンC: 手のひらが正面を向いている（少なくとも3本の指が伸びている）
  const extendedCount = [indexExtended, middleExtended, ringExtended, pinkyExtended].filter(Boolean).length;
  if (extendedCount >= 3 && fingersLongEnough) {
    console.log('[Offscreen] Detected: Open Palm (Pattern C: 3+ fingers extended)');
    return { type: 'wave', emoji: '👋', message: 'お話ししたいです！！！' };
  }

  // それ以外のジェスチャーは無視
  console.log('[Offscreen] No recognized gesture (extended:', extendedCount, 'aligned:', fingersAligned,
    'longEnough:', fingersLongEnough, 'thumbUp:', thumbUp, ')');
  return null;
}

/**
 * 両手で「頭を抱える」ジェスチャーを検出
 * 条件:
 * - 両手が検出されている
 * - 両手の手首が画像の上部にある（顔の近く）
 * - 両手の手首が離れている（頭の両側）
 */
function detectHeadInHands(landmarks1, landmarks2) {
  const wrist1 = landmarks1[0];
  const wrist2 = landmarks2[0];

  // 両手首のY座標が画像上部〜中央付近にある（0.0〜0.65の範囲、上が0）
  // 緩和: 0.5 → 0.65（顔より少し下でもOK）
  const bothHandsHigh = wrist1.y < 0.65 && wrist2.y < 0.65;

  // 両手首のX座標が離れている（左右に広がっている）
  // 緩和: 0.3 → 0.2（より近くてもOK）
  const handsSpread = Math.abs(wrist1.x - wrist2.x) > 0.2;

  // 両手首が画像の両端にある（左手は左側、右手は右側）
  // 緩和: 厳密な左右分離は不要、ある程度離れていればOK
  const leftHand = wrist1.x < wrist2.x ? landmarks1 : landmarks2;
  const rightHand = wrist1.x < wrist2.x ? landmarks2 : landmarks1;
  // 左手が中央より左寄り、または右手が中央より右寄りであればOK
  const properPosition = leftHand[0].x < 0.6 && rightHand[0].x > 0.4;

  // 指の状態をチェック（開いている or 閉じている、どちらでもOK）
  // 頭を抱える時は指が開いていることが多い

  if (bothHandsHigh && handsSpread && properPosition) {
    console.log('[Offscreen] Detected: Head in Hands (両手で頭を抱える)');
    return { type: 'head_in_hands', emoji: '😢', message: '調子悪いので慰めて。。。；；' };
  }

  return null;
}

/**
 * 画像データからハンドサインを検出
 */
async function detectHandSign(imageData) {
  if (!isInitialized || !handLandmarker) {
    const success = await initDetector();
    if (!success) {
      return { success: false, error: 'Detector not initialized' };
    }
  }

  try {
    // ImageData から ImageBitmap を作成
    const imageBitmap = await createImageBitmap(
      new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height
      )
    );

    // 手を検出
    const results = handLandmarker.detect(imageBitmap);
    imageBitmap.close();

    if (!results.landmarks || results.landmarks.length === 0) {
      return { success: true, gesture: null };
    }

    // 両手が検出された場合、「頭を抱える」ジェスチャーをチェック
    if (results.landmarks.length >= 2) {
      const headInHandsGesture = detectHeadInHands(
        results.landmarks[0],
        results.landmarks[1]
      );
      if (headInHandsGesture) {
        return { success: true, gesture: headInHandsGesture };
      }
    }

    // 片手のジェスチャーをチェック
    const landmarks = results.landmarks[0];
    const gesture = detectGesture(landmarks);

    return { success: true, gesture };
  } catch (error) {
    console.error('[Offscreen] Detection error:', error);
    return { success: false, error: error.message };
  }
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  switch (message.type) {
    case 'INIT_DETECTOR':
      initDetector().then(result => {
        sendResponse(result);
      });
      return true;

    case 'DETECT_HAND_SIGN':
      detectHandSign(message.imageData).then(result => {
        sendResponse(result);
      });
      return true;

    case 'GET_STATUS':
      sendResponse({
        initialized: isInitialized,
        initializing: initPromise !== null && !isInitialized,
        lastError: lastInitError,
        faceApiInitialized: isFaceApiInitialized
      });
      return true;

    // 表情分析
    case 'INIT_FACE_API':
      initFaceApi().then(result => {
        sendResponse(result);
      });
      return true;

    case 'ANALYZE_EXPRESSION':
      analyzeExpression(message.imageData).then(result => {
        sendResponse(result);
      });
      return true;

    // 文字起こし関連
    case 'START_TRANSCRIPTION':
      sendResponse(startTranscription());
      return true;

    case 'STOP_TRANSCRIPTION':
      sendResponse(stopTranscription());
      return true;

    case 'GET_TRANSCRIPT':
      sendResponse(getTranscript());
      return true;

    // MP3変換
    case 'CONVERT_TO_MP3':
      convertToMp3(new Uint8Array(message.audioData).buffer).then(result => {
        sendResponse(result);
      });
      return true;

    // MP3変換（チャンク分割転送）
    case 'CONVERT_TO_MP3_CHUNK':
      handleMp3Chunk(message).then(result => {
        sendResponse(result);
      });
      return true;

    // MP3変換結果のチャンク取得
    case 'GET_MP3_RESULT_CHUNK':
      sendResponse(getMp3ResultChunk(message));
      return true;

    default:
      return false;
  }
});

// =============================================
// 文字起こし機能 (Web Speech API)
// =============================================

let speechRecognition = null;
let isTranscribing = false;
let transcriptText = '';
let lastInterimTranscript = ''; // 最後の暫定結果を保持
let networkErrorRetryCount = 0;
const MAX_NETWORK_RETRIES = 3;
const NETWORK_RETRY_DELAY = 2000; // 2秒待ってリトライ

/**
 * 文字起こしを開始
 */
function startTranscription() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('[Offscreen] Web Speech API not supported');
    return { success: false, error: 'Web Speech API not supported' };
  }

  if (isTranscribing) {
    return { success: true, message: 'Already transcribing' };
  }

  transcriptText = '';
  lastInterimTranscript = '';
  isTranscribing = true;
  networkErrorRetryCount = 0;

  speechRecognition = new SpeechRecognition();
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;
  speechRecognition.lang = 'ja-JP';

  speechRecognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    if (finalTranscript) {
      transcriptText += finalTranscript + '\n';
      lastInterimTranscript = ''; // 確定したらクリア
    } else {
      lastInterimTranscript = interimTranscript; // 暫定結果を保持
    }

    // Content Scriptに結果を送信
    chrome.runtime.sendMessage({
      type: 'TRANSCRIPTION_RESULT',
      transcript: transcriptText,
      interim: interimTranscript,
      isFinal: !!finalTranscript
    });
  };

  speechRecognition.onerror = (event) => {
    console.warn('[Offscreen] Speech recognition error:', event.error);

    if (event.error === 'network') {
      networkErrorRetryCount++;
      console.log(`[Offscreen] Network error, retry ${networkErrorRetryCount}/${MAX_NETWORK_RETRIES}`);

      if (networkErrorRetryCount <= MAX_NETWORK_RETRIES && isTranscribing) {
        // 再接続中のメッセージを文字起こしに追加
        const retryMessage = `\n[⏳ 再接続中... (${networkErrorRetryCount}/${MAX_NETWORK_RETRIES})]\n`;
        chrome.runtime.sendMessage({
          type: 'TRANSCRIPTION_RESULT',
          transcript: transcriptText + retryMessage,
          interim: '',
          isFinal: false
        });

        // 少し待ってから再接続を試みる
        setTimeout(() => {
          if (isTranscribing && speechRecognition) {
            try {
              speechRecognition.start();
              console.log('[Offscreen] Reconnected after network error');
              // 再接続成功メッセージを追加
              transcriptText += `\n[✓ 再接続成功]\n`;
              chrome.runtime.sendMessage({
                type: 'TRANSCRIPTION_RESULT',
                transcript: transcriptText,
                interim: '',
                isFinal: false
              });
              networkErrorRetryCount = 0;
            } catch (e) {
              console.warn('[Offscreen] Reconnection failed:', e);
            }
          }
        }, NETWORK_RETRY_DELAY);
        return;
      }

      // リトライ上限に達した場合はエラーメッセージを文字起こしに追加
      const errorMessage = `\n[❌ ネットワークエラー：再接続に失敗しました]\n`;
      transcriptText += errorMessage;
      isTranscribing = false;
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPTION_ERROR',
        error: 'network',
        message: 'ネットワークエラー：文字起こし利用不可',
        transcript: transcriptText
      });
      return;
    }

    if (event.error === 'not-allowed') {
      isTranscribing = false;
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPTION_ERROR',
        error: 'not-allowed',
        message: 'マイクへのアクセスが拒否されました'
      });
      return;
    }

    // no-speechエラーの場合は再起動
    if (event.error === 'no-speech' && isTranscribing) {
      setTimeout(() => {
        if (isTranscribing && speechRecognition) {
          try {
            speechRecognition.start();
          } catch (e) {}
        }
      }, 100);
    }
  };

  speechRecognition.onend = () => {
    // 再起動前に暫定結果があれば確定として保存
    if (lastInterimTranscript) {
      transcriptText += lastInterimTranscript + '\n';
      lastInterimTranscript = '';
      // 更新を通知
      chrome.runtime.sendMessage({
        type: 'TRANSCRIPTION_RESULT',
        transcript: transcriptText,
        interim: '',
        isFinal: true
      });
    }

    // まだ文字起こし中なら再開
    if (isTranscribing) {
      try {
        speechRecognition.start();
      } catch (e) {}
    }
  };

  try {
    speechRecognition.start();
    console.log('[Offscreen] Transcription started');
    return { success: true };
  } catch (e) {
    console.error('[Offscreen] Failed to start transcription:', e);
    isTranscribing = false;
    return { success: false, error: e.message };
  }
}

/**
 * 文字起こしを停止
 */
function stopTranscription() {
  isTranscribing = false;
  if (speechRecognition) {
    try {
      speechRecognition.stop();
    } catch (e) {}
    speechRecognition = null;
  }
  console.log('[Offscreen] Transcription stopped');
  return { success: true, transcript: transcriptText };
}

/**
 * 現在の文字起こしテキストを取得
 */
function getTranscript() {
  return { success: true, transcript: transcriptText, isTranscribing };
}

// =============================================
// 表情分析機能 (face-api.js)
// =============================================

/**
 * XHRでファイルを読み込む（chrome-extension:// URL対応）
 */
function loadFileXHR(url, responseType = 'arraybuffer') {
  return new Promise((resolve, reject) => {
    console.log('[Offscreen] XHR loading:', url);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = responseType;
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 0) {
        console.log('[Offscreen] XHR loaded:', url);
        resolve(xhr.response);
      } else {
        reject(new Error(`HTTP ${xhr.status} for ${url}`));
      }
    };
    xhr.onerror = (e) => {
      console.error('[Offscreen] XHR error:', url, e);
      reject(new Error('XHR failed for ' + url));
    };
    xhr.send();
  });
}

/**
 * face-api.js を初期化
 * XHRでモデルファイルを事前ロードし、カスタムIOHandlerを使用
 */
async function initFaceApi() {
  if (isFaceApiInitialized) return { success: true };

  if (faceApiInitPromise) {
    console.log('[Offscreen] Waiting for existing face-api initialization...');
    return faceApiInitPromise;
  }

  faceApiInitPromise = (async () => {
    try {
      console.log('[Offscreen] Initializing face-api.js...');

      // face-api.js がグローバルに読み込まれているか確認
      if (typeof faceapi === 'undefined') {
        throw new Error('face-api.js is not loaded');
      }

      const modelBasePath = chrome.runtime.getURL('lib/face-api/');
      console.log('[Offscreen] Face-api model path:', modelBasePath);

      // Tiny Face Detector モデルを読み込み
      console.log('[Offscreen] Loading Tiny Face Detector...');
      await loadFaceApiModel(faceapi.nets.tinyFaceDetector, modelBasePath, 'tiny_face_detector_model');
      console.log('[Offscreen] Tiny Face Detector loaded');

      // Face Expression モデルを読み込み
      console.log('[Offscreen] Loading Face Expression Net...');
      await loadFaceApiModel(faceapi.nets.faceExpressionNet, modelBasePath, 'face_expression_model');
      console.log('[Offscreen] Face Expression Net loaded');

      isFaceApiInitialized = true;
      console.log('[Offscreen] face-api.js initialized successfully');
      return { success: true };
    } catch (error) {
      const errorMsg = error?.message || String(error);
      console.error('[Offscreen] Failed to initialize face-api:', errorMsg, error);
      faceApiInitPromise = null;
      return { success: false, error: errorMsg };
    }
  })();

  return faceApiInitPromise;
}

/**
 * face-api.jsモデルをXHRで読み込む
 * TensorFlow.jsのdecodeWeightsを使用してweightsMapを作成し、loadFromWeightsMapで読み込み
 */
async function loadFaceApiModel(net, basePath, modelName) {
  // マニフェストファイルをXHRで読み込み
  const manifestUrl = basePath + modelName + '-weights_manifest.json';
  console.log('[Offscreen] Loading manifest:', manifestUrl);
  const manifestText = await loadFileXHR(manifestUrl, 'text');
  const manifest = JSON.parse(manifestText);
  console.log('[Offscreen] Manifest loaded, paths:', manifest[0].paths);

  // 全ての重みファイルをXHRで読み込み、TensorFlow.jsでデコード
  const weightsMap = {};
  for (const group of manifest) {
    for (const path of group.paths) {
      const weightsUrl = basePath + path;
      console.log('[Offscreen] Loading weights:', weightsUrl);
      const weightsBuffer = await loadFileXHR(weightsUrl, 'arraybuffer');
      console.log('[Offscreen] Weights loaded, size:', weightsBuffer.byteLength);

      // TensorFlow.jsを使って重みをデコード
      const weightSpecs = group.weights;
      console.log('[Offscreen] Decoding weights, specs count:', weightSpecs.length);

      try {
        // faceapi.tf.io.decodeWeights は weightsMap (name -> Tensor) を返す
        const decoded = faceapi.tf.io.decodeWeights(weightsBuffer, weightSpecs);
        console.log('[Offscreen] Decoded weights:', Object.keys(decoded));

        // weightsMapにマージ
        for (const [name, tensor] of Object.entries(decoded)) {
          weightsMap[name] = tensor;
        }
      } catch (decodeError) {
        console.error('[Offscreen] Failed to decode weights:', decodeError);
        throw decodeError;
      }
    }
  }

  console.log('[Offscreen] Total weights loaded:', Object.keys(weightsMap).length);

  // face-api.jsのloadFromUriを使用（fetchポリフィルでXHRに変換される）
  // URLの末尾にスラッシュがあることを確認
  const normalizedBasePath = basePath.endsWith('/') ? basePath : basePath + '/';
  console.log('[Offscreen] Loading model via loadFromUri:', normalizedBasePath);
  await net.loadFromUri(normalizedBasePath);
  console.log('[Offscreen] Model loaded successfully via loadFromUri');
}

/**
 * 表情を分析
 * @param {Object} imageData - 画像データ
 * @returns {Object} 分析結果（感情係数）
 */
async function analyzeExpression(imageData) {
  if (!isFaceApiInitialized) {
    const result = await initFaceApi();
    if (!result.success) {
      return { success: false, error: `Face-api init failed: ${result.error}` };
    }
  }

  try {
    // ImageData から Canvas を作成
    const canvas = document.getElementById('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(
      new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height
      ),
      0, 0
    );

    // 顔検出 + 表情分析
    // TinyFaceDetectorOptions:
    //   inputSize: 検出グリッドサイズ (128, 160, 224, 320, 416, 512, 608) - 小さいほど高速、大きいほど精度向上
    //   scoreThreshold: 検出閾値 (0-1) - 低いほど検出されやすい
    const detectorOptions = new faceapi.TinyFaceDetectorOptions({
      inputSize: 416,      // 画像サイズ640pxに合わせて大きめに設定（精度優先）
      scoreThreshold: 0.05 // 検出閾値を非常に低く設定（ほぼ全て検出）
    });
    const detections = await faceapi
      .detectAllFaces(canvas, detectorOptions)
      .withFaceExpressions();

    if (!detections || detections.length === 0) {
      return { success: true, expressions: null, message: '顔が検出されませんでした' };
    }

    // 最初の顔の表情を取得
    const expressions = detections[0].expressions;

    // 生の値をログ出力（デバッグ用）
    console.log('[Offscreen] Raw expressions:', {
      happy: expressions.happy.toFixed(4),
      sad: expressions.sad.toFixed(4),
      angry: expressions.angry.toFixed(4),
      fearful: expressions.fearful.toFixed(4),
      disgusted: expressions.disgusted.toFixed(4),
      surprised: expressions.surprised.toFixed(4),
      neutral: expressions.neutral.toFixed(4)
    });

    // 感情係数に変換（0-100のスコア、小数点1桁）
    const emotionScores = {
      happy: Math.round(expressions.happy * 1000) / 10,      // 幸福係数
      sad: Math.round(expressions.sad * 1000) / 10,          // 悲哀係数
      angry: Math.round(expressions.angry * 1000) / 10,      // 憤怒係数
      fearful: Math.round(expressions.fearful * 1000) / 10,  // 恐怖係数
      disgusted: Math.round(expressions.disgusted * 1000) / 10, // 嫌悪係数
      surprised: Math.round(expressions.surprised * 1000) / 10, // 驚愕係数
      neutral: Math.round(expressions.neutral * 1000) / 10   // 平静係数
    };

    // 最も高い感情を特定
    let dominant = 'neutral';
    let maxScore = emotionScores.neutral;
    for (const [emotion, score] of Object.entries(emotionScores)) {
      if (score > maxScore) {
        maxScore = score;
        dominant = emotion;
      }
    }

    console.log('[Offscreen] Expression analysis:', emotionScores, 'dominant:', dominant);

    return {
      success: true,
      expressions: emotionScores,
      dominant: dominant,
      faceCount: detections.length
    };
  } catch (error) {
    console.error('[Offscreen] Expression analysis error:', error);
    return { success: false, error: error.message };
  }
}

// =============================================
// MP3変換機能 (lamejs)
// =============================================

// チャンク転送用のセッション管理
const mp3ChunkSessions = new Map();

/**
 * WebM/Opus BlobをMP3に変換
 * @param {ArrayBuffer} audioData - WebM形式の音声データ
 * @returns {Object} 変換結果
 */
async function convertToMp3(audioData) {
  try {
    if (typeof lamejs === 'undefined') {
      throw new Error('lamejs is not loaded');
    }

    console.log('[Offscreen] Converting to MP3, input size:', audioData.byteLength);

    // Web Audio APIでデコード
    const tempAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await tempAudioContext.decodeAudioData(audioData);

    // サンプルレートとチャンネル数を取得
    const sampleRate = audioBuffer.sampleRate;
    const numberOfChannels = audioBuffer.numberOfChannels;

    console.log(`[Offscreen] Audio: ${sampleRate}Hz, ${numberOfChannels}ch, ${audioBuffer.duration.toFixed(2)}s`);

    // Float32Arrayを取得
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = numberOfChannels > 1 ? audioBuffer.getChannelData(1) : leftChannel;

    // MP3エンコーダーを初期化（128kbps）
    const mp3encoder = new lamejs.Mp3Encoder(numberOfChannels, sampleRate, 128);

    // Float32 -> Int16 に変換
    const leftSamples = floatTo16BitPCM(leftChannel);
    const rightSamples = numberOfChannels > 1 ? floatTo16BitPCM(rightChannel) : leftSamples;

    // MP3データを格納する配列
    const mp3Data = [];

    // エンコード（1152サンプルごとに処理）
    const sampleBlockSize = 1152;
    for (let i = 0; i < leftSamples.length; i += sampleBlockSize) {
      const leftChunk = leftSamples.subarray(i, i + sampleBlockSize);
      const rightChunk = rightSamples.subarray(i, i + sampleBlockSize);

      let mp3buf;
      if (numberOfChannels === 1) {
        mp3buf = mp3encoder.encodeBuffer(leftChunk);
      } else {
        mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      }

      if (mp3buf.length > 0) {
        mp3Data.push(new Uint8Array(mp3buf));
      }
    }

    // 最終フラッシュ
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }

    tempAudioContext.close();

    // MP3データを結合
    const totalLength = mp3Data.reduce((acc, arr) => acc + arr.length, 0);
    const mp3Array = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of mp3Data) {
      mp3Array.set(chunk, offset);
      offset += chunk.length;
    }

    console.log('[Offscreen] MP3 conversion complete, output size:', mp3Array.length);

    return {
      success: true,
      mp3Data: Array.from(mp3Array)
    };
  } catch (error) {
    console.error('[Offscreen] MP3 conversion error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Float32Array を Int16Array に変換
 */
function floatTo16BitPCM(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16Array;
}

// MP3変換結果を一時保存（チャンク取得用）
const mp3ResultSessions = new Map();

/**
 * MP3変換用のチャンクを受信・蓄積
 * 全チャンク受信後にMP3変換を実行
 * @param {Object} message - チャンクメッセージ
 * @returns {Object} 処理結果
 */
async function handleMp3Chunk(message) {
  const { sessionId, chunkIndex, totalChunks, chunkData, isLast } = message;

  console.log(`[Offscreen] Received chunk ${chunkIndex + 1}/${totalChunks} for session ${sessionId}`);

  // セッションが存在しない場合は作成
  if (!mp3ChunkSessions.has(sessionId)) {
    mp3ChunkSessions.set(sessionId, {
      chunks: new Array(totalChunks),
      receivedCount: 0,
      totalSize: 0
    });
  }

  const session = mp3ChunkSessions.get(sessionId);

  // チャンクを保存
  session.chunks[chunkIndex] = new Uint8Array(chunkData);
  session.receivedCount++;
  session.totalSize += chunkData.length;

  console.log(`[Offscreen] Session ${sessionId}: ${session.receivedCount}/${totalChunks} chunks received`);

  // 最終チャンクでない場合は確認応答のみ返す
  if (!isLast) {
    return { success: true, received: chunkIndex };
  }

  // 全チャンク受信完了、結合してMP3変換
  console.log(`[Offscreen] All chunks received, total size: ${session.totalSize}`);

  try {
    // チャンクを結合
    const combinedArray = new Uint8Array(session.totalSize);
    let offset = 0;
    for (const chunk of session.chunks) {
      combinedArray.set(chunk, offset);
      offset += chunk.length;
    }

    // セッションをクリーンアップ
    mp3ChunkSessions.delete(sessionId);

    // MP3変換を実行
    console.log(`[Offscreen] Starting MP3 conversion...`);
    const result = await convertToMp3(combinedArray.buffer);

    if (!result.success) {
      return result;
    }

    // 結果サイズをチェック（10MB以下なら直接返す）
    const RESPONSE_CHUNK_SIZE = 10 * 1024 * 1024;
    if (result.mp3Data.length <= RESPONSE_CHUNK_SIZE) {
      console.log(`[Offscreen] MP3 size ${result.mp3Data.length} bytes, returning directly`);
      return result;
    }

    // 大きい場合はチャンク分割で返す準備
    const mp3Array = new Uint8Array(result.mp3Data);
    const responseChunks = Math.ceil(mp3Array.length / RESPONSE_CHUNK_SIZE);

    console.log(`[Offscreen] MP3 size ${mp3Array.length} bytes, splitting into ${responseChunks} response chunks`);

    // 結果を保存
    mp3ResultSessions.set(sessionId, {
      mp3Data: mp3Array,
      totalChunks: responseChunks,
      chunkSize: RESPONSE_CHUNK_SIZE
    });

    return {
      success: true,
      chunkedResponse: true,
      sessionId: sessionId,
      totalChunks: responseChunks,
      totalSize: mp3Array.length
    };
  } catch (error) {
    mp3ChunkSessions.delete(sessionId);
    console.error('[Offscreen] Chunked MP3 conversion error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * MP3変換結果のチャンクを取得
 * @param {Object} message - 取得リクエスト
 * @returns {Object} チャンクデータ
 */
function getMp3ResultChunk(message) {
  const { sessionId, chunkIndex } = message;

  const session = mp3ResultSessions.get(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  const start = chunkIndex * session.chunkSize;
  const end = Math.min(start + session.chunkSize, session.mp3Data.length);
  const chunk = session.mp3Data.slice(start, end);
  const isLast = chunkIndex === session.totalChunks - 1;

  console.log(`[Offscreen] Sending MP3 result chunk ${chunkIndex + 1}/${session.totalChunks}, size: ${chunk.length}`);

  // 最後のチャンクならセッションをクリーンアップ
  if (isLast) {
    mp3ResultSessions.delete(sessionId);
    console.log(`[Offscreen] MP3 result session ${sessionId} cleaned up`);
  }

  return {
    success: true,
    chunkData: Array.from(chunk),
    chunkIndex: chunkIndex,
    isLast: isLast
  };
}

// 初期化を開始
initDetector();
