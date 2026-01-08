/**
 * Remowork Hand Sign Detector
 * 在席確認画像からハンドサインを検出し、通知を表示する
 */

(function() {
  'use strict';

  const DETECTION_INTERVAL = 10000; // 10秒ごとにチェック（画像URL変更検知用、キャッシュがあれば軽量）
  const NOTIFICATION_COOLDOWN = 300000; // 同じ人からの通知は5分間抑制
  const PHOTO_INTERVAL = 297; // 写真撮影間隔（4分57秒）- Remoworkより少し早めにカウントダウン終了

  // ジェスチャータイプの設定
  const GESTURE_CONFIG = {
    wave: { emoji: '👋', guide: '手を振って', negative: false },
    thumbsup: { emoji: '👍', guide: 'サムズアップで', negative: false },
    peace: { emoji: '✌️', guide: 'ピースして', negative: false },
    head_in_hands: { emoji: '😢', guide: '頭を抱えて', negative: true }
  };

  // ジェスチャータイプ一覧
  const GESTURE_TYPES = Object.keys(GESTURE_CONFIG);

  // ポジティブなジェスチャーのみ（留守モードで使用）
  const POSITIVE_GESTURE_TYPES = GESTURE_TYPES.filter(type => !GESTURE_CONFIG[type].negative);

  /**
   * ジェスチャータイプから絵文字を取得
   */
  function getGestureEmoji(type) {
    return GESTURE_CONFIG[type]?.emoji || '👋';
  }

  /**
   * ジェスチャータイプから撮影ガイドを取得
   */
  function getGestureGuide(type) {
    return GESTURE_CONFIG[type]?.guide || '手を振って';
  }

  /**
   * ジェスチャータイプがネガティブかどうか
   */
  function isNegativeGesture(type) {
    return GESTURE_CONFIG[type]?.negative || false;
  }

  // 検出済みの画像URLを記録（重複検出防止）
  const processedImages = new Map();
  // 通知クールダウン管理
  const notificationCooldowns = new Map();
  // タイマー関連
  let timerElement = null;
  let remainingSeconds = PHOTO_INTERVAL;
  let lastMyImageUrl = null;
  let timerInterval = null;

  // 設定（デフォルト値）
  let settings = {
    enabled: true,
    myName: '',
    detectAll: true,
    targetMembers: [],
    notifications: {
      toast: true,
      sound: true,
      soundPreset: 'outgoing:outgoing_horn' // デフォルトは法螺貝
    }
  };

  // オフスクリーンAPI経由でハンド検出
  let isDetectorReady = false;

  // LLM設定（自動構造化用）
  let llmSettings = null;

  // プリセット音声（カウントダウン音などで使用）
  let presetSounds = null;

  /**
   * 拡張機能コンテキストが有効かチェック
   */
  function isExtensionContextValid() {
    try {
      return chrome.runtime && chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  /**
   * 設定を読み込む
   */
  async function loadSettings() {
    if (!isExtensionContextValid()) {
      console.warn('[HandSign] Extension context invalidated, please reload the page');
      return;
    }
    try {
      const result = await chrome.storage.local.get('handSignSettings');
      if (result.handSignSettings) {
        settings = { ...settings, ...result.handSignSettings };
      }
      console.log('[HandSign] Settings loaded:', settings);
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        console.warn('[HandSign] Extension was updated, please reload the page');
      } else {
        console.error('[HandSign] Failed to load settings:', error);
      }
    }
  }

  /**
   * 自分の名前をページから自動検出
   */
  function detectMyName() {
    // login-user クラスを持つ要素から自分の名前を取得
    const loginUserElement = document.querySelector('.user-picture-container.login-user .user-name');
    if (loginUserElement) {
      const name = loginUserElement.textContent.trim();
      if (name && !settings.myName) {
        settings.myName = name;
        console.log('[HandSign] Detected my name:', name);
        // 設定を保存
        chrome.storage.local.set({ handSignSettings: settings });
      }
    }
  }

  /**
   * 自分の画像URLを取得
   */
  function getMyImageUrl() {
    const loginUserContainer = document.querySelector('.user-picture-container.login-user');
    if (loginUserContainer) {
      const imageElement = loginUserContainer.querySelector('.v-image__image');
      if (imageElement) {
        const style = imageElement.getAttribute('style') || '';
        const match = style.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);
        if (match && match[1]) {
          return match[1];
        }
      }
    }
    return null;
  }

  /**
   * Remoworkで自分が「離席中」かどうかを判定
   * 離席中の場合はカメラ送信・カウントダウン音が不要
   */
  function isRemoworkAway() {
    const loginUserContainer = document.querySelector('.user-picture-container.login-user');
    if (!loginUserContainer) return false;

    // 離席ステータスを示す要素を探す（複数パターン対応）
    // パターン1: ステータステキスト
    const statusText = loginUserContainer.querySelector('.user-status, .status-text, [class*="status"]');
    if (statusText) {
      const text = statusText.textContent.toLowerCase();
      if (text.includes('離席') || text.includes('away') || text.includes('休憩')) {
        return true;
      }
    }

    // パターン2: 離席アイコン・クラス
    if (loginUserContainer.classList.contains('away') ||
        loginUserContainer.classList.contains('absent') ||
        loginUserContainer.querySelector('.away-icon, .absent-icon, [class*="away"], [class*="absent"]')) {
      return true;
    }

    // パターン3: グレーアウト表示（離席時によく使われる）
    const opacity = window.getComputedStyle(loginUserContainer).opacity;
    if (parseFloat(opacity) < 0.7) {
      return true;
    }

    return false;
  }

  /**
   * タイマーUIを作成
   */
  function createTimerUI() {
    if (timerElement) return;

    timerElement = document.createElement('div');
    timerElement.id = 'rsc-photo-timer';
    timerElement.innerHTML = `
      <div class="rsc-timer-main">
        <div class="rsc-timer-icon">📷</div>
        <div class="rsc-timer-text">
          <span class="rsc-timer-label">次の撮影まで</span>
          <span class="rsc-timer-value">5:00</span>
          <span class="rsc-countdown-badge">🔇OFF</span>
        </div>
      </div>
      <div class="rsc-timer-rows">
        <div class="rsc-timer-row">
          <button class="rsc-send-btn" data-type="wave" title="👋を次回送信">👋</button>
          <button class="rsc-send-btn" data-type="thumbsup" title="👍を次回送信">👍</button>
          <button class="rsc-send-btn" data-type="peace" title="✌️を次回送信">✌️</button>
          <button class="rsc-send-btn" data-type="head_in_hands" title="😢を次回送信">😢</button>
          <button class="rsc-away-btn" title="留守モード（30分間自動送信）">🏃 留守</button>
          <div class="rsc-timer-divider"></div>
          <button class="rsc-record-btn" title="録音">🎙️ 録音</button>
        </div>
        <div class="rsc-timer-row">
          <button class="rsc-expression-btn" title="感情係数を表示">🎭 感情係数</button>
          <button class="rsc-tools-btn" title="事前撮影">📸 事前撮影</button>
          <button class="rsc-sound-btn" title="音声変更">🔊 音声変更</button>
          <button class="rsc-notify-btn" title="通知設定">🔔 通知設定</button>
        </div>
        <div class="rsc-team-mood" title="チーム全体のムード">
          <span class="rsc-team-mood-label">Team Mood:</span>
          <span class="rsc-team-mood-emoji">😐</span>
          <span class="rsc-team-mood-text">Neutral</span>
        </div>
      </div>
    `;

    document.body.appendChild(timerElement);

    // スタイルを追加
    if (!document.getElementById('rsc-timer-styles')) {
      const style = document.createElement('style');
      style.id = 'rsc-timer-styles';
      style.textContent = `
        #rsc-photo-timer {
          position: fixed;
          bottom: 20px;
          left: 20px;
          background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
          color: white;
          padding: 10px 16px;
          border-radius: 10px;
          z-index: 100000;
          font-size: 14px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          opacity: 0.9;
          transition: opacity 0.2s, box-shadow 0.2s;
          user-select: none;
        }
        #rsc-photo-timer:hover {
          opacity: 1;
        }
        .rsc-timer-main {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          border-radius: 6px;
          padding: 4px;
          margin: -4px;
          transition: background 0.2s;
        }
        .rsc-timer-main:hover {
          background: rgba(255,255,255,0.1);
        }
        .rsc-countdown-badge {
          font-size: 9px;
          padding: 1px 5px;
          border-radius: 3px;
          background: rgba(255,255,255,0.15);
          color: #a0aec0;
          margin-top: 2px;
        }
        .rsc-timer-main.rsc-countdown-enabled .rsc-countdown-badge {
          background: rgba(72, 187, 120, 0.3);
          color: #68d391;
        }
        .rsc-timer-rows {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-left: 12px;
          padding-left: 12px;
          border-left: 1px solid rgba(255,255,255,0.2);
        }
        .rsc-timer-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        #rsc-photo-timer.rsc-dragging {
          opacity: 1;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        }
        #rsc-photo-timer.rsc-timer-hidden {
          display: none;
        }
        .rsc-timer-icon {
          font-size: 20px;
        }
        .rsc-timer-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .rsc-timer-label {
          font-size: 11px;
          color: #a0aec0;
        }
        .rsc-timer-value {
          font-size: 18px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        #rsc-photo-timer.rsc-timer-soon .rsc-timer-value {
          color: #fc8181;
        }
        #rsc-photo-timer.rsc-timer-flash {
          animation: rsc-timer-flash 0.5s ease-out;
        }
        @keyframes rsc-timer-flash {
          0% { background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); }
          100% { background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%); }
        }
        .rsc-send-btn {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 6px;
          background: rgba(255,255,255,0.15);
          font-size: 16px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .rsc-send-btn:hover {
          background: rgba(255,255,255,0.25);
          transform: scale(1.1);
        }
        .rsc-send-btn:active {
          transform: scale(0.95);
        }
        .rsc-send-btn.rsc-active {
          background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
          box-shadow: 0 0 8px rgba(72, 187, 120, 0.5);
        }
        .rsc-send-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
        .rsc-away-btn {
          height: 32px;
          padding: 0 10px;
          border: none;
          border-radius: 6px;
          background: rgba(255,255,255,0.15);
          color: #fff;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .rsc-away-btn:hover {
          background: rgba(255,255,255,0.25);
          transform: scale(1.05);
        }
        .rsc-away-btn.rsc-active {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
          animation: rsc-away-pulse 2s infinite;
        }
        @keyframes rsc-away-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .rsc-notify-btn {
          height: 32px;
          padding: 0 10px;
          border: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);
          font-size: 13px;
          color: #fff;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          white-space: nowrap;
        }
        .rsc-notify-btn:hover {
          background: linear-gradient(135deg, #f6ad55 0%, #ed8936 100%);
          transform: scale(1.05);
        }
        .rsc-tools-btn {
          height: 32px;
          padding: 0 10px;
          border: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #fff;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .rsc-tools-btn:hover {
          transform: scale(1.05);
          box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
        }
        .rsc-sound-btn {
          height: 32px;
          padding: 0 10px;
          border: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          font-size: 13px;
          color: #fff;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          white-space: nowrap;
        }
        .rsc-sound-btn:hover {
          background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
          transform: scale(1.05);
        }
        .rsc-timer-divider {
          width: 1px;
          height: 24px;
          background: rgba(255,255,255,0.3);
          margin: 0 4px;
        }
        .rsc-record-btn {
          height: 32px;
          padding: 0 10px;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          color: #fff;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          white-space: nowrap;
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        }
        .rsc-record-btn:hover {
          background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
          transform: scale(1.05);
        }
        .rsc-expression-btn {
          height: 32px;
          padding: 0 10px;
          border: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
          font-size: 13px;
          color: #fff;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          white-space: nowrap;
        }
        .rsc-expression-btn:hover {
          background: linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%);
          transform: scale(1.05);
        }
        .rsc-expression-btn.rsc-active {
          background: linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%);
          box-shadow: 0 0 8px rgba(139, 92, 246, 0.6);
        }
        /* チーム全体のムード表示 */
        .rsc-team-mood {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 8px;
          margin-top: 4px;
          transition: all 0.3s;
        }
        .rsc-team-mood-label {
          color: #888;
          font-size: 11px;
        }
        .rsc-team-mood-emoji {
          font-size: 18px;
          transition: transform 0.3s;
        }
        .rsc-team-mood-text {
          font-size: 12px;
          font-weight: bold;
          transition: color 0.3s;
        }
        /* 感情係数オーバーレイ（PSYCHO-PASS風） */
        .rsc-expression-overlay {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.85) 100%);
          padding: 8px 6px 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-family: 'Consolas', 'Monaco', monospace;
          z-index: 10;
        }
        .rsc-expression-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          color: #00ff88;
          text-shadow: 0 0 4px rgba(0, 255, 136, 0.5);
        }
        .rsc-expression-item.dominant {
          color: #ff6b6b;
          text-shadow: 0 0 6px rgba(255, 107, 107, 0.7);
          font-weight: bold;
        }
        .rsc-expression-emoji {
          font-size: 12px;
          filter: drop-shadow(0 0 2px currentColor);
        }
        .rsc-expression-label {
          flex: 1;
          letter-spacing: 0.5px;
        }
        .rsc-expression-score {
          font-weight: bold;
          min-width: 24px;
          text-align: right;
        }
        .rsc-expression-score::after {
          content: '%';
          font-size: 8px;
          opacity: 0.7;
        }
        .rsc-radar-chart {
          display: block;
          filter: drop-shadow(0 0 4px rgba(0, 255, 136, 0.5));
        }
        /* チャート・パラメータ・NotFound共通のボックススタイル */
        .rsc-expression-overlay.chart-mode,
        .rsc-expression-overlay.parameter-mode {
          position: absolute;
          bottom: 22px;
          right: 2px;
          top: auto;
          left: auto;
          width: 50px;
          height: 50px;
          background: rgba(0, 0, 0, 0.3);
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          pointer-events: auto;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .rsc-expression-overlay.chart-mode:hover,
        .rsc-expression-overlay.parameter-mode:hover {
          transform: scale(1.1);
          box-shadow: 0 0 8px rgba(0, 255, 136, 0.6);
        }
        /* 検出なし表示（チャートと同じサイズ 50x50） */
        .rsc-expression-notfound {
          /* 親の共通ボックススタイルを継承 */
        }
        .rsc-expression-notfound-text {
          color: #888;
          font-size: 8px;
          white-space: nowrap;
          text-align: center;
        }
        /* 感情詳細モーダル */
        .rsc-expression-modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 100010;
          display: none;
        }
        .rsc-expression-modal.rsc-active {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .rsc-expression-modal-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
        }
        .rsc-expression-modal-content {
          position: relative;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border: 1px solid rgba(0, 255, 136, 0.4);
          border-radius: 16px;
          padding: 20px;
          min-width: 280px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 255, 136, 0.2);
        }
        .rsc-expression-modal-close {
          position: absolute;
          top: 8px;
          right: 12px;
          background: none;
          border: none;
          color: #888;
          font-size: 24px;
          cursor: pointer;
          transition: color 0.2s;
        }
        .rsc-expression-modal-close:hover {
          color: #ff6b6b;
        }
        .rsc-expression-modal-name {
          color: #00ff88;
          font-size: 16px;
          font-weight: bold;
          text-align: center;
          margin-bottom: 16px;
          text-shadow: 0 0 4px rgba(0, 255, 136, 0.5);
        }
        .rsc-expression-modal-chart {
          display: flex;
          justify-content: center;
          margin-bottom: 16px;
        }
        .rsc-expression-modal-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .rsc-expression-modal-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
        }
        .rsc-expression-modal-item-emoji {
          font-size: 20px;
        }
        .rsc-expression-modal-item-label {
          color: #e0e0e0;
          font-size: 14px;
          flex: 1;
        }
        .rsc-expression-modal-item-score {
          color: #00ff88;
          font-size: 16px;
          font-weight: bold;
        }
        .rsc-expression-modal-item.dominant {
          background: rgba(0, 255, 136, 0.15);
          border: 1px solid rgba(0, 255, 136, 0.3);
        }
        .rsc-expression-modal-item.dominant .rsc-expression-modal-item-score {
          color: #ff6b6b;
          text-shadow: 0 0 4px rgba(255, 107, 107, 0.5);
        }
        .rsc-expression-single {
          /* 親の共通ボックススタイルを継承 */
        }
        .rsc-expression-text {
          color: #ff6b35;
          font-size: 10px;
          font-weight: bold;
          text-shadow: 0 0 3px #ff6b35, 0 0 6px rgba(255, 107, 53, 0.5);
          white-space: nowrap;
        }
        /* 感情係数選択メニュー */
        .rsc-expression-menu {
          position: fixed;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          border: 1px solid rgba(139, 92, 246, 0.4);
          border-radius: 12px;
          padding: 16px;
          z-index: 100002;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 20px rgba(139, 92, 246, 0.2);
          min-width: 280px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .rsc-expression-menu-title {
          color: #a78bfa;
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .rsc-expression-menu-subtitle {
          color: #888;
          font-size: 11px;
          margin-bottom: 10px;
        }
        .rsc-expression-menu-items {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .rsc-expression-menu-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .rsc-expression-menu-item:hover {
          background: rgba(139, 92, 246, 0.2);
        }
        .rsc-expression-menu-item.selected {
          background: rgba(139, 92, 246, 0.3);
          border: 1px solid rgba(139, 92, 246, 0.5);
        }
        .rsc-expression-menu-item input[type="checkbox"] {
          width: 16px;
          height: 16px;
          accent-color: #8b5cf6;
        }
        .rsc-expression-menu-item-emoji {
          font-size: 18px;
        }
        .rsc-expression-menu-item-label {
          color: #e0e0e0;
          font-size: 13px;
          flex: 1;
        }
        .rsc-expression-menu-actions {
          display: flex;
          gap: 8px;
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        .rsc-expression-menu-btn {
          flex: 1;
          padding: 8px 14px;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .rsc-expression-menu-btn.primary {
          background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
          color: #fff;
        }
        .rsc-expression-menu-btn.primary:hover {
          transform: scale(1.02);
          box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
        }
        .rsc-expression-menu-btn.secondary {
          background: rgba(255, 255, 255, 0.1);
          color: #aaa;
        }
        .rsc-expression-menu-btn.secondary:hover {
          background: rgba(255, 255, 255, 0.15);
        }
        .rsc-expression-menu-btn.danger {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: #fff;
        }
        .rsc-expression-menu-btn.danger:hover {
          transform: scale(1.02);
          box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
        }
        .rsc-expression-menu-section {
          margin-bottom: 12px;
        }
        .rsc-expression-display-modes {
          display: flex;
          gap: 8px;
        }
        .rsc-expression-mode-item {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          border: 1px solid transparent;
        }
        .rsc-expression-mode-item:hover {
          background: rgba(139, 92, 246, 0.2);
        }
        .rsc-expression-mode-item.selected {
          background: rgba(139, 92, 246, 0.3);
          border-color: rgba(139, 92, 246, 0.5);
        }
        .rsc-expression-mode-item input[type="radio"] {
          display: none;
        }
        .rsc-expression-mode-icon {
          font-size: 18px;
        }
        .rsc-expression-mode-label {
          color: #e0e0e0;
          font-size: 12px;
        }
      `;
      document.head.appendChild(style);
    }

    // ボタンのクリックハンドラー
    setupSendButtons();

    // 通知設定ボタンのハンドラー
    setupNotifyButton();

    // 事前撮影ボタンのハンドラー
    setupToolsButton();

    // 感情係数ボタンのハンドラー
    setupExpressionButton();

    // ドラッグ機能
    setupDraggable();
  }

  /**
   * 事前撮影ボタンのクリックハンドラー
   */
  function setupToolsButton() {
    const toolsBtn = timerElement.querySelector('.rsc-tools-btn');
    if (toolsBtn) {
      toolsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openToolsModal('camera');
      });
    }

    // 録音ボタン（3ボタン）
    setupTimerRecordButtons();

    // 音声設定ボタン
    const soundBtn = timerElement.querySelector('.rsc-sound-btn');
    if (soundBtn) {
      soundBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSoundSettingsModal();
      });
    }

    // タイマーメイン（カウントダウン音ON/OFF）
    const timerMain = timerElement.querySelector('.rsc-timer-main');
    if (timerMain) {
      timerMain.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCountdownSound();
      });
      // 初期状態を設定
      updateCountdownSoundIndicator();
    }
  }

  /**
   * カウントダウン音ON/OFF切り替え
   */
  async function toggleCountdownSound() {
    settings.countdown = settings.countdown || {};
    settings.countdown.enabled = !settings.countdown.enabled;
    await chrome.storage.local.set({ handSignSettings: settings });
    updateCountdownSoundIndicator();
    showTimerToast(settings.countdown.enabled ? 'カウントダウン音 ON' : 'カウントダウン音 OFF');
  }

  /**
   * カウントダウン音の表示インジケーター更新
   */
  function updateCountdownSoundIndicator() {
    const timerMain = timerElement?.querySelector('.rsc-timer-main');
    const badge = timerElement?.querySelector('.rsc-countdown-badge');
    if (timerMain && badge) {
      if (settings.countdown?.enabled) {
        timerMain.classList.add('rsc-countdown-enabled');
        badge.textContent = '🔊ON';
      } else {
        timerMain.classList.remove('rsc-countdown-enabled');
        badge.textContent = '🔇OFF';
      }
    }
  }

  /**
   * 感情係数ボタンのクリックハンドラー
   */
  function setupExpressionButton() {
    const expressionBtn = timerElement.querySelector('.rsc-expression-btn');
    if (expressionBtn) {
      expressionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openExpressionMenu(expressionBtn);
      });
    }
  }

  /**
   * 感情係数選択メニューを開く
   */
  function openExpressionMenu(anchorElement) {
    // 既存のメニューを閉じる
    closeExpressionMenu();

    const menu = document.createElement('div');
    menu.className = 'rsc-expression-menu';
    menu.id = 'rsc-expression-menu';

    // パラメータ表示用：ラジオボタン形式（1つの感情のみ選択可能）
    const emotionKeys = Object.keys(EMOTION_LABELS);
    const parameterItemsHtml = emotionKeys.map(key => {
      const isSelected = selectedSingleEmotion === key;
      const label = EMOTION_LABELS[key];
      const emoji = EMOTION_EMOJI[key];
      return `
        <label class="rsc-expression-menu-item ${isSelected ? 'selected' : ''}" data-emotion="${key}">
          <input type="radio" name="singleEmotion" value="${key}" ${isSelected ? 'checked' : ''}>
          <span class="rsc-expression-menu-item-emoji">${emoji}</span>
          <span class="rsc-expression-menu-item-label">${label}</span>
        </label>
      `;
    }).join('');

    menu.innerHTML = `
      <div class="rsc-expression-menu-title">🎭 感情係数設定</div>
      <div class="rsc-expression-menu-section">
        <div class="rsc-expression-menu-subtitle">表示形式</div>
        <div class="rsc-expression-display-modes">
          <label class="rsc-expression-mode-item ${expressionDisplayMode === 'chart' ? 'selected' : ''}" data-mode="chart">
            <input type="radio" name="displayMode" value="chart" ${expressionDisplayMode === 'chart' ? 'checked' : ''}>
            <span class="rsc-expression-mode-icon">📊</span>
            <span class="rsc-expression-mode-label">チャート</span>
          </label>
          <label class="rsc-expression-mode-item ${expressionDisplayMode === 'parameter' ? 'selected' : ''}" data-mode="parameter">
            <input type="radio" name="displayMode" value="parameter" ${expressionDisplayMode === 'parameter' ? 'checked' : ''}>
            <span class="rsc-expression-mode-icon">📈</span>
            <span class="rsc-expression-mode-label">パラメータ</span>
          </label>
        </div>
      </div>
      <div class="rsc-expression-menu-section rsc-parameter-section" style="${expressionDisplayMode === 'parameter' ? '' : 'display: none;'}">
        <div class="rsc-expression-menu-subtitle">表示する係数</div>
        <div class="rsc-expression-menu-items">
          ${parameterItemsHtml}
        </div>
      </div>
      <div class="rsc-expression-menu-actions">
        <button class="rsc-expression-menu-btn secondary" data-action="close">閉じる</button>
        <button class="rsc-expression-menu-btn ${expressionAnalysisEnabled ? 'primary' : 'secondary'}" data-action="analyze">
          ${expressionAnalysisEnabled ? 'ON' : 'OFF'}
        </button>
      </div>
    `;

    // 位置を設定（ボタンの上・中央寄せで表示）
    const rect = anchorElement.getBoundingClientRect();
    menu.style.bottom = `${window.innerHeight - rect.top + 10}px`;
    // メニューの幅（min-width: 280px）を考慮して中央寄せ
    const menuWidth = 280;
    const leftPos = Math.max(20, rect.left + rect.width / 2 - menuWidth / 2);
    menu.style.left = `${leftPos}px`;

    document.body.appendChild(menu);

    // 表示形式選択のイベントハンドラー
    menu.querySelectorAll('.rsc-expression-mode-item').forEach(item => {
      item.addEventListener('click', () => {
        const mode = item.dataset.mode;
        expressionDisplayMode = mode;

        // 選択状態を更新
        menu.querySelectorAll('.rsc-expression-mode-item').forEach(m => {
          m.classList.toggle('selected', m.dataset.mode === mode);
          m.querySelector('input').checked = m.dataset.mode === mode;
        });

        // パラメータセクションの表示/非表示を切り替え
        const parameterSection = menu.querySelector('.rsc-parameter-section');
        if (parameterSection) {
          parameterSection.style.display = mode === 'parameter' ? '' : 'none';
        }

        // 設定を保存
        saveExpressionSettings();

        // 分析中なら再描画
        if (expressionAnalysisEnabled) {
          analyzeAllExpressions();
        }
      });
    });

    // 感情選択のイベントハンドラー（パラメータ表示用：1つの感情のみ選択）
    menu.querySelectorAll('.rsc-expression-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        const emotion = item.dataset.emotion;
        selectedSingleEmotion = emotion;

        // 選択状態を更新
        menu.querySelectorAll('.rsc-expression-menu-item').forEach(m => {
          m.classList.toggle('selected', m.dataset.emotion === emotion);
          m.querySelector('input').checked = m.dataset.emotion === emotion;
        });

        // 設定を保存
        saveExpressionSettings();

        // 分析中なら再描画
        if (expressionAnalysisEnabled) {
          analyzeAllExpressions();
        }
      });
    });

    // アクションボタン
    menu.querySelector('[data-action="close"]').addEventListener('click', closeExpressionMenu);
    menu.querySelector('[data-action="analyze"]').addEventListener('click', async () => {
      expressionAnalysisEnabled = !expressionAnalysisEnabled;

      const btn = timerElement.querySelector('.rsc-expression-btn');
      if (btn) {
        btn.classList.toggle('rsc-active', expressionAnalysisEnabled);
      }

      if (expressionAnalysisEnabled) {
        // 感情分析を開始（オフスクリーン経由）
        showTimerToast('感情係数の分析を開始...');
        analyzeAllExpressions();
      } else {
        // オーバーレイを削除
        document.querySelectorAll('.rsc-expression-overlay').forEach(el => el.remove());
        showTimerToast('感情係数の分析を停止');
      }

      // 設定を保存
      saveExpressionSettings();
      closeExpressionMenu();
    });

    // 外側クリックで閉じる
    setTimeout(() => {
      document.addEventListener('click', handleExpressionMenuOutsideClick);
    }, 0);
  }

  /**
   * 感情係数メニューを閉じる
   */
  function closeExpressionMenu() {
    const menu = document.getElementById('rsc-expression-menu');
    if (menu) menu.remove();
    document.removeEventListener('click', handleExpressionMenuOutsideClick);
  }

  /**
   * メニュー外クリックハンドラー
   */
  function handleExpressionMenuOutsideClick(e) {
    const menu = document.getElementById('rsc-expression-menu');
    if (menu && !menu.contains(e.target) && !e.target.closest('.rsc-expression-btn')) {
      closeExpressionMenu();
    }
  }

  /**
   * 感情係数設定を保存
   */
  async function saveExpressionSettings() {
    try {
      settings.expression = settings.expression || {};
      settings.expression.selectedEmotions = selectedEmotions;
      settings.expression.displayMode = expressionDisplayMode;
      settings.expression.singleEmotion = selectedSingleEmotion;
      settings.expression.enabled = expressionAnalysisEnabled;
      await chrome.storage.local.set({ handSignSettings: settings });
    } catch (error) {
      console.error('[HandSign] Failed to save expression settings:', error);
    }
  }

  /**
   * 感情係数設定を読み込む
   */
  async function loadExpressionSettings() {
    try {
      const result = await chrome.storage.local.get('handSignSettings');
      if (result.handSignSettings?.expression) {
        if (result.handSignSettings.expression.selectedEmotions) {
          selectedEmotions = result.handSignSettings.expression.selectedEmotions;
        }
        if (result.handSignSettings.expression.displayMode) {
          expressionDisplayMode = result.handSignSettings.expression.displayMode;
        }
        if (result.handSignSettings.expression.singleEmotion) {
          selectedSingleEmotion = result.handSignSettings.expression.singleEmotion;
        }
        if (typeof result.handSignSettings.expression.enabled === 'boolean') {
          expressionAnalysisEnabled = result.handSignSettings.expression.enabled;
        }
      }
    } catch (error) {
      console.error('[HandSign] Failed to load expression settings:', error);
    }
  }

  // ドラッグ関連の変数
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let timerStartX = 0;
  let timerStartY = 0;

  /**
   * ドラッグ機能のセットアップ
   */
  function setupDraggable() {
    if (!timerElement) return;

    // 保存された位置を復元
    chrome.storage.local.get(['timerPosition'], (result) => {
      if (result.timerPosition) {
        timerElement.style.left = result.timerPosition.left;
        timerElement.style.top = result.timerPosition.top;
        timerElement.style.bottom = 'auto';
        timerElement.style.right = 'auto';
      }
    });

    timerElement.addEventListener('mousedown', onDragStart);
    timerElement.addEventListener('touchstart', onDragStart, { passive: false });
  }

  /**
   * ドラッグ開始
   */
  function onDragStart(e) {
    // ボタンクリックは除外（タイマーメインのクリックも含む）
    if (e.target.closest('.rsc-send-btn') || e.target.closest('.rsc-notify-btn') || e.target.closest('.rsc-tools-btn') || e.target.closest('.rsc-away-btn') || e.target.closest('.rsc-record-btn') || e.target.closest('.rsc-sound-btn') || e.target.closest('.rsc-timer-main')) return;

    isDragging = true;
    timerElement.classList.add('rsc-dragging');

    const rect = timerElement.getBoundingClientRect();
    timerStartX = rect.left;
    timerStartY = rect.top;

    if (e.type === 'touchstart') {
      dragStartX = e.touches[0].clientX;
      dragStartY = e.touches[0].clientY;
      e.preventDefault();
    } else {
      dragStartX = e.clientX;
      dragStartY = e.clientY;
    }

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);
  }

  /**
   * ドラッグ中
   */
  function onDragMove(e) {
    if (!isDragging) return;

    let clientX, clientY;
    if (e.type === 'touchmove') {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
      e.preventDefault();
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const deltaX = clientX - dragStartX;
    const deltaY = clientY - dragStartY;

    let newX = timerStartX + deltaX;
    let newY = timerStartY + deltaY;

    // 画面外に出ないように制限
    const rect = timerElement.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width;
    const maxY = window.innerHeight - rect.height;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    timerElement.style.left = newX + 'px';
    timerElement.style.top = newY + 'px';
    timerElement.style.bottom = 'auto';
    timerElement.style.right = 'auto';
  }

  /**
   * ドラッグ終了
   */
  function onDragEnd() {
    if (!isDragging) return;

    isDragging = false;
    timerElement.classList.remove('rsc-dragging');

    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend', onDragEnd);

    // 位置を保存
    chrome.storage.local.set({
      timerPosition: {
        left: timerElement.style.left,
        top: timerElement.style.top
      }
    });
  }

  // 現在有効なハンドサインタイプ
  let activeHandSignType = null;

  // 留守モード関連
  let isAwayMode = false;
  let awayModeTimeout = null;
  let awayModeEndTime = null;
  let awayModeDuration = 30 * 60 * 1000; // デフォルト30分

  /**
   * 送信ボタンのセットアップ
   */
  function setupSendButtons() {
    const buttons = timerElement.querySelectorAll('.rsc-send-btn');
    buttons.forEach(btn => {
      let longPressTimer = null;
      let isLongPress = false;

      const startLongPress = () => {
        isLongPress = false;
        longPressTimer = setTimeout(() => {
          isLongPress = true;
          const type = btn.dataset.type;
          // 長押しで解除（有効なボタンの場合のみ）
          if (activeHandSignType === type) {
            activeHandSignType = null;
            btn.classList.remove('rsc-active');
            disableVirtualCamera();
            showTimerToast('通常カメラに戻りました');
          }
        }, 500);
      };

      const cancelLongPress = () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      };

      btn.addEventListener('mousedown', startLongPress);
      btn.addEventListener('touchstart', startLongPress, { passive: true });
      btn.addEventListener('mouseup', cancelLongPress);
      btn.addEventListener('mouseleave', cancelLongPress);
      btn.addEventListener('touchend', cancelLongPress);
      btn.addEventListener('touchcancel', cancelLongPress);

      btn.addEventListener('click', () => {
        if (isLongPress) {
          isLongPress = false;
          return;
        }
        const type = btn.dataset.type;
        toggleHandSignSend(type, btn);
      });
    });

    // 留守モードボタン
    const awayBtn = timerElement.querySelector('.rsc-away-btn');
    if (awayBtn) {
      awayBtn.addEventListener('click', () => toggleAwayMode());
    }
  }

  /**
   * 留守モードをトグル
   */
  async function toggleAwayMode() {
    const awayBtn = timerElement.querySelector('.rsc-away-btn');

    if (isAwayMode) {
      // 留守モードを解除
      stopAwayMode();
      showTimerToast('留守モードを解除しました');
    } else {
      // 画像があるかチェック（ポジティブなジェスチャーのみ）
      const images = await getVirtualCameraImages();
      const hasPositiveImages = POSITIVE_GESTURE_TYPES.some(type => images?.[type]?.length > 0);

      if (!hasPositiveImages) {
        showTimerToast('画像が未登録です。事前撮影してください。');
        return;
      }

      // 時間を入力（分単位）
      const inputMinutes = prompt('留守モードの時間を入力（分）', '30');
      if (inputMinutes === null) return; // キャンセル

      const minutes = parseInt(inputMinutes, 10);
      if (isNaN(minutes) || minutes <= 0) {
        showTimerToast('有効な時間を入力してください');
        return;
      }

      awayModeDuration = minutes * 60 * 1000;

      // 留守モードを開始
      startAwayMode();
      showTimerToast(`🏃 留守モード開始（${minutes}分後に自動解除）`);
    }
  }

  /**
   * 留守モードを開始
   */
  function startAwayMode() {
    isAwayMode = true;
    awayModeEndTime = Date.now() + awayModeDuration;

    const awayBtn = timerElement.querySelector('.rsc-away-btn');
    if (awayBtn) {
      awayBtn.classList.add('rsc-active');
      updateAwayButtonText();
    }

    // 他のハンドサインボタンをリセット
    timerElement.querySelectorAll('.rsc-send-btn').forEach(b => b.classList.remove('rsc-active'));
    activeHandSignType = null;

    // 仮想カメラを有効化（ポジティブなジェスチャーからランダム）
    enableVirtualCameraRandom();

    // 指定時間後に自動解除
    awayModeTimeout = setTimeout(() => {
      stopAwayMode();
      showTimerToast('留守モードが終了しました');
    }, awayModeDuration);

    // 残り時間を更新
    updateAwayTimeInterval = setInterval(updateAwayButtonText, 1000);
  }

  let updateAwayTimeInterval = null;

  /**
   * 留守ボタンのテキストを更新
   */
  function updateAwayButtonText() {
    const awayBtn = timerElement.querySelector('.rsc-away-btn');
    if (!awayBtn || !isAwayMode) return;

    const remaining = Math.max(0, awayModeEndTime - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    awayBtn.textContent = `🏃 ${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * 留守モードを停止
   */
  function stopAwayMode() {
    isAwayMode = false;
    awayModeEndTime = null;

    if (awayModeTimeout) {
      clearTimeout(awayModeTimeout);
      awayModeTimeout = null;
    }

    if (updateAwayTimeInterval) {
      clearInterval(updateAwayTimeInterval);
      updateAwayTimeInterval = null;
    }

    const awayBtn = timerElement.querySelector('.rsc-away-btn');
    if (awayBtn) {
      awayBtn.classList.remove('rsc-active');
      awayBtn.textContent = '🏃 留守';
    }

    disableVirtualCamera();
  }

  /**
   * ランダムな画像タイプで仮想カメラを有効化（留守モード用）
   * ネガティブなジェスチャーは除外
   */
  async function enableVirtualCameraRandom() {
    const images = await getVirtualCameraImages();
    const types = [];

    // ポジティブなジェスチャーのみから選択
    for (const type of POSITIVE_GESTURE_TYPES) {
      if (images?.[type]?.length > 0) {
        types.push(type);
      }
    }

    if (types.length === 0) return;

    const randomType = types[Math.floor(Math.random() * types.length)];
    enableVirtualCamera(randomType);
  }

  /**
   * 通知設定ボタンのセットアップ
   */
  function setupNotifyButton() {
    const notifyBtn = timerElement.querySelector('.rsc-notify-btn');
    if (notifyBtn) {
      notifyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // ハンドサイン設定モーダルを開く
        openHandSignSettingsModal();
      });
    }
  }

  /**
   * タイマーUIの録音ボタンをセットアップ
   */
  function setupTimerRecordButtons() {
    const recordBtn = timerElement.querySelector('.rsc-record-btn');

    if (recordBtn) {
      recordBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openToolsModal('recorder');
      });
    }
  }

  // 現在の録音用ストリーム（停止時に解放するため保持）
  let currentRecordingStream = null;

  /**
   * 録音用ストリームを解放
   */
  function releaseRecordingStream() {
    if (currentRecordingStream) {
      // 複数ストリームの場合
      if (currentRecordingStream.streams) {
        currentRecordingStream.streams.forEach(stream => {
          stream.getTracks().forEach(track => track.stop());
        });
      } else {
        // 単一ストリームの場合
        currentRecordingStream.getTracks().forEach(track => track.stop());
      }
      currentRecordingStream = null;
      console.log('[HandSign] Recording stream released');
    }
  }

  /**
   * テスト通知を実行
   */
  async function testNotification() {
    const testGesture = { emoji: '👋', message: '話したそうにしています（テスト）' };
    showToast('テストユーザー', testGesture);
    // テストなので設定に関係なく音を鳴らす
    await playNotificationSoundForTest();
    showTimerToast('通知テストを実行しました');
  }

  /**
   * テスト用に通知音を再生（設定の有効/無効に関係なく再生）
   */
  async function playNotificationSoundForTest() {
    try {
      // background.js に通知音再生を依頼（設定された音を使用、デフォルトは法螺貝）
      const soundPreset = settings.notifications?.soundPreset || 'outgoing:outgoing_horn';
      chrome.runtime.sendMessage({
        type: 'PLAY_HAND_SIGN_SOUND',
        preset: soundPreset
      });
    } catch (error) {
      console.error('[HandSign] Failed to play test sound:', error);
    }
  }

  /**
   * ハンドサイン送信をトグル
   */
  async function toggleHandSignSend(type, btn) {
    // 画像が登録されているかチェック（配列形式）
    const images = await getVirtualCameraImages();
    const imageArray = images?.[type];
    if (!imageArray || !Array.isArray(imageArray) || imageArray.length === 0) {
      showTimerToast('画像が未登録です。設定画面で撮影してください。');
      return;
    }

    if (activeHandSignType === type) {
      // 同じボタンを再度押した場合 → 画像をランダムに切り替え（解除しない）
      enableVirtualCamera(type);
      showTimerToast(`${getGestureEmoji(type)} 画像を切り替えました`);
    } else {
      // 有効化
      // 他のボタンをリセット
      timerElement.querySelectorAll('.rsc-send-btn').forEach(b => b.classList.remove('rsc-active'));
      activeHandSignType = type;
      btn.classList.add('rsc-active');
      enableVirtualCamera(type);
      showTimerToast(`${getGestureEmoji(type)} 次の撮影でランダム送信（${imageArray.length}枚）`);
    }
  }

  /**
   * 仮想カメラ画像をストレージから取得
   * 旧形式のキー名（thumbs_up）から新形式（thumbsup）へのマイグレーションを含む
   */
  async function getVirtualCameraImages() {
    return new Promise(resolve => {
      chrome.storage.local.get(['virtualCameraImages'], async result => {
        const images = result.virtualCameraImages || {};

        // 旧キー名から新キー名へのマイグレーション（thumbs_up → thumbsup）
        let needsSave = false;
        if (images.thumbs_up && !images.thumbsup) {
          images.thumbsup = images.thumbs_up;
          delete images.thumbs_up;
          needsSave = true;
        }

        // マイグレーションが必要な場合は保存
        if (needsSave) {
          await chrome.storage.local.set({ virtualCameraImages: images });
          console.log('[HandSign] Migrated image keys: thumbs_up -> thumbsup');
        }

        resolve(images);
      });
    });
  }

  /**
   * 仮想カメラを有効化（ページに通知）
   */
  function enableVirtualCamera(type) {
    window.postMessage({
      source: 'remowork-virtual-camera',
      type: 'ENABLE_VIRTUAL_CAMERA',
      payload: { imageType: type }
    }, '*');
  }

  /**
   * 仮想カメラを無効化
   */
  function disableVirtualCamera() {
    window.postMessage({
      source: 'remowork-virtual-camera',
      type: 'DISABLE_VIRTUAL_CAMERA',
      payload: {}
    }, '*');
  }

  /**
   * タイマー横にトースト表示
   */
  function showTimerToast(message) {
    const existing = document.querySelector('.rsc-timer-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'rsc-timer-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 70px;
      left: 20px;
      background: rgba(0,0,0,0.8);
      color: white;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      z-index: 100001;
      animation: rsc-toast-fade 2s ease-out forwards;
    `;

    if (!document.getElementById('rsc-toast-styles')) {
      const style = document.createElement('style');
      style.id = 'rsc-toast-styles';
      style.textContent = `
        @keyframes rsc-toast-fade {
          0% { opacity: 0; transform: translateY(10px); }
          15% { opacity: 1; transform: translateY(0); }
          85% { opacity: 1; }
          100% { opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  /**
   * タイマー表示を更新
   */
  function updateTimerDisplay() {
    if (!timerElement) return;

    const valueElement = timerElement.querySelector('.rsc-timer-value');
    if (valueElement) {
      if (remainingSeconds <= 0) {
        // 0秒以下は「撮影待ち」と表示
        valueElement.textContent = '撮影待ち';
      } else {
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        valueElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
    }

    // 残り30秒以下で色を変える
    if (remainingSeconds <= 30) {
      timerElement.classList.add('rsc-timer-soon');
    } else {
      timerElement.classList.remove('rsc-timer-soon');
    }
  }

  /**
   * タイマーをリセット（写真撮影時）
   */
  function resetTimer() {
    remainingSeconds = PHOTO_INTERVAL;
    updateTimerDisplay();

    // フラッシュアニメーション
    if (timerElement) {
      timerElement.classList.remove('rsc-timer-flash');
      void timerElement.offsetWidth; // リフロー強制
      timerElement.classList.add('rsc-timer-flash');
    }

    // 留守モード中は画像をランダムに変更して送信
    if (isAwayMode) {
      console.log('[HandSign] Away mode: selecting random image for next capture');
      enableVirtualCameraRandom();
      return;
    }

    if (isRemoworkAway()) {
      console.log('[HandSign] Remowork is in away status: skipping camera image send');
      return;
    }

    // ハンドサイン送信後は自動で通常カメラに戻す
    if (activeHandSignType) {
      showTimerToast(`${getGestureEmoji(activeHandSignType)} 送信完了！通常カメラに戻りました`);
      activeHandSignType = null;
      timerElement.querySelectorAll('.rsc-send-btn').forEach(b => b.classList.remove('rsc-active'));
      disableVirtualCamera();
    }

    console.log('[HandSign] Timer reset to 5 minutes');
  }

  /**
   * カウントダウン音を再生
   */
  async function playCountdownSound() {
    if (!settings.countdown?.enabled) return;

    const soundPreset = settings.countdown?.soundPreset || 'countdown:countdown_button2';
    const [category, presetId] = soundPreset.split(':');

    // 無音の場合はスキップ
    if (presetId === 'countdown_none') return;

    // presetSoundsがまだロードされていない場合はロード
    if (!presetSounds) {
      try {
        const result = await chrome.runtime.sendMessage({ type: 'GET_PRESET_SOUNDS' });
        if (result && result.success && result.data) {
          presetSounds = result.data;
        }
      } catch (e) {
        console.warn('[HandSign] Failed to load preset sounds:', e);
        return;
      }
    }

    if (!presetSounds) return;

    try {
      const presets = presetSounds[category];
      if (presets) {
        const preset = presets.find(p => p.id === presetId);
        if (preset && preset.file) {
          const soundUrl = chrome.runtime.getURL(`sounds/${category}/${preset.file}`);
          const audio = new Audio(soundUrl);
          audio.volume = 0.6;
          await audio.play();
        }
      }
    } catch (error) {
      console.error('[HandSign] Failed to play countdown sound:', error);
    }
  }

  /**
   * タイマーを1秒減らす
   */
  function tickTimer() {
    remainingSeconds--;
    updateTimerDisplay();

    // 5秒以下でカウントダウン音を再生（Remowork離席中は不要）
    if (remainingSeconds <= 5 && remainingSeconds > 0 && !isRemoworkAway()) {
      playCountdownSound();
    }
  }

  /**
   * 自分の画像URL変更を監視（残り10秒以下の時のみリセット）
   */
  function checkMyImageChange() {
    const currentUrl = getMyImageUrl();
    if (currentUrl && lastMyImageUrl && currentUrl !== lastMyImageUrl) {
      // 留守モード中かつシステム撮影タイミング（残り1秒以下）で画像変更
      // = 次の画像をランダムに選択してリセット
      if (isAwayMode && remainingSeconds <= 1) {
        console.log('[HandSign] Away mode: image changed at capture timing, selecting random image for next capture');
        enableVirtualCameraRandom();
        resetTimer();
      } else if (activeHandSignType && remainingSeconds <= 1) {
        // ハンドサインがアクティブかつシステム撮影タイミング（残り1秒以下）で画像変更
        // = ハンドサイン送信完了とみなして解除
        console.log('[HandSign] Image changed with active hand sign at capture timing, clearing selection');
        showTimerToast(`${getGestureEmoji(activeHandSignType)} 送信完了！通常カメラに戻りました`);
        activeHandSignType = null;
        timerElement.querySelectorAll('.rsc-send-btn').forEach(b => b.classList.remove('rsc-active'));
        disableVirtualCamera();
        resetTimer();
      } else if (remainingSeconds <= 1) {
        // 残り1秒以下の時のみリセット（再撮影などの通常サイクル外はスキップ）
        console.log('[HandSign] My image changed within 1s margin, resetting timer');
        resetTimer();
      }
    }
    lastMyImageUrl = currentUrl;
  }

  /**
   * タイマーを開始
   */
  function startTimer() {
    if (timerInterval) return;

    // 初期画像URLを取得
    lastMyImageUrl = getMyImageUrl();

    // 1秒ごとにカウントダウン
    timerInterval = setInterval(() => {
      tickTimer();
      checkMyImageChange();
    }, 1000);

    console.log('[HandSign] Timer started');
  }

  /**
   * タイマーを停止
   */
  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  /**
   * タイマーの表示/非表示を切り替え
   * 注: settings.enabled はハンドサイン検出のオン/オフなので、
   *     ウィジェット自体は常に表示する
   */
  function updateTimerVisibility() {
    if (!timerElement) return;

    // ウィジェットは常に表示（ハンドサイン検出のオン/オフとは無関係）
    timerElement.classList.remove('rsc-timer-hidden');
  }

  /**
   * オンラインメンバーの画像情報を取得
   * 離席中のメンバーは除外する
   */
  function getOnlineMembers() {
    const members = [];
    const containers = document.querySelectorAll('.user-picture-container:not(.login-user)');

    containers.forEach(container => {
      const nameElement = container.querySelector('.user-name');
      const imageElement = container.querySelector('.v-image__image');

      // 離席中アイコン（mdi-account-remove）があるかチェック
      const awayIcon = container.querySelector('.mdi-account-remove');
      if (awayIcon) {
        // 離席中のメンバーはスキップ
        return;
      }

      if (nameElement && imageElement) {
        const name = nameElement.textContent.trim();
        const style = imageElement.getAttribute('style') || '';
        const match = style.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);

        if (match && match[1]) {
          members.push({
            name: name,
            imageUrl: match[1],
            element: container
          });
        }
      }
    });

    return members;
  }

  /**
   * 全メンバーの画像情報を取得（自分も含む）
   * 感情係数分析用
   */
  function getAllMembersIncludingSelf() {
    const members = [];
    // 自分も含めた全てのユーザーコンテナを取得
    const containers = document.querySelectorAll('.user-picture-container');

    containers.forEach(container => {
      const nameElement = container.querySelector('.user-name');
      const imageElement = container.querySelector('.v-image__image');

      // 離席中アイコン（mdi-account-remove）があるかチェック
      const awayIcon = container.querySelector('.mdi-account-remove');
      if (awayIcon) {
        // 離席中のメンバーはスキップ
        return;
      }

      if (nameElement && imageElement) {
        const name = nameElement.textContent.trim();
        const style = imageElement.getAttribute('style') || '';
        const match = style.match(/background-image:\s*url\(["']?([^"')]+)["']?\)/);

        if (match && match[1]) {
          members.push({
            name: name,
            imageUrl: match[1],
            element: container
          });
        }
      }
    });

    return members;
  }

  /**
   * 画像を読み込んでCanvas化
   * CORSエラー時はcrossOriginなしで再試行
   */
  async function loadImageToCanvas(imageUrl) {
    // まずcrossOriginありで試す
    try {
      return await loadImageWithCrossOrigin(imageUrl, true);
    } catch (e) {
      console.log('[HandSign] CORS load failed, retrying without crossOrigin');
      // CORSなしで再試行
      return await loadImageWithCrossOrigin(imageUrl, false);
    }
  }

  function loadImageWithCrossOrigin(imageUrl, useCrossOrigin) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (useCrossOrigin) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          // getImageDataを試みてCORSエラーをここで検出
          if (useCrossOrigin) {
            ctx.getImageData(0, 0, 1, 1); // テスト
          }
          resolve(canvas);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = (e) => reject(new Error('Image load failed'));
      img.src = imageUrl;
    });
  }

  /**
   * オフスクリーンAPI経由でハンド検出器を初期化
   */
  async function initHandDetector() {
    if (isDetectorReady) return true;

    try {
      console.log('[HandSign] Initializing hand detector via offscreen API...');
      const result = await chrome.runtime.sendMessage({ type: 'INIT_HAND_DETECTOR' });
      if (result && result.success) {
        isDetectorReady = true;
        console.log('[HandSign] Hand detector initialized via offscreen API');
        return true;
      }
      console.warn('[HandSign] Hand detector initialization failed:', result);
      return false;
    } catch (error) {
      console.error('[HandSign] Failed to initialize hand detector:', error);
      return false;
    }
  }

  // MediaPipe互換の初期化関数
  async function initMediaPipe() {
    return initHandDetector();
  }

  /**
   * 画像からハンドサインを検出（オフスクリーンAPI経由）
   */
  async function detectHandSign(member) {
    try {
      const originalCanvas = await loadImageToCanvas(member.imageUrl);

      // 画像を縮小してメッセージサイズを削減（最大256px）
      const maxSize = 256;
      const scale = Math.min(maxSize / originalCanvas.width, maxSize / originalCanvas.height, 1);
      const width = Math.floor(originalCanvas.width * scale);
      const height = Math.floor(originalCanvas.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(originalCanvas, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, width, height);

      // オフスクリーンに画像データを送信
      const result = await chrome.runtime.sendMessage({
        type: 'DETECT_HAND_SIGN',
        imageData: {
          data: Array.from(imageData.data),
          width: imageData.width,
          height: imageData.height
        }
      });

      if (result && result.success && result.gesture) {
        return result.gesture;
      }

      return null;
    } catch (error) {
      console.error('[HandSign] Detection error for', member.name, error);
      return null;
    }
  }

  // =============================================
  // 表情分析機能
  // =============================================

  // 表情分析が有効かどうか（デフォルトON）
  let expressionAnalysisEnabled = true;

  // 選択された感情係数（レーダーチャートで表示するもの）
  let selectedEmotions = ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral'];

  // パラメータ表示時に選択する感情（1つのみ）
  let selectedSingleEmotion = 'happy';

  // 表示形式（'parameter' or 'chart'）
  let expressionDisplayMode = 'chart';

  // 各メンバーの画像URL別の分析結果キャッシュ（画像URLが変わった時のみ再分析）
  const expressionResultCache = new Map();

  // 感情の日本語名（サイコパス風）
  const EMOTION_LABELS = {
    happy: '幸福係数',
    sad: '悲哀係数',
    angry: '憤怒係数',
    fearful: '恐怖係数',
    disgusted: '嫌悪係数',
    surprised: '驚愕係数',
    neutral: '平静係数'
  };

  // 感情の絵文字
  const EMOTION_EMOJI = {
    happy: '😊',
    sad: '😢',
    angry: '😠',
    fearful: '😨',
    disgusted: '😒',
    surprised: '😮',
    neutral: '😐'
  };

  /**
   * 画像の明るさ・コントラストを自動調整（逆光・暗い画像対応）
   * ガンマ補正 + コントラストストレッチングで顔検出しやすくする
   */
  function autoAdjustBrightnessContrast(imageData) {
    const data = imageData.data;
    const len = data.length;

    // 輝度のヒストグラムを計算
    let minLum = 255;
    let maxLum = 0;
    let sumLum = 0;
    let count = 0;

    for (let i = 0; i < len; i += 4) {
      // 輝度計算 (ITU-R BT.601)
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      minLum = Math.min(minLum, lum);
      maxLum = Math.max(maxLum, lum);
      sumLum += lum;
      count++;
    }

    const avgLum = sumLum / count;
    const range = maxLum - minLum;

    // 常に調整を適用（逆光や暗い画像に対応）
    // ガンマ値: 暗いほど低く（明るくする）、明るければ1.0に近づける
    let gamma = 1.0;
    if (avgLum < 60) {
      gamma = 0.4; // 非常に暗い（逆光など）
    } else if (avgLum < 100) {
      gamma = 0.6; // 暗め
    } else if (avgLum < 130) {
      gamma = 0.8; // やや暗め
    }

    // コントラストストレッチングのパラメータ
    const targetMin = 10;
    const targetMax = 245;
    const scale = range > 20 ? (targetMax - targetMin) / range : 2.0;

    // ガンマ補正用ルックアップテーブルを作成
    const gammaLUT = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      gammaLUT[i] = Math.round(255 * Math.pow(i / 255, gamma));
    }

    for (let i = 0; i < len; i += 4) {
      // RGB各チャンネルを調整
      for (let c = 0; c < 3; c++) {
        let val = data[i + c];
        // 1. コントラストストレッチング
        val = (val - minLum) * scale + targetMin;
        val = Math.max(0, Math.min(255, val));
        // 2. ガンマ補正（暗い部分を明るく）
        val = gammaLUT[Math.round(val)];
        data[i + c] = val;
      }
      // アルファは変更しない
    }

    if (gamma < 1.0 || range < 150) {
      console.log(`[HandSign] Image adjusted: avgLum=${avgLum.toFixed(1)}, range=${range.toFixed(1)}, gamma=${gamma}`);
    }
  }

  /**
   * 表情分析を実行（オフスクリーンAPI経由 - ハンドサインと同様）
   */
  async function analyzeExpression(member) {
    try {
      console.log('[HandSign] Analyzing expression for:', member.name, 'URL:', member.imageUrl?.substring(0, 60));

      // 画像をCanvasに読み込み
      const originalCanvas = await loadImageToCanvas(member.imageUrl);

      // 画像サイズ（顔検出精度向上のため大きめに設定）
      const maxSize = 640;
      const scale = Math.min(maxSize / originalCanvas.width, maxSize / originalCanvas.height, 1);
      const width = Math.floor(originalCanvas.width * scale);
      const height = Math.floor(originalCanvas.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(originalCanvas, 0, 0, width, height);

      // 画像の明るさ・コントラストを自動調整（暗い顔の検出精度向上）
      const imageData = ctx.getImageData(0, 0, width, height);
      autoAdjustBrightnessContrast(imageData);
      ctx.putImageData(imageData, 0, 0);
      const adjustedImageData = ctx.getImageData(0, 0, width, height);

      // オフスクリーンに画像データを送信（ハンドサインと同じ方法）
      const result = await chrome.runtime.sendMessage({
        type: 'ANALYZE_EXPRESSION',
        imageData: {
          data: Array.from(adjustedImageData.data),
          width: adjustedImageData.width,
          height: adjustedImageData.height
        }
      });

      console.log('[HandSign] Expression result for', member.name, ':', result);
      return result;
    } catch (error) {
      console.error('[HandSign] Expression analysis error for', member.name, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * メンバー画像の上に感情係数を表示
   */
  function showExpressionOverlay(memberElement, expressions, dominant, memberName) {
    // 既存のオーバーレイを削除
    const existing = memberElement.querySelector('.rsc-expression-overlay');
    if (existing) existing.remove();

    // オーバーレイを作成
    const overlay = document.createElement('div');
    overlay.className = `rsc-expression-overlay ${expressionDisplayMode === 'chart' ? 'chart-mode' : 'parameter-mode'}`;

    // メンバー名と感情データをデータ属性に保存（モーダル用）
    overlay.dataset.memberName = memberName || '';
    overlay.dataset.expressions = expressions ? JSON.stringify(expressions) : '';
    overlay.dataset.dominant = dominant || '';

    let contentHtml = '';

    if (!expressions) {
      // 顔が検出されなかった場合
      contentHtml = `<div class="rsc-expression-notfound">
        <span class="rsc-expression-notfound-text">Not Found</span>
      </div>`;
    } else if (expressionDisplayMode === 'chart') {
      // チャート形式（7角形レーダーチャート）
      contentHtml = createRadarChart(expressions, dominant);
    } else {
      // パラメータ形式（選択された1つの感情のみ表示）- 「Happy: 97」形式
      const emotion = selectedSingleEmotion;
      const score = expressions[emotion] || 0;
      // 英語ラベル（先頭大文字）
      const label = emotion.charAt(0).toUpperCase() + emotion.slice(1);
      contentHtml = `<div class="rsc-expression-single">
        <span class="rsc-expression-text">${label}: ${Math.round(score)}</span>
      </div>`;
    }

    overlay.innerHTML = contentHtml;

    // 画像コンテナを見つける（複数の方法を試す）
    let imgContainer = memberElement.querySelector('.v-image__image')?.parentElement;
    if (!imgContainer) {
      imgContainer = memberElement.querySelector('.v-avatar');
    }
    if (!imgContainer) {
      imgContainer = memberElement.querySelector('.v-image');
    }
    if (!imgContainer) {
      // 最終手段：memberElement自体を使用
      imgContainer = memberElement;
    }

    imgContainer.style.position = 'relative';
    imgContainer.appendChild(overlay);

    // クリックでモーダル表示
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = overlay.dataset.memberName;
      const expData = overlay.dataset.expressions;
      const dom = overlay.dataset.dominant;
      if (expData) {
        showExpressionModal(name, JSON.parse(expData), dom);
      }
    });
  }

  /**
   * 感情詳細モーダルを表示
   */
  function showExpressionModal(memberName, expressions, dominant) {
    // 既存のモーダルを削除
    const existingModal = document.getElementById('rsc-expression-modal');
    if (existingModal) existingModal.remove();

    // 感情の絵文字
    const emotionEmojis = {
      happy: '😊',
      sad: '😢',
      angry: '😠',
      fearful: '😨',
      disgusted: '🤢',
      surprised: '😲',
      neutral: '😐'
    };

    // 感情リストを生成
    const emotions = ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral'];
    const listItems = emotions.map(emotion => {
      const score = expressions[emotion] || 0;
      const label = emotion.charAt(0).toUpperCase() + emotion.slice(1);
      const isDominant = emotion === dominant;
      return `
        <div class="rsc-expression-modal-item ${isDominant ? 'dominant' : ''}">
          <span class="rsc-expression-modal-item-emoji">${emotionEmojis[emotion]}</span>
          <span class="rsc-expression-modal-item-label">${label}</span>
          <span class="rsc-expression-modal-item-score">${Math.round(score)}</span>
        </div>
      `;
    }).join('');

    // モーダルを作成
    const modal = document.createElement('div');
    modal.id = 'rsc-expression-modal';
    modal.className = 'rsc-expression-modal rsc-active';
    modal.innerHTML = `
      <div class="rsc-expression-modal-overlay"></div>
      <div class="rsc-expression-modal-content">
        <button class="rsc-expression-modal-close">&times;</button>
        <div class="rsc-expression-modal-name">${memberName || 'Unknown'}</div>
        <div class="rsc-expression-modal-chart">
          ${createRadarChart(expressions, dominant, true)}
        </div>
        <div class="rsc-expression-modal-list">
          ${listItems}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 閉じるイベント
    modal.querySelector('.rsc-expression-modal-overlay').addEventListener('click', () => {
      modal.remove();
    });
    modal.querySelector('.rsc-expression-modal-close').addEventListener('click', () => {
      modal.remove();
    });
  }

  // 感情別の色定義（fillを濃くして塗りつぶし感を強調）
  const EMOTION_COLORS = {
    happy: { main: '#ff69b4', fill: 'rgba(255, 105, 180, 0.6)', glow: 'rgba(255, 105, 180, 0.5)' }, // ピンク
    sad: { main: '#4169e1', fill: 'rgba(65, 105, 225, 0.6)', glow: 'rgba(65, 105, 225, 0.5)' }, // ブルー
    angry: { main: '#ff4444', fill: 'rgba(255, 68, 68, 0.6)', glow: 'rgba(255, 68, 68, 0.5)' }, // レッド
    fearful: { main: '#9932cc', fill: 'rgba(153, 50, 204, 0.6)', glow: 'rgba(153, 50, 204, 0.5)' }, // パープル
    disgusted: { main: '#32cd32', fill: 'rgba(50, 205, 50, 0.6)', glow: 'rgba(50, 205, 50, 0.5)' }, // グリーン
    surprised: { main: '#ffa500', fill: 'rgba(255, 165, 0, 0.6)', glow: 'rgba(255, 165, 0, 0.5)' }, // オレンジ
    neutral: { main: '#00ff88', fill: 'rgba(0, 255, 136, 0.6)', glow: 'rgba(0, 255, 136, 0.5)' } // シアン（デフォルト）
  };

  /**
   * 6角形レーダーチャートをSVGで作成（neutral除外、数値ラベル付き、感情別カラー）
   * @param {Object} expressions - 感情スコア
   * @param {string} dominant - ドミナント感情
   * @param {boolean} isLarge - 大きいサイズ（モーダル用）
   */
  function createRadarChart(expressions, dominant, isLarge = false) {
    const size = isLarge ? 200 : 50; // 通常50px、モーダルは200px
    const center = size / 2;
    // 小さいチャートはラベルなしなので、大きめ(0.45)。大きいチャートはラベル用スペース確保(0.35)
    const radius = isLarge ? size * 0.35 : size * 0.45; // データ領域
    const labelRadius = size * 0.45; // ラベル位置

    // ドミナント感情に応じた色を取得
    const colors = EMOTION_COLORS[dominant] || EMOTION_COLORS.neutral;

    // 6つの感情の順序（neutral除外、12時の位置から時計回り）
    const emotions = ['happy', 'surprised', 'fearful', 'sad', 'disgusted', 'angry'];
    const emotionLabels = {
      happy: 'Happy',
      surprised: 'Surprised',
      fearful: 'Fearful',
      sad: 'Sad',
      disgusted: 'Disgusted',
      angry: 'Angry'
    };

    const points = [];
    const dataPoints = [];
    const labels = [];

    // neutral以外の感情の最大値を取得（最小1で0除算を防ぐ）
    const scores = emotions.map(e => (expressions && expressions[e]) || 0);
    const maxScore = Math.max(1, ...scores);

    emotions.forEach((emotion, i) => {
      const angle = (Math.PI * 2 * i / 6) - Math.PI / 2; // 12時から開始（6角形）
      const score = (expressions && expressions[emotion]) || 0;
      const dataRadius = radius * (score / maxScore); // 最大値を基準にスケール

      // 外枠の頂点
      points.push({
        x: center + radius * Math.cos(angle),
        y: center + radius * Math.sin(angle)
      });

      // データ点
      dataPoints.push({
        x: center + dataRadius * Math.cos(angle),
        y: center + dataRadius * Math.sin(angle)
      });

      // ラベル位置
      labels.push({
        x: center + labelRadius * Math.cos(angle),
        y: center + labelRadius * Math.sin(angle),
        label: emotionLabels[emotion],
        score: score
      });
    });

    // 外枠の多角形
    const outerPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ') + ' Z';

    // データの多角形
    const dataPath = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ') + ' Z';

    // ラベルSVG要素（大きいサイズのみ表示）
    const labelElements = isLarge ? labels.map((l, i) => {
      // テキストアンカーを位置に応じて調整
      let textAnchor = 'middle';
      let dx = 0;
      if (l.x < center - 5) {
        textAnchor = 'end';
        dx = -4;
      } else if (l.x > center + 5) {
        textAnchor = 'start';
        dx = 4;
      }

      // 上下位置の調整（英語ラベルと数値を2行で表示）
      const dy = l.y < center ? -6 : 6;

      return `
        <text x="${l.x + dx}" y="${l.y + dy}" text-anchor="${textAnchor}" dominant-baseline="middle"
              font-size="12" fill="${colors.main}" font-weight="bold" style="text-shadow: 0 0 2px #000, 0 0 4px #000;">
          ${l.label}
        </text>
        <text x="${l.x + dx}" y="${l.y + dy + 14}" text-anchor="${textAnchor}" dominant-baseline="middle"
              font-size="14" fill="#fff" font-weight="bold" style="text-shadow: 0 0 2px #000, 0 0 4px #000;">
          ${Math.round(l.score)}
        </text>
      `;
    }).join('') : '';

    const circleRadius = isLarge ? 4 : 1.5;
    const strokeWidth = isLarge ? 2 : 1;

    return `
      <svg class="rsc-radar-chart" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="filter: drop-shadow(0 0 4px ${colors.glow});">
        <path d="${outerPath}" fill="none" stroke="rgba(255, 255, 255, 0.4)" stroke-width="${strokeWidth * 0.5}"/>
        <path d="${dataPath}" fill="${colors.fill}" stroke="${colors.main}" stroke-width="${strokeWidth}"/>
        ${dataPoints.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="${circleRadius}" fill="${colors.main}"/>`).join('')}
        ${labelElements}
      </svg>
    `;
  }

  /**
   * 全メンバーの表情を分析
   */
  async function analyzeAllExpressions() {
    if (!expressionAnalysisEnabled) return;

    // 自分も含めた全メンバーを取得
    const members = getAllMembersIncludingSelf();

    // 画像URLが変わったメンバーのみ抽出（同じURLは1回のみ分析）
    const membersToAnalyze = [];
    const membersWithCache = [];

    // 同じURLを持つメンバーをグループ化
    const membersByUrl = new Map();
    for (const member of members) {
      if (!membersByUrl.has(member.imageUrl)) {
        membersByUrl.set(member.imageUrl, []);
      }
      membersByUrl.get(member.imageUrl).push(member);
    }

    // 各URLに対して処理（同じURLは最初の1人のみ表示）
    for (const [url, urlMembers] of membersByUrl.entries()) {
      if (expressionResultCache.has(url)) {
        // キャッシュがあるので再分析不要、最初の1人のみ表示対象
        const cachedResult = expressionResultCache.get(url);
        membersWithCache.push({ member: urlMembers[0], result: cachedResult });
        // 2人目以降はオーバーレイを削除
        for (let i = 1; i < urlMembers.length; i++) {
          const existing = urlMembers[i].element?.querySelector('.rsc-expression-overlay');
          if (existing) existing.remove();
        }
      } else {
        // 新しいURL、最初の1人だけ分析対象に（2人目以降は表示しない）
        membersToAnalyze.push(urlMembers[0]);
        // 2人目以降はオーバーレイを削除
        for (let i = 1; i < urlMembers.length; i++) {
          const existing = urlMembers[i].element?.querySelector('.rsc-expression-overlay');
          if (existing) existing.remove();
        }
      }
    }

    // 分析が必要なメンバーのみ処理
    for (const member of membersToAnalyze) {
      const result = await analyzeExpression(member);
      if (result && result.success) {
        // グローバルキャッシュに保存
        expressionResultCache.set(member.imageUrl, result);

        // ログに分析結果を表示
        if (result.expressions) {
          console.log(`[HandSign] ${member.name}:`, result.expressions, `(dominant: ${result.dominant})`);
        } else {
          console.log(`[HandSign] ${member.name}: Not Found (顔が検出されませんでした)`);
        }

        // メンバーのコンテナ要素に表示（expressionsがnullでも「Not Found」を表示）
        if (member.element) {
          showExpressionOverlay(member.element, result.expressions, result.dominant, member.name);
        }
      }
    }

    // キャッシュ済みメンバー（各URLの最初の1人のみ）にオーバーレイを表示
    for (const { member, result } of membersWithCache) {
      if (member.element && result && result.success) {
        const existing = member.element.querySelector('.rsc-expression-overlay');
        if (!existing) {
          showExpressionOverlay(member.element, result.expressions, result.dominant, member.name);
        }
      }
    }

    // チーム全体のムードを更新
    updateTeamMood();
  }

  /**
   * チーム全体のムードを計算・表示
   * 現在表示されているメンバーのみを集計（同じ画像URLは1回のみカウント）
   */
  function updateTeamMood() {
    if (!timerElement) return;

    const moodEmoji = timerElement.querySelector('.rsc-team-mood-emoji');
    const moodText = timerElement.querySelector('.rsc-team-mood-text');
    if (!moodEmoji || !moodText) return;

    // 現在表示されているメンバーの画像URLを取得
    const members = getAllMembersIncludingSelf();
    const currentUrls = new Set(members.map(m => m.imageUrl).filter(Boolean));

    // 現在のメンバーのみから感情スコアを集計（同じURLは1回のみ）
    const totals = {
      happy: 0,
      sad: 0,
      angry: 0,
      fearful: 0,
      disgusted: 0,
      surprised: 0,
      neutral: 0
    };
    let count = 0;
    const processedUrls = new Set();

    for (const url of currentUrls) {
      // 同じURLは1回のみカウント
      if (processedUrls.has(url)) continue;
      processedUrls.add(url);

      const result = expressionResultCache.get(url);
      if (result && result.success && result.expressions) {
        for (const emotion of Object.keys(totals)) {
          totals[emotion] += result.expressions[emotion] || 0;
        }
        count++;
      }
    }

    if (count === 0) {
      moodEmoji.textContent = '❓';
      moodText.textContent = 'No Data';
      moodText.style.color = '#888';
      return;
    }

    // 最も高い感情を取得
    let dominantEmotion = 'neutral';
    let maxScore = 0;
    for (const [emotion, score] of Object.entries(totals)) {
      if (score > maxScore) {
        maxScore = score;
        dominantEmotion = emotion;
      }
    }

    // 感情に対応する絵文字とテキスト
    const emotionDisplay = {
      happy: { emoji: '😊', text: 'Happy', color: '#ff69b4' },
      sad: { emoji: '😢', text: 'Sad', color: '#4169e1' },
      angry: { emoji: '😠', text: 'Angry', color: '#ff4444' },
      fearful: { emoji: '😨', text: 'Fearful', color: '#9932cc' },
      disgusted: { emoji: '🤢', text: 'Disgusted', color: '#32cd32' },
      surprised: { emoji: '😲', text: 'Surprised', color: '#ffa500' },
      neutral: { emoji: '😐', text: 'Neutral', color: '#00ff88' }
    };

    const display = emotionDisplay[dominantEmotion];
    moodEmoji.textContent = display.emoji;
    moodText.textContent = `${display.text} (${count})`;
    moodText.style.color = display.color;
  }

  /**
   * トースト通知を表示
   */
  function showToast(name, gesture) {
    const toast = document.createElement('div');
    toast.className = 'rsc-hand-sign-toast';
    toast.innerHTML = `
      <div class="rsc-hand-sign-toast-content">
        <span class="rsc-hand-sign-emoji">${gesture.emoji}</span>
        <span class="rsc-hand-sign-text"><strong>${name}</strong>さんが${gesture.message}</span>
      </div>
    `;

    // スタイルを追加
    toast.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      z-index: 100001;
      font-size: 16px;
      box-shadow: 0 8px 32px rgba(102, 126, 234, 0.4);
      animation: rsc-hand-sign-slide-in 0.5s ease-out;
      display: flex;
      align-items: center;
      gap: 12px;
    `;

    document.body.appendChild(toast);

    // アニメーション用のスタイルを追加
    if (!document.getElementById('rsc-hand-sign-styles')) {
      const style = document.createElement('style');
      style.id = 'rsc-hand-sign-styles';
      style.textContent = `
        @keyframes rsc-hand-sign-slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes rsc-hand-sign-slide-out {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(100%);
            opacity: 0;
          }
        }
        .rsc-hand-sign-toast-content {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .rsc-hand-sign-emoji {
          font-size: 32px;
        }
      `;
      document.head.appendChild(style);
    }

    // 5秒後に消える
    setTimeout(() => {
      toast.style.animation = 'rsc-hand-sign-slide-out 0.5s ease-in forwards';
      setTimeout(() => toast.remove(), 500);
    }, 5000);
  }

  /**
   * 通知音を再生
   */
  async function playNotificationSound() {
    if (!settings.notifications.sound) return;

    try {
      // background.js に通知音再生を依頼
      chrome.runtime.sendMessage({
        type: 'PLAY_HAND_SIGN_SOUND',
        preset: settings.notifications.soundPreset
      });
    } catch (error) {
      console.error('[HandSign] Failed to play sound:', error);
    }
  }

  /**
   * 通知を表示
   */
  function notify(member, gesture) {
    // クールダウンチェック
    const lastNotification = notificationCooldowns.get(member.name);
    if (lastNotification && Date.now() - lastNotification < NOTIFICATION_COOLDOWN) {
      return;
    }

    console.log('[HandSign] Detected:', member.name, gesture);

    // トースト表示
    if (settings.notifications.toast) {
      showToast(member.name, gesture);
    }

    // 通知音再生
    if (settings.notifications.sound) {
      playNotificationSound();
    }

    // クールダウン記録
    notificationCooldowns.set(member.name, Date.now());
  }

  /**
   * メンバーの画像をスキャン
   */
  async function scanMembers() {
    if (!settings.enabled) return;

    // 自分が離席中の場合は検出をスキップ（離席中の画像で誤検出を防ぐ）
    if (isRemoworkAway()) {
      return;
    }

    const members = getOnlineMembers();

    for (const member of members) {
      // 自分は除外
      if (member.name === settings.myName) continue;

      // 検出対象でない場合は除外
      if (!settings.detectAll && !settings.targetMembers.includes(member.name)) continue;

      // 既に処理済みの画像は除外
      if (processedImages.get(member.name) === member.imageUrl) continue;

      // 画像を記録
      processedImages.set(member.name, member.imageUrl);

      // ハンドサイン検出
      const gesture = await detectHandSign(member);
      if (gesture) {
        notify(member, gesture);
      }
    }

    // 感情係数分析（全メンバー対象）
    if (expressionAnalysisEnabled) {
      analyzeAllExpressions();
    }
  }

  /**
   * ログイン画面かどうかを判定
   */
  function isLoginPage() {
    const path = window.location.pathname;

    // Remoworkのログインページ: /client/login
    if (path === '/client/login' || path.endsWith('/login')) {
      return true;
    }

    // ログインユーザー情報がなければログイン画面とみなす
    const userElement = document.querySelector('.user-picture-container.login-user');
    if (!userElement) {
      return true;
    }

    return false;
  }

  /**
   * 初期化
   */
  async function init() {
    // ログイン画面では初期化しない
    if (isLoginPage()) {
      console.log('[HandSign] Login page detected, skipping initialization');
      return;
    }

    console.log('[HandSign] Initializing...');

    // 設定を読み込む
    await loadSettings();

    // 感情係数設定を読み込む
    await loadExpressionSettings();

    // プリセット音声をプリロード（カウントダウン音などで使用）
    try {
      const result = await chrome.runtime.sendMessage({ type: 'GET_PRESET_SOUNDS' });
      if (result && result.success && result.data) {
        presetSounds = result.data;
        console.log('[HandSign] Preset sounds preloaded');
      }
    } catch (e) {
      console.warn('[HandSign] Failed to preload preset sounds:', e);
    }

    // レート制限カウンターをストレージから復元
    await loadRateLimitFromStorage();

    // 自分の名前を検出
    detectMyName();

    // タイマーUIを作成
    createTimerUI();
    updateTimerDisplay();
    updateTimerVisibility();

    // タイマーを開始
    startTimer();

    // MediaPipe を初期化（バックグラウンドで）
    initMediaPipe().catch(console.error);

    // 感情係数分析を開始（オフスクリーン経由）
    if (expressionAnalysisEnabled) {
      console.log('[HandSign] Expression analysis enabled, starting...');
      // ボタンの状態を更新
      const btn = timerElement?.querySelector('.rsc-expression-btn');
      if (btn) btn.classList.add('rsc-active');
      // 初回分析を開始
      setTimeout(() => analyzeAllExpressions(), 2000);
    }

    // 定期スキャン開始
    setInterval(scanMembers, DETECTION_INTERVAL);

    // 初回スキャン
    setTimeout(scanMembers, 3000);

    console.log('[HandSign] Initialized');
  }

  // 設定変更を監視
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.handSignSettings) {
      settings = { ...settings, ...changes.handSignSettings.newValue };
      console.log('[HandSign] Settings updated:', settings);
      updateTimerVisibility();
    }
    // LLM設定の変更を監視（APIキー変更時にリロード不要に）
    if (namespace === 'local' && changes.llmSettings) {
      llmSettings = changes.llmSettings.newValue;
      console.log('[HandSign] LLM settings updated:', llmSettings?.enabled ? 'enabled' : 'disabled');
    }
  });

  // 統合モーダル関連
  let toolsModal = null;
  let cameraStream = null;
  let currentTab = 'camera'; // 'camera' or 'recorder'

  // 録音関連
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartTime = null;
  let recorderTimerInterval = null;
  let recordings = [];
  let audioContext = null;
  let audioDestination = null;
  let currentPlayingAudio = null;
  let currentPlayingId = null;
  // Note: recordingsDb, RECORDINGS_DB_NAME, RECORDINGS_STORE_NAME は
  // recorder/recordings-db.js に移動しました

  // 文字起こし関連（ページコンテキスト inject.js 経由）
  let transcriptText = '';
  let isTranscribing = false;

  // Whisper文字起こし関連（相手の声）
  let whisperSettings = { enabled: false, apiKey: '', language: 'ja' };
  let whisperTranscriptText = '';
  let whisperMediaRecorder = null;
  let whisperInterval = null;
  let tabAudioStream = null;

  // 自動構造化関連
  let structureInterval = null;
  let lastStructuredText = '';

  // レート制限管理（Gemini無料枠: 15 RPM / 250 RPD）
  const RATE_LIMIT = {
    gemini: {
      rpm: 14,           // 15 RPM - 1マージン
      rpd: 240,          // 250 RPD - 10マージン
      minInterval: 4500  // 60秒/14 ≈ 4.3秒 → 4.5秒
    },
    openai: {
      rpm: 60,
      rpd: 10000,
      minInterval: 1000
    },
    claude: {
      rpm: 60,
      rpd: 10000,
      minInterval: 1000
    },
    custom: {
      rpm: 60,
      rpd: 10000,
      minInterval: 1000
    }
  };
  let lastRequestTime = 0;
  let requestCountToday = 0;
  let requestCountMinute = 0;
  let lastMinuteReset = Date.now();
  let nextRequestCountdown = null;
  let rateLimitDate = ''; // YYYY-MM-DD形式で日付追跡

  /**
   * 今日の日付を取得（YYYY-MM-DD形式）
   */
  function getTodayDateString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  /**
   * レート制限カウンターをストレージから読み込み
   */
  async function loadRateLimitFromStorage() {
    try {
      const result = await chrome.storage.local.get('rateLimitData');
      const today = getTodayDateString();

      if (result.rateLimitData && result.rateLimitData.date === today) {
        // 今日のデータがある場合は復元
        requestCountToday = result.rateLimitData.count || 0;
        rateLimitDate = today;
        console.log('[HandSignDetector] Rate limit restored:', requestCountToday);
      } else {
        // 日付が変わった or データがない場合はリセット
        requestCountToday = 0;
        rateLimitDate = today;
        await saveRateLimitToStorage();
        console.log('[HandSignDetector] Rate limit reset for new day');
      }
    } catch (error) {
      console.error('[HandSignDetector] Failed to load rate limit:', error);
    }
  }

  /**
   * レート制限カウンターをストレージに保存
   */
  async function saveRateLimitToStorage() {
    try {
      await chrome.storage.local.set({
        rateLimitData: {
          date: rateLimitDate,
          count: requestCountToday
        }
      });
    } catch (error) {
      console.error('[HandSignDetector] Failed to save rate limit:', error);
    }
  }

  /**
   * 統合モーダルを作成（撮影 + 録音）
   */
  function createToolsModal() {
    if (toolsModal) return toolsModal;

    toolsModal = document.createElement('div');
    toolsModal.id = 'rsc-tools-modal';
    toolsModal.innerHTML = `
      <div class="rsc-modal-overlay"></div>
      <div class="rsc-modal-dialog">
        <div class="rsc-modal-header">
          <div class="rsc-modal-title"></div>
          <button class="rsc-modal-close">×</button>
        </div>

        <!-- カメラタブ -->
        <div class="rsc-tab-content rsc-tab-camera active">
          <div class="rsc-camera-body">
            <video id="rsc-camera-video" autoplay playsinline></video>
            <canvas id="rsc-camera-canvas" style="display:none;"></canvas>
          </div>
          <div class="rsc-camera-actions">
            <button class="rsc-camera-btn rsc-capture-wave">👋 手を振って</button>
            <button class="rsc-camera-btn rsc-capture-thumbsup">👍 サムズアップで</button>
            <button class="rsc-camera-btn rsc-capture-peace">✌️ ピースして</button>
            <button class="rsc-camera-btn rsc-capture-head_in_hands">😢 頭を抱えて</button>
          </div>
          <div class="rsc-camera-status"></div>
          <div class="rsc-image-counts">
            <span class="rsc-count-wave">👋 0枚</span>
            <span class="rsc-count-thumbsup">👍 0枚</span>
            <span class="rsc-count-peace">✌️ 0枚</span>
            <span class="rsc-count-head_in_hands">😢 0枚</span>
          </div>
          <div class="rsc-saved-images">
            <div class="rsc-saved-images-section" data-type="wave">
              <div class="rsc-saved-images-header">
                <span class="rsc-saved-images-title">👋 手を振って</span>
                <button class="rsc-delete-all-btn" data-type="wave">全削除</button>
              </div>
              <div class="rsc-saved-images-grid rsc-wave-grid"></div>
            </div>
            <div class="rsc-saved-images-section" data-type="thumbsup">
              <div class="rsc-saved-images-header">
                <span class="rsc-saved-images-title">👍 サムズアップで</span>
                <button class="rsc-delete-all-btn" data-type="thumbsup">全削除</button>
              </div>
              <div class="rsc-saved-images-grid rsc-thumbsup-grid"></div>
            </div>
            <div class="rsc-saved-images-section" data-type="peace">
              <div class="rsc-saved-images-header">
                <span class="rsc-saved-images-title">✌️ ピースして</span>
                <button class="rsc-delete-all-btn" data-type="peace">全削除</button>
              </div>
              <div class="rsc-saved-images-grid rsc-peace-grid"></div>
            </div>
            <div class="rsc-saved-images-section" data-type="head_in_hands">
              <div class="rsc-saved-images-header">
                <span class="rsc-saved-images-title">😢 頭を抱えて</span>
                <button class="rsc-delete-all-btn" data-type="head_in_hands">全削除</button>
              </div>
              <div class="rsc-saved-images-grid rsc-head_in_hands-grid"></div>
            </div>
          </div>
        </div>

        <!-- 録音タブ -->
        <div class="rsc-tab-content rsc-tab-recorder">
          <!-- 上部：タイマーと履歴を横並び -->
          <div class="rsc-recorder-top">
            <div class="rsc-recorder-timer-section">
              <div class="rsc-recorder-status">
                <span class="rsc-recorder-indicator idle"></span>
                <span class="rsc-recorder-status-text">待機中</span>
              </div>
              <div class="rsc-recorder-time">00:00:00</div>
              <div class="rsc-recorder-controls">
                <button class="rsc-recorder-btn rsc-recorder-btn-record" title="録音開始">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                    <circle cx="12" cy="12" r="8"/>
                  </svg>
                </button>
                <button class="rsc-recorder-btn rsc-recorder-btn-pause" title="一時停止" disabled>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                  </svg>
                </button>
                <button class="rsc-recorder-btn rsc-recorder-btn-stop" title="停止" disabled>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                    <rect x="6" y="6" width="12" height="12"/>
                  </svg>
                </button>
              </div>
              <div class="rsc-recorder-info">
                タブの音声を録音するには「タブの音声を共有」にチェックを入れてください
              </div>
            </div>
            <div class="rsc-recorder-history-section">
              <div class="rsc-recorder-history-title">📁 履歴</div>
              <div class="rsc-recorder-recordings"></div>
            </div>
          </div>

          <!-- メモ・文字起こしエリア -->
          <div class="rsc-meeting-notes">
            <div class="rsc-notes-section">
              <div class="rsc-notes-header">
                <span class="rsc-notes-title">✏️ メモ</span>
                <button class="rsc-copy-btn" data-target="manual-notes" title="コピー">📋</button>
              </div>
              <textarea class="rsc-manual-notes" placeholder="メモを入力..."></textarea>
            </div>
            <div class="rsc-notes-section">
              <div class="rsc-notes-header">
                <span class="rsc-notes-title">🤖 自動構造化メモ</span>
                <div class="rsc-structure-controls">
                  <span class="rsc-rate-limit-status"></span>
                  <button class="rsc-structure-btn" title="今すぐ構造化">🔄</button>
                  <button class="rsc-copy-btn" data-target="structured-notes" title="コピー">📋</button>
                </div>
              </div>
              <div class="rsc-structured-notes-area">（AIタブで設定後、録音中に自動構造化されます）</div>
            </div>
            <div class="rsc-notes-section">
              <div class="rsc-notes-header">
                <span class="rsc-notes-title">📝 文字起こし</span>
                <div class="rsc-transcript-controls">
                  <label class="rsc-notes-toggle">
                    <input type="checkbox" class="rsc-transcript-toggle" checked>
                    <span>自動文字起こし</span>
                  </label>
                  <button class="rsc-copy-btn" data-target="transcript" title="コピー">📋</button>
                </div>
              </div>
              <div class="rsc-whisper-status-box">
                <span class="rsc-whisper-label">🎧 相手の声（Whisper）:</span>
                <span class="rsc-whisper-config-status">確認中...</span>
              </div>
              <div class="rsc-transcription-notice">
                <div class="rsc-notice-header">
                  <span class="rsc-notice-icon">⚠️</span>
                  <span class="rsc-notice-title">文字起こしの制限について</span>
                  <button class="rsc-notice-toggle" title="詳細を表示/非表示">▼</button>
                </div>
                <div class="rsc-notice-content">
                  <p><strong>現在の仕様:</strong> 文字起こしは<em>自分の声のみ</em>が対象です。相手の声は自動では取り込めません。</p>
                  <p><strong>相手の声も文字起こしするには:</strong></p>
                  <div class="rsc-notice-os">
                    <div class="rsc-notice-os-section">
                      <span class="rsc-os-label">🪟 Windows</span>
                      <ol>
                        <li>「サウンド設定」→「録音」タブを開く</li>
                        <li>「ステレオミキサー」を右クリック→有効化</li>
                        <li>ステレオミキサーを「既定のデバイス」に設定</li>
                      </ol>
                    </div>
                    <div class="rsc-notice-os-section">
                      <span class="rsc-os-label">🍎 macOS</span>
                      <ol>
                        <li><a href="https://existential.audio/blackhole/" target="_blank" rel="noopener">BlackHole</a>をインストール</li>
                        <li>「Audio MIDI設定」で複数出力装置を作成</li>
                        <li>システム出力先を仮想デバイスに変更</li>
                      </ol>
                    </div>
                  </div>
                  <p class="rsc-notice-footnote">※ これはブラウザのセキュリティ仕様による制限です</p>
                </div>
              </div>
              <div class="rsc-transcript-area" contenteditable="false"></div>
            </div>
            <div class="rsc-notes-section rsc-whisper-section" style="display: none;">
              <div class="rsc-notes-header">
                <span class="rsc-notes-title">🎧 相手の発言（Whisper）</span>
                <div class="rsc-whisper-controls">
                  <span class="rsc-whisper-status">停止中</span>
                  <button class="rsc-copy-btn" data-target="whisper" title="コピー">📋</button>
                </div>
              </div>
              <div class="rsc-whisper-info">
                💡 録音開始時に「タブの音声を共有」を選択すると、相手の声も文字起こしされます
              </div>
              <div class="rsc-whisper-area" contenteditable="false">（Whisper有効時に表示）</div>
            </div>
            <div class="rsc-notes-actions">
              <button class="rsc-copy-all-btn" title="全てコピー">📋 全てコピー</button>
            </div>
          </div>
        </div>

        <div class="rsc-modal-resize-handle"></div>
      </div>
    `;

    // スタイルを追加
    const style = document.createElement('style');
    style.id = 'rsc-tools-modal-styles';
    style.textContent = `
      #rsc-tools-modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #rsc-tools-modal.rsc-active {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding-top: 10px;
      }
      .rsc-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
      }
      .rsc-modal-dialog {
        position: relative;
        background: #1a1a2e;
        border-radius: 12px;
        padding: 0;
        max-width: 600px;
        width: 90%;
        overflow: hidden;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        resize: vertical;
        min-height: 200px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
      }
      .rsc-modal-resize-handle {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 12px;
        background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.1));
        cursor: ns-resize;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .rsc-modal-resize-handle::after {
        content: '';
        width: 40px;
        height: 4px;
        background: rgba(255,255,255,0.3);
        border-radius: 2px;
      }
      .rsc-modal-resize-handle:hover::after {
        background: rgba(255,255,255,0.5);
      }
      .rsc-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
      }
      .rsc-modal-title {
        color: #fff;
        font-size: 16px;
        font-weight: 500;
      }
      .rsc-modal-close {
        background: none;
        border: none;
        color: #888;
        font-size: 28px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        transition: all 0.2s;
      }
      .rsc-modal-close:hover {
        color: #fff;
        background: rgba(255,255,255,0.1);
      }
      .rsc-tab-content {
        display: none;
        padding: 16px;
        padding-bottom: 24px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
      }
      .rsc-tab-content.active {
        display: flex;
        flex-direction: column;
      }

      /* カメラタブ */
      .rsc-camera-body {
        background: #000;
        border-radius: 12px;
        overflow: hidden;
        margin-bottom: 12px;
        min-height: 240px;
        height: 240px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #rsc-camera-video {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
        transform: scaleX(-1);
      }
      .rsc-camera-actions {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
        justify-content: center;
      }
      .rsc-camera-btn {
        padding: 10px 8px;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
        text-shadow:
          1px 1px 2px rgba(0, 0, 0, 0.5),
          -1px -1px 2px rgba(0, 0, 0, 0.3),
          0 0 4px rgba(0, 0, 0, 0.4);
      }
      .rsc-capture-wave {
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff;
      }
      .rsc-capture-thumbsup {
        background: linear-gradient(135deg, #f093fb, #f5576c);
        color: #fff;
      }
      .rsc-capture-peace {
        background: linear-gradient(135deg, #43e97b, #38f9d7);
        color: #fff;
      }
      .rsc-capture-head_in_hands {
        background: linear-gradient(135deg, #fa709a, #fee140);
        color: #fff;
      }
      .rsc-camera-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
      }
      .rsc-camera-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
      .rsc-camera-status {
        text-align: center;
        color: #888;
        font-size: 13px;
        margin-top: 8px;
        min-height: 18px;
      }
      .rsc-camera-status.rsc-success {
        color: #4ade80;
      }
      .rsc-camera-status.rsc-error {
        color: #f87171;
      }
      .rsc-image-counts {
        display: flex;
        justify-content: center;
        gap: 16px;
        margin-top: 8px;
        color: #a0aec0;
        font-size: 12px;
      }

      /* 保存済み画像一覧 */
      .rsc-saved-images {
        margin-top: 16px;
      }
      .rsc-saved-images-section {
        margin-bottom: 8px;
      }
      .rsc-saved-images-section:last-child {
        margin-bottom: 0;
      }
      .rsc-saved-images-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }
      .rsc-saved-images-title {
        color: #a0aec0;
        font-size: 11px;
      }
      .rsc-delete-all-btn {
        padding: 2px 6px;
        border: none;
        border-radius: 4px;
        background: rgba(239, 68, 68, 0.2);
        color: #f87171;
        font-size: 10px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .rsc-delete-all-btn:hover {
        background: rgba(239, 68, 68, 0.4);
      }
      .rsc-delete-all-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .rsc-saved-images-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 8px;
      }
      .rsc-saved-image-item {
        position: relative;
        aspect-ratio: 1;
        border-radius: 8px;
        overflow: hidden;
        background: #000;
      }
      .rsc-saved-image-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .rsc-saved-image-delete {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 20px;
        height: 20px;
        border: none;
        border-radius: 50%;
        background: rgba(239, 68, 68, 0.9);
        color: #fff;
        font-size: 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s;
      }
      .rsc-saved-image-item:hover .rsc-saved-image-delete {
        opacity: 1;
      }
      .rsc-saved-image-delete:hover {
        background: #dc2626;
      }
      .rsc-saved-images-empty {
        color: #718096;
        font-size: 12px;
        text-align: center;
        padding: 8px;
      }

      /* 録音タブ */
      .rsc-recorder-top {
        display: flex;
        gap: 16px;
        margin-bottom: 16px;
      }
      .rsc-recorder-timer-section {
        flex: 1;
        min-width: 0;
      }
      .rsc-recorder-history-section {
        width: 240px;
        flex-shrink: 0;
        background: rgba(255,255,255,0.03);
        border-radius: 8px;
        padding: 8px;
        max-height: 160px;
        overflow-y: auto;
      }
      .rsc-recorder-history-title {
        color: #a0aec0;
        font-size: 12px;
        margin-bottom: 8px;
        font-weight: 500;
      }
      .rsc-recorder-history-section .rsc-recorder-recordings {
        margin-top: 0;
      }
      .rsc-recorder-history-section .rsc-recording-item {
        padding: 6px 8px;
        margin-bottom: 4px;
        font-size: 11px;
      }
      .rsc-recorder-history-section .rsc-recording-info {
        gap: 4px;
      }
      .rsc-recorder-history-section .rsc-recording-name {
        font-size: 11px;
      }
      .rsc-recorder-history-section .rsc-recording-meta {
        font-size: 10px;
      }
      .rsc-recorder-history-section .rsc-recording-actions {
        gap: 2px;
      }
      .rsc-recorder-history-section .rsc-recording-actions button {
        padding: 2px 4px;
        font-size: 12px;
      }
      .rsc-recorder-status {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-bottom: 8px;
      }
      .rsc-recorder-indicator {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #4a5568;
      }
      .rsc-recorder-indicator.recording {
        background: #ef4444;
        animation: rsc-pulse 1s infinite;
      }
      .rsc-recorder-indicator.paused {
        background: #f59e0b;
      }
      @keyframes rsc-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .rsc-recorder-status-text {
        color: #a0aec0;
        font-size: 14px;
      }
      .rsc-recorder-time {
        text-align: center;
        font-size: 32px;
        font-weight: 300;
        color: #fff;
        font-variant-numeric: tabular-nums;
        margin-bottom: 12px;
      }
      .rsc-recorder-controls {
        display: flex;
        justify-content: center;
        gap: 12px;
        margin-bottom: 12px;
      }
      .rsc-recorder-btn {
        width: 44px;
        height: 44px;
        border: none;
        border-radius: 50%;
        background: rgba(255,255,255,0.1);
        color: #fff;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .rsc-recorder-btn:hover:not(:disabled) {
        background: rgba(255,255,255,0.2);
        transform: scale(1.05);
      }
      .rsc-recorder-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .rsc-recorder-btn-record {
        background: #ef4444;
      }
      .rsc-recorder-btn-record:hover:not(:disabled) {
        background: #dc2626;
      }
      .rsc-recorder-info {
        text-align: center;
        color: #718096;
        font-size: 12px;
        margin-bottom: 16px;
        padding: 12px;
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
      }
      /* 文字起こし・メモエリア */
      .rsc-meeting-notes {
        margin-bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .rsc-notes-section {
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
        padding: 12px;
      }
      .rsc-notes-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .rsc-notes-title {
        color: #a0aec0;
        font-size: 13px;
        font-weight: 500;
      }
      .rsc-notes-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: #718096;
        cursor: pointer;
      }
      .rsc-notes-toggle input {
        width: 14px;
        height: 14px;
        accent-color: #48bb78;
      }
      .rsc-transcript-area {
        background: rgba(0,0,0,0.2);
        border-radius: 6px;
        padding: 10px;
        min-height: 80px;
        max-height: 120px;
        overflow-y: auto;
        font-size: 13px;
        color: #e2e8f0;
        line-height: 1.5;
      }
      .rsc-transcript-area:empty::before {
        content: '録音を開始すると文字起こしが表示されます...';
        color: #4a5568;
      }
      .rsc-manual-notes {
        width: 100%;
        background: rgba(0,0,0,0.2);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        padding: 10px;
        min-height: 60px;
        font-size: 13px;
        color: #e2e8f0;
        resize: vertical;
        font-family: inherit;
      }
      .rsc-manual-notes:focus {
        outline: none;
        border-color: rgba(72, 187, 120, 0.5);
      }
      .rsc-manual-notes::placeholder {
        color: #4a5568;
      }
      .rsc-dev-badge {
        background: rgba(237, 137, 54, 0.2);
        color: #ed8936;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 8px;
      }
      .rsc-structure-btn {
        background: rgba(72, 187, 120, 0.2);
        border: none;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
        color: #48bb78;
        margin-left: auto;
      }
      .rsc-structure-btn:hover {
        background: rgba(72, 187, 120, 0.3);
      }
      .rsc-structure-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .rsc-structure-btn.loading {
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .rsc-structured-notes-area {
        background: rgba(0,0,0,0.2);
        border-radius: 6px;
        padding: 10px;
        min-height: 60px;
        font-size: 13px;
        color: #e2e8f0;
        line-height: 1.6;
        white-space: pre-wrap;
        font-family: monospace;
      }
      .rsc-structured-notes-area.placeholder {
        color: #718096;
        min-height: 40px;
      }
      .rsc-structure-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .rsc-rate-limit-status {
        font-size: 11px;
        color: #a0aec0;
      }
      .rsc-rate-limit-status.waiting {
        color: #f6ad55;
      }
      .rsc-rate-limit-status.ready {
        color: #68d391;
      }
      .rsc-rate-limit-status .countdown {
        font-weight: bold;
        font-family: monospace;
      }
      .rsc-rate-limit-status .request-count {
        color: #718096;
        font-size: 10px;
      }
      .rsc-copy-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        font-size: 14px;
        padding: 4px 6px;
        border-radius: 4px;
        opacity: 0.7;
        transition: all 0.2s;
      }
      .rsc-copy-btn:hover {
        opacity: 1;
        background: rgba(255,255,255,0.1);
      }
      .rsc-copy-btn.copied {
        color: #68d391;
      }
      .rsc-transcript-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .rsc-whisper-status-box {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 0;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        margin-bottom: 8px;
      }
      .rsc-whisper-label {
        font-size: 12px;
        color: #a0aec0;
        white-space: nowrap;
      }
      .rsc-whisper-config-status {
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .rsc-whisper-config-status.enabled {
        color: #48bb78;
        background: rgba(72, 187, 120, 0.1);
      }
      .rsc-whisper-config-status.disabled {
        color: #f6ad55;
        background: rgba(246, 173, 85, 0.1);
      }
      .rsc-transcription-notice {
        background: rgba(255, 193, 7, 0.1);
        border: 1px solid rgba(255, 193, 7, 0.3);
        border-radius: 8px;
        margin-bottom: 10px;
        overflow: hidden;
      }
      .rsc-notice-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        cursor: pointer;
        user-select: none;
      }
      .rsc-notice-header:hover {
        background: rgba(255, 193, 7, 0.15);
      }
      .rsc-notice-icon {
        font-size: 14px;
      }
      .rsc-notice-title {
        flex: 1;
        font-size: 12px;
        font-weight: 600;
        color: #ffc107;
      }
      .rsc-notice-toggle {
        background: none;
        border: none;
        color: #a0aec0;
        font-size: 10px;
        cursor: pointer;
        padding: 2px 6px;
        transition: transform 0.2s;
      }
      .rsc-notice-toggle.collapsed {
        transform: rotate(-90deg);
      }
      .rsc-notice-content {
        padding: 0 12px 12px;
        font-size: 11px;
        color: #cbd5e0;
        line-height: 1.5;
      }
      .rsc-notice-content.collapsed {
        display: none;
      }
      .rsc-notice-content p {
        margin: 0 0 8px;
      }
      .rsc-notice-content strong {
        color: #e2e8f0;
      }
      .rsc-notice-content em {
        color: #fc8181;
        font-style: normal;
        font-weight: 600;
      }
      .rsc-notice-os {
        display: flex;
        gap: 12px;
        margin: 8px 0;
      }
      .rsc-notice-os-section {
        flex: 1;
        background: rgba(0,0,0,0.2);
        border-radius: 6px;
        padding: 8px;
      }
      .rsc-os-label {
        display: block;
        font-weight: 600;
        color: #a0aec0;
        margin-bottom: 6px;
        font-size: 11px;
      }
      .rsc-notice-os-section ol {
        margin: 0;
        padding-left: 16px;
        font-size: 10px;
        color: #a0aec0;
      }
      .rsc-notice-os-section li {
        margin-bottom: 3px;
      }
      .rsc-notice-os-section a {
        color: #63b3ed;
        text-decoration: none;
      }
      .rsc-notice-os-section a:hover {
        text-decoration: underline;
      }
      .rsc-notice-footnote {
        font-size: 10px;
        color: #718096;
        margin-top: 8px !important;
        margin-bottom: 0 !important;
      }
      .rsc-whisper-section {
        border-top: 1px solid rgba(255,255,255,0.1);
        padding-top: 10px;
        margin-top: 10px;
      }
      .rsc-whisper-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .rsc-whisper-status {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        background: rgba(113, 128, 150, 0.3);
        color: #a0aec0;
      }
      .rsc-whisper-status.active {
        background: rgba(72, 187, 120, 0.3);
        color: #68d391;
      }
      .rsc-whisper-info {
        font-size: 11px;
        color: #718096;
        padding: 6px 0;
        line-height: 1.4;
      }
      .rsc-whisper-area {
        flex: 1;
        background: rgba(0,0,0,0.3);
        border-radius: 8px;
        padding: 10px;
        font-size: 12px;
        color: #e2e8f0;
        min-height: 80px;
        max-height: 150px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-word;
        border: 1px solid rgba(99, 102, 241, 0.3);
      }
      .rsc-whisper-area:empty::before {
        content: '（相手の音声を待機中...）';
        color: #4a5568;
      }
      .rsc-notes-actions {
        display: flex;
        justify-content: flex-end;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,0.1);
        margin-top: 10px;
      }
      .rsc-copy-all-btn {
        background: rgba(99, 102, 241, 0.2);
        border: 1px solid rgba(99, 102, 241, 0.4);
        color: #a5b4fc;
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }
      .rsc-copy-all-btn:hover {
        background: rgba(99, 102, 241, 0.3);
      }
      .rsc-copy-all-btn.copied {
        background: rgba(72, 187, 120, 0.2);
        border-color: rgba(72, 187, 120, 0.4);
        color: #68d391;
      }
      .rsc-recorder-recordings {
        max-height: 200px;
        overflow-y: auto;
      }
      .rsc-recorder-recordings-title {
        color: #a0aec0;
        font-size: 13px;
        margin-bottom: 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      .rsc-recording-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
        margin-bottom: 8px;
      }
      .rsc-recording-info {
        flex: 1;
        min-width: 0;
      }
      .rsc-recording-name {
        color: #fff;
        font-size: 13px;
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rsc-recording-meta {
        color: #718096;
        font-size: 11px;
      }
      .rsc-recording-actions {
        display: flex;
        gap: 6px;
      }
      .rsc-recording-btn {
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 6px;
        background: rgba(255,255,255,0.1);
        color: #a0aec0;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }
      .rsc-recording-btn:hover {
        background: rgba(255,255,255,0.2);
        color: #fff;
      }
      .rsc-recording-btn.playing {
        background: #ef4444;
        color: #fff;
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(toolsModal);

    // イベント設定
    toolsModal.querySelector('.rsc-modal-overlay').addEventListener('click', closeToolsModal);
    toolsModal.querySelector('.rsc-modal-close').addEventListener('click', closeToolsModal);
    toolsModal.querySelector('.rsc-capture-wave').addEventListener('click', () => captureImage('wave'));
    toolsModal.querySelector('.rsc-capture-thumbsup').addEventListener('click', () => captureImage('thumbsup'));
    toolsModal.querySelector('.rsc-capture-peace').addEventListener('click', () => captureImage('peace'));
    toolsModal.querySelector('.rsc-capture-head_in_hands').addEventListener('click', () => captureImage('head_in_hands'));

    // 録音ボタン
    toolsModal.querySelector('.rsc-recorder-btn-record').addEventListener('click', startRecording);
    toolsModal.querySelector('.rsc-recorder-btn-pause').addEventListener('click', togglePauseRecording);
    toolsModal.querySelector('.rsc-recorder-btn-stop').addEventListener('click', stopRecording);

    // 全削除ボタン
    toolsModal.querySelectorAll('.rsc-delete-all-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteAllImages(btn.dataset.type));
    });

    // 構造化ボタン
    const structureBtn = toolsModal.querySelector('.rsc-structure-btn');
    if (structureBtn) {
      structureBtn.addEventListener('click', async () => {
        if (!llmSettings) {
          try {
            const response = await chrome.runtime.sendMessage({ type: 'GET_LLM_SETTINGS' });
            if (response?.success && response.data) {
              llmSettings = response.data;
            }
          } catch (error) {
            console.warn('[HandSign] Failed to get LLM settings:', error);
          }
        }

        if (!llmSettings?.enabled || !llmSettings?.apiKey) {
          const structuredArea = toolsModal.querySelector('.rsc-structured-notes-area');
          if (structuredArea) {
            structuredArea.textContent = '⚠️ 拡張機能のポップアップ → AIタブでAPIキーを設定してください';
          }
          return;
        }

        await structureCurrentTranscript();
      });
    }

    // コピーボタン（個別）
    toolsModal.querySelectorAll('.rsc-copy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const target = btn.dataset.target;
        let text = '';

        if (target === 'manual-notes') {
          text = toolsModal.querySelector('.rsc-manual-notes')?.value || '';
        } else if (target === 'structured-notes') {
          text = toolsModal.querySelector('.rsc-structured-notes-area')?.textContent || '';
        } else if (target === 'transcript') {
          text = toolsModal.querySelector('.rsc-transcript-area')?.textContent || '';
        } else if (target === 'whisper') {
          text = toolsModal.querySelector('.rsc-whisper-area')?.textContent || '';
        }

        if (text && !text.startsWith('（')) {
          await copyToClipboard(text, btn);
        }
      });
    });

    // 全てコピーボタン
    const copyAllBtn = toolsModal.querySelector('.rsc-copy-all-btn');
    if (copyAllBtn) {
      copyAllBtn.addEventListener('click', async () => {
        const allText = getMeetingNotesText();
        if (allText.trim()) {
          await copyToClipboard(allText, copyAllBtn);
        }
      });
    }

    return toolsModal;
  }

  /**
   * クリップボードにコピー
   */
  async function copyToClipboard(text, btn) {
    try {
      await navigator.clipboard.writeText(text);

      // ボタンのフィードバック
      const originalText = btn.textContent;
      btn.textContent = '✅';
      btn.classList.add('copied');

      setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('copied');
      }, 1500);

      console.log('[HandSign] Copied to clipboard');
    } catch (error) {
      console.error('[HandSign] Failed to copy:', error);
    }
  }

  /**
   * タブを切り替え
   */
  function switchTab(tabName) {
    if (!toolsModal) return;
    currentTab = tabName;

    // タイトルを更新
    const titleEl = toolsModal.querySelector('.rsc-modal-title');
    if (titleEl) {
      titleEl.textContent = tabName === 'camera' ? '📷 事前撮影' : '🎙️ 録音';
    }

    // コンテンツの表示切り替え
    toolsModal.querySelector('.rsc-tab-camera').classList.toggle('active', tabName === 'camera');
    toolsModal.querySelector('.rsc-tab-recorder').classList.toggle('active', tabName === 'recorder');

    // カメラタブに切り替えたらカメラ起動
    if (tabName === 'camera' && !cameraStream) {
      startCamera();
    }
  }

  /**
   * カメラを起動
   */
  async function startCamera() {
    const video = document.getElementById('rsc-camera-video');
    const status = toolsModal.querySelector('.rsc-camera-status');
    const buttons = toolsModal.querySelectorAll('.rsc-camera-btn');

    buttons.forEach(btn => btn.disabled = true);
    status.textContent = 'カメラを起動中...';
    status.className = 'rsc-camera-status';

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      video.srcObject = cameraStream;
      buttons.forEach(btn => btn.disabled = false);
      status.textContent = 'ポーズをとって撮影ボタンをクリック！';
      updateImageCounts();
    } catch (error) {
      console.error('[HandSign] Camera error:', error);
      let message = 'カメラへのアクセスに失敗しました';
      if (error.name === 'NotAllowedError') {
        message = 'カメラへのアクセスが拒否されました';
      } else if (error.name === 'NotFoundError') {
        message = 'カメラが見つかりません';
      } else if (error.name === 'NotReadableError') {
        message = 'カメラが他のアプリで使用中です';
      }
      status.textContent = message;
      status.className = 'rsc-camera-status rsc-error';
    }
  }

  /**
   * 画像枚数を更新
   */
  async function updateImageCounts() {
    if (!toolsModal) return;
    if (!isExtensionContextValid()) {
      console.warn('[HandSign] Extension context invalidated');
      return;
    }
    const result = await chrome.storage.local.get('virtualCameraImages');
    const images = result.virtualCameraImages || {};

    // 全てのジェスチャータイプの枚数を更新
    for (const type of GESTURE_TYPES) {
      const countEl = toolsModal.querySelector(`.rsc-count-${type}`);
      if (countEl) {
        countEl.textContent = `${getGestureEmoji(type)} ${images[type]?.length || 0}枚`;
      }
      // 保存済み画像一覧を更新
      updateSavedImagesGrid(type, images[type] || []);
    }
  }

  /**
   * 保存済み画像のグリッドを更新
   */
  function updateSavedImagesGrid(type, imageList) {
    if (!toolsModal) return;
    const grid = toolsModal.querySelector(`.rsc-${type}-grid`);
    if (!grid) return;

    if (imageList.length === 0) {
      grid.innerHTML = '<div class="rsc-saved-images-empty">画像なし</div>';
      return;
    }

    grid.innerHTML = imageList.map((img, index) => `
      <div class="rsc-saved-image-item" data-type="${type}" data-index="${index}">
        <img src="${img}" alt="${type} ${index + 1}">
        <button class="rsc-saved-image-delete" title="削除">×</button>
      </div>
    `).join('');

    // 削除ボタンのイベント設定
    grid.querySelectorAll('.rsc-saved-image-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = btn.closest('.rsc-saved-image-item');
        const imgType = item.dataset.type;
        const imgIndex = parseInt(item.dataset.index);
        await deleteImage(imgType, imgIndex);
      });
    });
  }

  /**
   * 画像を削除
   */
  async function deleteImage(type, index) {
    if (!isExtensionContextValid()) {
      alert('拡張機能が更新されました。ページをリロードしてください。');
      return;
    }
    const result = await chrome.storage.local.get('virtualCameraImages');
    const images = result.virtualCameraImages || {};

    if (!images[type] || index >= images[type].length) return;

    // 削除確認
    if (!confirm(`この画像を削除しますか？`)) return;

    // 画像を削除
    images[type].splice(index, 1);
    await chrome.storage.local.set({ virtualCameraImages: images });

    // virtual-camera.jsにリアルタイムで通知
    window.postMessage({
      source: 'remowork-virtual-camera',
      type: 'LOAD_IMAGES',
      payload: { images: images }
    }, '*');

    // UIを更新
    updateImageCounts();

    const status = toolsModal.querySelector('.rsc-camera-status');
    if (status) {
      status.textContent = '画像を削除しました';
      status.className = 'rsc-camera-status';
    }
  }

  /**
   * 画像を全削除
   */
  async function deleteAllImages(type) {
    if (!isExtensionContextValid()) {
      alert('拡張機能が更新されました。ページをリロードしてください。');
      return;
    }
    const result = await chrome.storage.local.get('virtualCameraImages');
    const images = result.virtualCameraImages || {};

    const count = images[type]?.length || 0;
    if (count === 0) return;

    if (!confirm(`${getGestureEmoji(type)} の画像を全て削除しますか？（${count}枚）`)) return;

    // 全削除
    images[type] = [];
    await chrome.storage.local.set({ virtualCameraImages: images });

    // virtual-camera.jsにリアルタイムで通知
    window.postMessage({
      source: 'remowork-virtual-camera',
      type: 'LOAD_IMAGES',
      payload: { images: images }
    }, '*');

    // UIを更新
    updateImageCounts();

    const status = toolsModal.querySelector('.rsc-camera-status');
    if (status) {
      status.textContent = `${getGestureEmoji(type)} の画像を全て削除しました`;
      status.className = 'rsc-camera-status';
    }
  }

  /**
   * 統合モーダルを開く
   */
  async function openToolsModal(initialTab = 'camera') {
    createToolsModal();
    toolsModal.classList.add('rsc-active');
    currentTab = initialTab;
    switchTab(initialTab);

    if (initialTab === 'camera') {
      startCamera();
    }

    // 録音タブを開く場合
    if (initialTab === 'recorder') {
      // 既に録音中ならUIを更新
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        updateRecorderUI(mediaRecorder.state === 'paused' ? 'paused' : 'recording');
        startRecorderTimer();
        showRecorderInfo('録音中（マイク）');
      }
      // 録音履歴を読み込み（古い録音の自動削除も実行）
      await loadRecordings();

      // Whisper設定状態を表示
      await updateWhisperConfigStatus();
      setupNoticeListeners();
    }

    // 保存された高さを復元
    restoreModalHeight();

    // リサイズハンドルを設定
    setupModalResize();
  }

  /**
   * モーダルの高さを復元
   */
  function restoreModalHeight() {
    if (!isExtensionContextValid()) {
      // デフォルト高さを設定
      const dialog = toolsModal?.querySelector('.rsc-modal-dialog');
      if (dialog) {
        dialog.style.height = '50vh';
      }
      return;
    }
    chrome.storage.local.get(['modalHeight'], (result) => {
      if (result.modalHeight) {
        const dialog = toolsModal?.querySelector('.rsc-modal-dialog');
        if (dialog) {
          dialog.style.height = result.modalHeight + 'px';
        }
      } else {
        // デフォルト高さ
        const dialog = toolsModal?.querySelector('.rsc-modal-dialog');
        if (dialog) {
          dialog.style.height = '50vh';
        }
      }
    });
  }

  /**
   * モーダルのリサイズ機能をセットアップ
   */
  function setupModalResize() {
    const dialog = toolsModal?.querySelector('.rsc-modal-dialog');
    const resizeHandle = toolsModal?.querySelector('.rsc-modal-resize-handle');

    if (!dialog || !resizeHandle) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    const onMouseDown = (e) => {
      isResizing = true;
      startY = e.clientY || e.touches?.[0]?.clientY;
      startHeight = dialog.offsetHeight;
      e.preventDefault();

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('touchmove', onMouseMove);
      document.addEventListener('touchend', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!isResizing) return;

      const clientY = e.clientY || e.touches?.[0]?.clientY;
      const deltaY = clientY - startY;
      const newHeight = Math.max(200, Math.min(window.innerHeight * 0.9, startHeight + deltaY));

      dialog.style.height = newHeight + 'px';
    };

    const onMouseUp = () => {
      if (!isResizing) return;

      isResizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onMouseMove);
      document.removeEventListener('touchend', onMouseUp);

      // 高さを保存
      const currentHeight = dialog.offsetHeight;
      chrome.storage.local.set({ modalHeight: currentHeight });
    };

    resizeHandle.addEventListener('mousedown', onMouseDown);
    resizeHandle.addEventListener('touchstart', onMouseDown);
  }

  /**
   * 統合モーダルを閉じる
   */
  function closeToolsModal() {
    // カメラストリームを停止
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }

    // 録音中なら停止
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      stopRecording();
    }

    if (toolsModal) {
      toolsModal.classList.remove('rsc-active');
      const video = document.getElementById('rsc-camera-video');
      if (video) video.srcObject = null;
    }
  }

  /**
   * 3秒カウントダウンを表示
   */
  function showCountdown(seconds) {
    return new Promise((resolve) => {
      const video = document.getElementById('rsc-camera-video');
      if (!video) {
        resolve();
        return;
      }

      // カウントダウンオーバーレイを作成
      let overlay = document.getElementById('rsc-countdown-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'rsc-countdown-overlay';
        overlay.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.5);
          z-index: 10;
        `;
        video.parentElement.style.position = 'relative';
        video.parentElement.appendChild(overlay);
      }

      let count = seconds;
      const updateCount = () => {
        overlay.innerHTML = `<span style="font-size: 72px; color: #fff; font-weight: bold; text-shadow: 0 2px 8px rgba(0,0,0,0.5);">${count}</span>`;
        if (count > 0) {
          count--;
          setTimeout(updateCount, 1000);
        } else {
          overlay.remove();
          resolve();
        }
      };
      updateCount();
    });
  }

  /**
   * 画像を撮影して保存
   */
  async function captureImage(type) {
    const video = document.getElementById('rsc-camera-video');
    const canvas = document.getElementById('rsc-camera-canvas');
    const status = toolsModal.querySelector('.rsc-camera-status');
    const buttons = toolsModal.querySelectorAll('.rsc-camera-btn');

    if (!video || !video.srcObject) {
      status.textContent = 'カメラが起動していません';
      status.className = 'rsc-camera-status rsc-error';
      return;
    }

    // ボタンを無効化
    buttons.forEach(btn => btn.disabled = true);
    status.textContent = '撮影準備中...';
    status.className = 'rsc-camera-status';

    // 3秒カウントダウン
    await showCountdown(3);

    // キャンバスに描画（左右反転）
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);

    // ボタンを再度有効化
    buttons.forEach(btn => btn.disabled = false);

    // Base64に変換
    const imageData = canvas.toDataURL('image/jpeg', 0.8);

    // ストレージに保存
    try {
      if (!isExtensionContextValid()) {
        status.textContent = '拡張機能が更新されました。ページをリロードしてください';
        status.className = 'rsc-camera-status rsc-error';
        return;
      }

      const result = await chrome.storage.local.get('virtualCameraImages');
      const images = result.virtualCameraImages || {};

      // 全ジェスチャータイプの配列を初期化
      for (const gestureType of GESTURE_TYPES) {
        if (!images[gestureType]) {
          images[gestureType] = [];
        }
      }

      if (images[type].length >= 12) {
        status.textContent = '登録上限（12枚）に達しています';
        status.className = 'rsc-camera-status rsc-error';
        return;
      }

      images[type].push(imageData);
      await chrome.storage.local.set({ virtualCameraImages: images });

      status.textContent = `${getGestureEmoji(type)} 保存しました（${images[type].length}/12枚）`;
      status.className = 'rsc-camera-status rsc-success';

      // 枚数を更新
      updateImageCounts();

      // virtual-camera.jsにリアルタイムで画像を送信
      window.postMessage({
        source: 'remowork-virtual-camera',
        type: 'LOAD_IMAGES',
        payload: { images: images }
      }, '*');
      console.log('[HandSign] Sent LOAD_IMAGES to virtual-camera.js');

      // 成功をポップアップに通知
      if (isExtensionContextValid()) {
        chrome.runtime.sendMessage({
          type: 'CAMERA_CAPTURE_SUCCESS',
          imageType: type,
          count: images[type].length
        }).catch(() => {});
      }

    } catch (error) {
      console.error('[HandSign] Failed to save image:', error);
      if (error.message.includes('Extension context invalidated')) {
        status.textContent = '拡張機能が更新されました。ページをリロードしてください';
      } else {
        status.textContent = '保存に失敗しました';
      }
      status.className = 'rsc-camera-status rsc-error';
    }
  }

  // ===== 録音機能 =====

  /**
   * 録音を開始
   */
  async function startRecording() {
    try {
      const stream = await captureAudioStream();

      if (!stream) {
        showRecorderError('音声ストリームを取得できませんでした');
        return;
      }

      audioChunks = [];
      recordingStartTime = Date.now();

      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        saveRecordingData(blob);
      };

      mediaRecorder.start(1000);

      updateRecorderUI('recording');
      startRecorderTimer();

      // メモエリアを表示してクリア
      showMeetingNotesArea(true);
      clearMeetingNotes();

      // 文字起こしを開始
      startTranscription();

      // 自動構造化を開始
      startAutoStructure();

      // Whisper文字起こしを開始（タブ音声がある場合）
      if (tabAudioStream) {
        await loadWhisperSettings();
        startWhisperTranscription(tabAudioStream);
      }

      console.log('[HandSign] Recording started');

    } catch (error) {
      console.error('[HandSign] Failed to start recording:', error);
      showRecorderError('録音を開始できませんでした');
    }
  }

  /**
   * 音声ストリームをキャプチャ
   */
  async function captureAudioStream() {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioDestination = audioContext.createMediaStreamDestination();

      let hasMic = false;
      let hasTabAudio = false;

      // ストリームを保持するリスト
      const streamsToRelease = [];

      // マイク（デフォルトを使用）
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamsToRelease.push(micStream);
        const micSource = audioContext.createMediaStreamSource(micStream);
        micSource.connect(audioDestination);
        hasMic = true;
      } catch (e) {
        console.warn('[HandSign] Microphone not available:', e);
      }

      // 画面共有でタブ音声
      try {
        showRecorderInfo('画面共有ダイアログで「タブの音声を共有」にチェックを入れてください');

        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            suppressLocalAudioPlayback: false
          },
          video: { width: 1, height: 1, frameRate: 1 },
          preferCurrentTab: true,
          selfBrowserSurface: 'include',
          systemAudio: 'include'
        });

        streamsToRelease.push(displayStream);

        const audioTracks = displayStream.getAudioTracks();

        if (audioTracks.length > 0) {
          const audioOnlyStream = new MediaStream(audioTracks);
          const tabSource = audioContext.createMediaStreamSource(audioOnlyStream);
          tabSource.connect(audioDestination);
          hasTabAudio = true;

          // Whisper用にタブ音声ストリームを保持
          tabAudioStream = audioOnlyStream;

          displayStream.getVideoTracks().forEach(track => track.stop());
        } else {
          showRecorderError('タブの音声が共有されていません');
        }
      } catch (e) {
        console.warn('[HandSign] Tab audio capture failed:', e);
      }

      // ストリームを保持（停止時に解放するため）
      currentRecordingStream = { streams: streamsToRelease };

      if (!hasMic && !hasTabAudio) {
        throw new Error('音声ソースが見つかりません');
      }

      const sources = [];
      if (hasMic) sources.push('マイク');
      if (hasTabAudio) sources.push('タブ音声');
      showRecorderInfo(`録音開始: ${sources.join(' + ')}`);

      return audioDestination.stream;

    } catch (error) {
      console.error('[HandSign] Failed to capture audio:', error);
      return null;
    }
  }

  /**
   * 録音の一時停止/再開をトグル
   */
  function togglePauseRecording() {
    if (!mediaRecorder) return;

    if (mediaRecorder.state === 'recording') {
      mediaRecorder.pause();
      stopRecorderTimer();
      updateRecorderUI('paused');
    } else if (mediaRecorder.state === 'paused') {
      mediaRecorder.resume();
      startRecorderTimer();
      updateRecorderUI('recording');
    }
  }

  /**
   * 録音を停止
   */
  function stopRecording() {
    if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
      mediaRecorder.stop();
      stopRecorderTimer();
      stopTranscription();
      stopAutoStructure();
      stopWhisperTranscription();
      releaseRecordingStream();
      updateRecorderUI('idle');
    }
  }

  /**
   * 文字起こしを開始（inject.js ページコンテキスト経由）
   * 注意: BraveブラウザではWeb Speech APIが利用不可（Chromeでは動作）
   */
  function startTranscription() {
    if (isTranscribing) return;

    updateTranscriptDisplay('文字起こしを開始しています...');
    transcriptText = '';

    // inject.js にイベントを送信（デフォルトマイクを使用）
    window.dispatchEvent(new CustomEvent('remowork-transcription-start', {
      detail: {}
    }));
    console.log('[HandSign] Transcription start requested with default mic');
  }

  /**
   * 文字起こしを停止（inject.js ページコンテキスト経由）
   */
  function stopTranscription() {
    if (!isTranscribing) return;

    // inject.js にイベントを送信
    window.dispatchEvent(new CustomEvent('remowork-transcription-stop'));
    isTranscribing = false;
    console.log('[HandSign] Transcription stop requested');
  }

  // inject.js からの文字起こしイベントをリッスン
  window.addEventListener('remowork-transcription-started', () => {
    isTranscribing = true;
    updateTranscriptDisplay('（音声を待機中...）');
    console.log('[HandSign] Transcription started');
  });

  window.addEventListener('remowork-transcription-result', (event) => {
    const { transcript, interim } = event.detail;
    transcriptText = transcript || '';
    const displayText = interim ? transcriptText + interim : transcriptText;
    updateTranscriptDisplay(displayText || '（音声を待機中...）');
  });

  window.addEventListener('remowork-transcription-error', (event) => {
    const { error, message, transcript } = event.detail;
    isTranscribing = false;

    if (error === 'network') {
      // 文字起こし内容がある場合は保持してエラーメッセージを追加
      if (transcript) {
        transcriptText = transcript;
        updateTranscriptDisplay(
          transcript +
          '\n\n⚠️ ネットワークエラー\n' +
          'Braveブラウザでは利用できません。\n' +
          'Google Chromeをお使いください。'
        );
      } else {
        updateTranscriptDisplay(
          '⚠️ ネットワークエラー\n\n' +
          'Braveブラウザでは利用できません。\n' +
          'Google Chromeをお使いください。'
        );
      }
    } else if (error === 'not-allowed') {
      updateTranscriptDisplay('⚠️ マイクへのアクセスが拒否されました');
    } else {
      updateTranscriptDisplay(`⚠️ エラー: ${message || error}`);
    }
  });

  window.addEventListener('remowork-transcription-stopped', (event) => {
    if (event.detail?.transcript) {
      transcriptText = event.detail.transcript;
    }
    console.log('[HandSign] Transcription stopped');
  });

  /**
   * 文字起こし表示を更新
   */
  function updateTranscriptDisplay(text) {
    const transcriptArea = toolsModal?.querySelector('.rsc-transcript-area');
    if (transcriptArea) {
      transcriptArea.textContent = text;
      transcriptArea.scrollTop = transcriptArea.scrollHeight;
    }
  }

  /**
   * Whisper設定状態を表示
   */
  async function updateWhisperConfigStatus() {
    const statusEl = toolsModal?.querySelector('.rsc-whisper-config-status');
    if (!statusEl) return;

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_WHISPER_SETTINGS' });
      if (response && response.success && response.data) {
        const { enabled, apiKey } = response.data;
        if (enabled && apiKey) {
          statusEl.textContent = '✓ 有効（録音に含まれます）';
          statusEl.className = 'rsc-whisper-config-status enabled';
        } else {
          statusEl.textContent = '未設定（ポップアップで設定）';
          statusEl.className = 'rsc-whisper-config-status disabled';
        }
      } else {
        statusEl.textContent = '未設定（ポップアップで設定）';
        statusEl.className = 'rsc-whisper-config-status disabled';
      }
    } catch (error) {
      statusEl.textContent = '確認できません';
      statusEl.className = 'rsc-whisper-config-status disabled';
    }
  }

  /**
   * 注意書きのイベントリスナーを設定
   */
  function setupNoticeListeners() {
    const noticeHeader = toolsModal?.querySelector('.rsc-notice-header');
    const noticeToggle = toolsModal?.querySelector('.rsc-notice-toggle');
    const noticeContent = toolsModal?.querySelector('.rsc-notice-content');

    // 注意書きの開閉トグル
    if (noticeHeader && noticeToggle && noticeContent) {
      // 初期状態は閉じておく
      noticeToggle.classList.add('collapsed');
      noticeContent.classList.add('collapsed');

      noticeHeader.addEventListener('click', () => {
        noticeToggle.classList.toggle('collapsed');
        noticeContent.classList.toggle('collapsed');
      });
    }
  }

  // =============================================
  // Whisper文字起こし（相手の声）
  // =============================================

  /**
   * Whisper設定を読み込む
   */
  async function loadWhisperSettings() {
    if (!isExtensionContextValid()) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_WHISPER_SETTINGS' });
      if (response?.success && response.data) {
        whisperSettings = response.data;
        console.log('[HandSign] Whisper settings loaded:', whisperSettings.enabled ? 'enabled' : 'disabled');
        updateWhisperUI();
      }
    } catch (error) {
      console.warn('[HandSign] Failed to load Whisper settings:', error);
    }
  }

  /**
   * Whisper UIを更新
   */
  function updateWhisperUI() {
    const whisperSection = toolsModal?.querySelector('.rsc-whisper-section');
    if (whisperSection) {
      whisperSection.style.display = whisperSettings.enabled ? 'block' : 'none';
    }
  }

  /**
   * Whisper文字起こしを開始（タブ音声をキャプチャ）
   */
  async function startWhisperTranscription(audioStream) {
    if (!whisperSettings.enabled || !whisperSettings.apiKey) {
      console.log('[HandSign] Whisper not enabled or no API key');
      return;
    }

    if (!audioStream || audioStream.getAudioTracks().length === 0) {
      console.warn('[HandSign] No audio stream for Whisper');
      return;
    }

    // タブ音声ストリームを保持
    tabAudioStream = audioStream;
    whisperTranscriptText = '';

    // Whisperセクションを表示
    const whisperSection = toolsModal?.querySelector('.rsc-whisper-section');
    const whisperStatus = toolsModal?.querySelector('.rsc-whisper-status');
    const whisperArea = toolsModal?.querySelector('.rsc-whisper-area');

    if (whisperSection) whisperSection.style.display = 'block';
    if (whisperStatus) {
      whisperStatus.textContent = '録音中...';
      whisperStatus.classList.add('active');
    }
    if (whisperArea) whisperArea.textContent = '';

    // 30秒ごとに音声をキャプチャしてWhisperに送信
    whisperInterval = setInterval(() => {
      captureAndTranscribe();
    }, 30000);

    // 最初のキャプチャを15秒後に開始
    setTimeout(() => {
      captureAndTranscribe();
    }, 15000);

    console.log('[HandSign] Whisper transcription started');
  }

  /**
   * 音声をキャプチャしてWhisperに送信
   */
  async function captureAndTranscribe() {
    if (!tabAudioStream || !whisperSettings.enabled) return;

    try {
      // 5秒間の音声をキャプチャ
      const audioChunks = [];
      const recorder = new MediaRecorder(tabAudioStream, { mimeType: 'audio/webm;codecs=opus' });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        if (audioChunks.length === 0) return;

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

        // Blobをbase64に変換
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64Audio = reader.result.split(',')[1];

          try {
            const response = await chrome.runtime.sendMessage({
              type: 'TRANSCRIBE_AUDIO',
              audioBase64: base64Audio
            });

            if (response?.success && response.text) {
              whisperTranscriptText += response.text + '\n';
              updateWhisperDisplay(whisperTranscriptText);
              console.log('[HandSign] Whisper transcribed:', response.text.substring(0, 50));
            } else if (response?.error) {
              console.warn('[HandSign] Whisper error:', response.error);
            }
          } catch (err) {
            console.error('[HandSign] Whisper API error:', err);
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      recorder.start();
      setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, 5000);

    } catch (error) {
      console.error('[HandSign] Capture error:', error);
    }
  }

  /**
   * Whisper文字起こしを停止
   */
  function stopWhisperTranscription() {
    if (whisperInterval) {
      clearInterval(whisperInterval);
      whisperInterval = null;
    }

    const whisperStatus = toolsModal?.querySelector('.rsc-whisper-status');
    if (whisperStatus) {
      whisperStatus.textContent = '停止中';
      whisperStatus.classList.remove('active');
    }

    tabAudioStream = null;
    console.log('[HandSign] Whisper transcription stopped');
  }

  /**
   * Whisper表示を更新
   */
  function updateWhisperDisplay(text) {
    const whisperArea = toolsModal?.querySelector('.rsc-whisper-area');
    if (whisperArea) {
      whisperArea.textContent = text || '';
      whisperArea.scrollTop = whisperArea.scrollHeight;
    }
  }

  /**
   * メモエリアを表示/非表示
   */
  function showMeetingNotesArea(show) {
    const notesArea = toolsModal?.querySelector('.rsc-meeting-notes');
    if (notesArea) {
      notesArea.style.display = show ? 'flex' : 'none';
    }
  }

  /**
   * メモをクリア
   */
  function clearMeetingNotes() {
    transcriptText = '';
    lastStructuredText = '';
    whisperTranscriptText = '';
    const transcriptArea = toolsModal?.querySelector('.rsc-transcript-area');
    const manualNotes = toolsModal?.querySelector('.rsc-manual-notes');
    const structuredArea = toolsModal?.querySelector('.rsc-structured-notes-area');
    const whisperArea = toolsModal?.querySelector('.rsc-whisper-area');
    if (transcriptArea) transcriptArea.textContent = '';
    if (manualNotes) manualNotes.value = '';
    if (structuredArea) {
      structuredArea.textContent = '（AIタブで設定後、録音中に自動構造化されます）';
      structuredArea.classList.add('placeholder');
    }
    if (whisperArea) whisperArea.textContent = '';
  }

  /**
   * レート制限をチェック（リクエスト可能か判定）
   */
  function canMakeRequest() {
    const provider = llmSettings?.provider || 'gemini';
    const limits = RATE_LIMIT[provider] || RATE_LIMIT.gemini;
    const now = Date.now();

    // 日付が変わっていたらカウンターをリセット
    const today = getTodayDateString();
    if (rateLimitDate !== today) {
      requestCountToday = 0;
      rateLimitDate = today;
      saveRateLimitToStorage();
    }

    // 1分経過していたらリセット
    if (now - lastMinuteReset > 60000) {
      requestCountMinute = 0;
      lastMinuteReset = now;
    }

    // RPMチェック
    if (requestCountMinute >= limits.rpm) {
      return { allowed: false, reason: 'rpm', waitMs: 60000 - (now - lastMinuteReset) };
    }

    // RPDチェック（Geminiのみ厳密に管理）
    if (provider === 'gemini' && requestCountToday >= limits.rpd) {
      return { allowed: false, reason: 'rpd', waitMs: 0 };
    }

    // 最小間隔チェック
    const elapsed = now - lastRequestTime;
    if (elapsed < limits.minInterval) {
      return { allowed: false, reason: 'interval', waitMs: limits.minInterval - elapsed };
    }

    return { allowed: true };
  }

  /**
   * リクエスト送信を記録
   */
  function recordRequest() {
    lastRequestTime = Date.now();
    requestCountMinute++;
    requestCountToday++;

    // 日付が変わっていたらリセット
    const today = getTodayDateString();
    if (rateLimitDate !== today) {
      requestCountToday = 1; // 今のリクエストを含める
      rateLimitDate = today;
    }

    // ストレージに保存
    saveRateLimitToStorage();
    updateRateLimitUI();
  }

  /**
   * レート制限UIを更新
   */
  function updateRateLimitUI() {
    const provider = llmSettings?.provider || 'gemini';
    const limits = RATE_LIMIT[provider] || RATE_LIMIT.gemini;
    const statusEl = toolsModal?.querySelector('.rsc-rate-limit-status');

    if (!statusEl) return;

    const now = Date.now();
    const nextAvailable = lastRequestTime + limits.minInterval;
    const remaining = Math.max(0, nextAvailable - now);

    if (remaining > 0) {
      statusEl.innerHTML = `⏳ 次の送信まで: <span class="countdown">${Math.ceil(remaining / 1000)}秒</span>`;
      statusEl.className = 'rsc-rate-limit-status waiting';
    } else {
      statusEl.innerHTML = `✅ 送信可能 <span class="request-count">(本日: ${requestCountToday}/${limits.rpd})</span>`;
      statusEl.className = 'rsc-rate-limit-status ready';
    }
  }

  /**
   * カウントダウンタイマーを開始
   */
  function startCountdownTimer() {
    if (nextRequestCountdown) {
      clearInterval(nextRequestCountdown);
    }
    nextRequestCountdown = setInterval(() => {
      updateRateLimitUI();
    }, 1000);
  }

  /**
   * カウントダウンタイマーを停止
   */
  function stopCountdownTimer() {
    if (nextRequestCountdown) {
      clearInterval(nextRequestCountdown);
      nextRequestCountdown = null;
    }
  }

  /**
   * 自動構造化を開始
   */
  async function startAutoStructure() {
    // LLM設定を取得
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_LLM_SETTINGS' });
      if (response?.success && response.data) {
        llmSettings = response.data;
      }
    } catch (error) {
      console.warn('[HandSign] Failed to get LLM settings:', error);
    }

    if (!llmSettings?.enabled || !llmSettings?.apiKey) {
      console.log('[HandSign] Auto structure disabled or no API key');
      return;
    }

    if (!llmSettings.autoStructure) {
      console.log('[HandSign] Auto structure is off');
      return;
    }

    // カウントダウンタイマー開始
    startCountdownTimer();

    // 30秒ごとに構造化（レート制限を考慮）
    structureInterval = setInterval(async () => {
      const rateCheck = canMakeRequest();
      if (!rateCheck.allowed) {
        console.log(`[HandSign] Rate limited (${rateCheck.reason}), waiting ${Math.ceil(rateCheck.waitMs / 1000)}s`);
        return;
      }
      if (transcriptText && transcriptText !== lastStructuredText && transcriptText.length > 50) {
        await structureCurrentTranscript();
      }
    }, 30000);

    console.log('[HandSign] Auto structure started');
  }

  /**
   * 自動構造化を停止
   */
  function stopAutoStructure() {
    if (structureInterval) {
      clearInterval(structureInterval);
      structureInterval = null;
    }
    stopCountdownTimer();
    console.log('[HandSign] Auto structure stopped');
  }

  /**
   * 現在の文字起こしを構造化
   */
  async function structureCurrentTranscript() {
    // レート制限チェック（手動ボタン押下時）
    const rateCheck = canMakeRequest();
    if (!rateCheck.allowed) {
      const structuredArea = toolsModal?.querySelector('.rsc-structured-notes-area');
      if (structuredArea) {
        if (rateCheck.reason === 'rpd') {
          structuredArea.textContent = '本日のリクエスト上限に達しました';
        } else {
          structuredArea.textContent = `⏳ ${Math.ceil(rateCheck.waitMs / 1000)}秒後に再試行してください`;
        }
      }
      return;
    }

    const manualNotes = toolsModal?.querySelector('.rsc-manual-notes')?.value || '';
    const hasTranscript = transcriptText && transcriptText.trim().length > 0;
    const hasNotes = manualNotes.trim().length > 0;

    if (!hasTranscript && !hasNotes) {
      const structuredArea = toolsModal?.querySelector('.rsc-structured-notes-area');
      if (structuredArea) {
        structuredArea.textContent = '（文字起こしまたはメモを入力してください）';
      }
      return;
    }

    // 文字起こしとメモを結合
    let combinedInput = '';
    if (hasTranscript) {
      combinedInput += '【自分の発言（文字起こし）】\n' + transcriptText.trim() + '\n\n';
    }
    // 相手の発言（Whisper）があれば追加
    if (whisperTranscriptText && whisperTranscriptText.trim()) {
      combinedInput += '【相手の発言（Whisper）】\n' + whisperTranscriptText.trim() + '\n\n';
    }
    if (hasNotes) {
      combinedInput += '【手動メモ】\n' + manualNotes.trim();
    }

    const structuredArea = toolsModal?.querySelector('.rsc-structured-notes-area');
    const structureBtn = toolsModal?.querySelector('.rsc-structure-btn');

    if (structureBtn) {
      structureBtn.classList.add('loading');
      structureBtn.disabled = true;
    }

    // リクエスト送信を記録
    recordRequest();

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'STRUCTURE_TRANSCRIPT',
        transcript: combinedInput,
        settings: llmSettings
      });

      if (response?.success && response.structured) {
        lastStructuredText = transcriptText;
        if (structuredArea) {
          structuredArea.textContent = response.structured;
          structuredArea.classList.remove('placeholder');
          structuredArea.scrollTop = structuredArea.scrollHeight;
        }
        console.log('[HandSign] Transcript structured');
      } else {
        console.warn('[HandSign] Structure failed:', response?.error);
        if (structuredArea && response?.error) {
          // 既存のメモを保持し、エラーを追記
          const existingText = structuredArea.textContent || '';
          const timestamp = new Date().toLocaleTimeString('ja-JP');
          const errorMessage = `\n\n---\n⚠️ [${timestamp}] 構造化エラー: ${response.error}`;
          if (existingText && !existingText.includes('（AIタブで設定後')) {
            structuredArea.textContent = existingText + errorMessage;
          } else {
            structuredArea.textContent = `⚠️ [${timestamp}] 構造化エラー: ${response.error}`;
          }
          structuredArea.classList.remove('placeholder');
          structuredArea.scrollTop = structuredArea.scrollHeight;
        }
      }
    } catch (error) {
      console.error('[HandSign] Structure error:', error);
      // 例外発生時も既存メモを保持しエラー追記
      if (structuredArea) {
        const existingText = structuredArea.textContent || '';
        const timestamp = new Date().toLocaleTimeString('ja-JP');
        const errorMessage = `\n\n---\n⚠️ [${timestamp}] 構造化エラー: ${error.message || '不明なエラー'}`;
        if (existingText && !existingText.includes('（AIタブで設定後')) {
          structuredArea.textContent = existingText + errorMessage;
        } else {
          structuredArea.textContent = `⚠️ [${timestamp}] 構造化エラー: ${error.message || '不明なエラー'}`;
        }
        structuredArea.classList.remove('placeholder');
        structuredArea.scrollTop = structuredArea.scrollHeight;
      }
    } finally {
      if (structureBtn) {
        structureBtn.classList.remove('loading');
        structureBtn.disabled = false;
      }
    }
  }

  /**
   * 現在のメモを取得（構造化メモ含む）
   */
  function getMeetingNotesText() {
    const manualNotes = toolsModal?.querySelector('.rsc-manual-notes')?.value || '';
    const structuredNotes = toolsModal?.querySelector('.rsc-structured-notes-area')?.textContent || '';
    const whisperNotes = toolsModal?.querySelector('.rsc-whisper-area')?.textContent || '';
    let text = '';

    // 構造化メモ（AIによる要約）を先頭に
    if (structuredNotes.trim() && !structuredNotes.startsWith('（')) {
      text += '【自動構造化メモ】\n' + structuredNotes.trim() + '\n\n';
    }

    // 手動メモ
    if (manualNotes.trim()) {
      text += '【メモ】\n' + manualNotes.trim() + '\n\n';
    }

    // 文字起こし（自分の発言）
    if (transcriptText.trim()) {
      text += '【文字起こし（自分）】\n' + transcriptText.trim() + '\n\n';
    }

    // 相手の発言（Whisper）
    if (whisperNotes.trim()) {
      text += '【相手の発言（Whisper）】\n' + whisperNotes.trim() + '\n';
    }

    return text;
  }

  // Note: IndexedDB関連の関数（initRecordingsDb, saveRecordingToDb, loadRecordingsFromDb, deleteRecordingFromDb）は
  // recorder/recordings-db.js に移動しました。window.RecordingsDB として利用可能です。

  /**
   * 録音データを保存
   */
  async function saveRecordingData(blob) {
    const now = new Date();
    const dateStr = now.toLocaleString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const notesText = getMeetingNotesText();

    const recording = {
      id: Date.now(),
      name: dateStr,
      blob: blob,
      duration: formatRecorderTime(Date.now() - recordingStartTime),
      date: now.toLocaleString('ja-JP'),
      notes: notesText // メモを保存
    };

    recordings.unshift(recording);
    updateRecordingsList();

    // IndexedDBに保存（RecordingsDBモジュール使用）
    await window.RecordingsDB.save(recording);
  }

  /**
   * 録音リストを更新
   */
  function updateRecordingsList() {
    if (!toolsModal) return;
    const container = toolsModal.querySelector('.rsc-recorder-recordings');
    if (!container) return;

    if (recordings.length === 0) {
      container.innerHTML = '';
      return;
    }

    let html = '<div class="rsc-recorder-recordings-title">録音履歴</div>';

    for (const recording of recordings.slice(0, 5)) {
      const isPlaying = currentPlayingId === recording.id;
      const hasNotes = recording.notes && recording.notes.trim();
      html += `
        <div class="rsc-recording-item" data-id="${recording.id}">
          <div class="rsc-recording-info">
            <span class="rsc-recording-name">${recording.name}</span>
            <span class="rsc-recording-meta">${recording.duration}${hasNotes ? ' 📝' : ''}</span>
          </div>
          <div class="rsc-recording-actions">
            <button class="rsc-recording-btn rsc-recording-play ${isPlaying ? 'playing' : ''}" data-id="${recording.id}" title="${isPlaying ? '停止' : '再生'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="${isPlaying ? 'display:none' : ''}">
                <path d="M8 5v14l11-7z"/>
              </svg>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="${isPlaying ? '' : 'display:none'}">
                <path d="M6 6h12v12H6z"/>
              </svg>
            </button>
            <button class="rsc-recording-btn rsc-recording-download" data-id="${recording.id}" title="音声ダウンロード">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
              </svg>
            </button>
            ${hasNotes ? `
            <button class="rsc-recording-btn rsc-recording-notes-download" data-id="${recording.id}" title="メモダウンロード">📄</button>
            <button class="rsc-recording-btn rsc-recording-notes-copy" data-id="${recording.id}" title="メモコピー">📋</button>
            ` : ''}
            <button class="rsc-recording-btn rsc-recording-delete" data-id="${recording.id}" title="削除">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    // イベントハンドラー
    container.querySelectorAll('.rsc-recording-play').forEach(btn => {
      btn.addEventListener('click', () => playRecordingById(parseInt(btn.dataset.id)));
    });
    container.querySelectorAll('.rsc-recording-download').forEach(btn => {
      btn.addEventListener('click', () => downloadRecordingById(parseInt(btn.dataset.id)));
    });
    container.querySelectorAll('.rsc-recording-notes-download').forEach(btn => {
      btn.addEventListener('click', () => downloadNotesById(parseInt(btn.dataset.id)));
    });
    container.querySelectorAll('.rsc-recording-notes-copy').forEach(btn => {
      btn.addEventListener('click', () => copyNotesById(parseInt(btn.dataset.id)));
    });
    container.querySelectorAll('.rsc-recording-delete').forEach(btn => {
      btn.addEventListener('click', () => deleteRecordingById(parseInt(btn.dataset.id)));
    });
  }

  /**
   * メモをダウンロード
   */
  function downloadNotesById(id) {
    const recording = recordings.find(r => r.id === id);
    if (!recording || !recording.notes) return;

    const blob = new Blob([recording.notes], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recording.name}_notes.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * メモをクリップボードにコピー
   */
  async function copyNotesById(id) {
    const recording = recordings.find(r => r.id === id);
    if (!recording || !recording.notes) return;

    try {
      await navigator.clipboard.writeText(recording.notes);
      showTimerToast('メモをコピーしました');
    } catch (e) {
      console.error('[HandSign] Failed to copy notes:', e);
      showTimerToast('コピーに失敗しました');
    }
  }

  /**
   * 録音を再生
   */
  function playRecordingById(id) {
    if (currentPlayingId === id) {
      stopPlaybackAudio();
      return;
    }

    stopPlaybackAudio();

    const recording = recordings.find(r => r.id === id);
    if (!recording) return;

    const url = URL.createObjectURL(recording.blob);
    const audio = new Audio(url);
    currentPlayingAudio = audio;
    currentPlayingId = id;

    updateRecordingsList();

    audio.play();

    audio.onended = audio.onerror = () => {
      URL.revokeObjectURL(url);
      currentPlayingAudio = null;
      currentPlayingId = null;
      updateRecordingsList();
    };
  }

  /**
   * 再生を停止
   */
  function stopPlaybackAudio() {
    if (currentPlayingAudio) {
      currentPlayingAudio.pause();
      currentPlayingAudio.currentTime = 0;
      URL.revokeObjectURL(currentPlayingAudio.src);
      currentPlayingAudio = null;
    }
    currentPlayingId = null;
    updateRecordingsList();
  }

  /**
   * 簡易トースト表示
   */
  function showSimpleToast(message, type = 'info') {
    const colors = {
      info: '#2196F3',
      success: '#4CAF50',
      error: '#f44336'
    };
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${colors[type] || colors.info};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      z-index: 100001;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  /**
   * 録音をダウンロード（MP3に変換）- MP3Converterモジュール使用
   */
  async function downloadRecordingById(id) {
    const recording = recordings.find(r => r.id === id);
    if (!recording) return;

    try {
      await window.MP3Converter.download(recording, (status, errorMsg) => {
        if (status === 'converting') {
          showSimpleToast('MP3に変換中...', 'info');
        } else if (status === 'complete') {
          showSimpleToast('MP3ダウンロード完了', 'success');
        } else if (status === 'error') {
          showSimpleToast('MP3変換に失敗: ' + errorMsg, 'error');
        }
      });
    } catch (error) {
      console.error('[HandSign] Download failed:', error);
      showSimpleToast('MP3変換に失敗しました: ' + error.message, 'error');
    }
  }

  /**
   * 録音を削除
   */
  async function deleteRecordingById(id) {
    const index = recordings.findIndex(r => r.id === id);
    if (index === -1) return;

    const recording = recordings[index];
    if (!confirm(`「${recording.name}」を削除しますか？`)) return;

    if (currentPlayingId === id) {
      stopPlaybackAudio();
    }

    recordings.splice(index, 1);
    updateRecordingsList();

    // IndexedDBからも削除（RecordingsDBモジュール使用）
    await window.RecordingsDB.delete(id);
  }

  /**
   * 録音履歴を読み込み（RecordingsDBモジュール使用）
   */
  async function loadRecordings() {
    try {
      recordings = await window.RecordingsDB.loadAll();
      updateRecordingsList();
      // 古い録音を自動削除
      const cleaned = await window.RecordingsDB.cleanup(30);
      if (cleaned > 0) {
        // 削除された分をローカル配列からも除去
        const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        recordings = recordings.filter(r => r.id >= oneMonthAgo);
        updateRecordingsList();
      }
    } catch (e) {
      console.error('[HandSign] Failed to load recordings:', e);
    }
  }

  /**
   * 録音UIを更新
   */
  function updateRecorderUI(state) {
    if (!toolsModal) return;

    const indicator = toolsModal.querySelector('.rsc-recorder-indicator');
    const statusText = toolsModal.querySelector('.rsc-recorder-status-text');
    const recordBtn = toolsModal.querySelector('.rsc-recorder-btn-record');
    const pauseBtn = toolsModal.querySelector('.rsc-recorder-btn-pause');
    const stopBtn = toolsModal.querySelector('.rsc-recorder-btn-stop');

    indicator.className = 'rsc-recorder-indicator ' + state;

    switch (state) {
      case 'recording':
        statusText.textContent = '録音中';
        recordBtn.disabled = true;
        pauseBtn.disabled = false;
        stopBtn.disabled = false;
        break;
      case 'paused':
        statusText.textContent = '一時停止';
        recordBtn.disabled = true;
        pauseBtn.disabled = false;
        stopBtn.disabled = false;
        break;
      case 'idle':
      default:
        statusText.textContent = '待機中';
        recordBtn.disabled = false;
        pauseBtn.disabled = true;
        stopBtn.disabled = true;
        if (toolsModal) {
          toolsModal.querySelector('.rsc-recorder-time').textContent = '00:00:00';
        }
        break;
    }
  }

  /**
   * 録音タイマーを開始
   */
  function startRecorderTimer() {
    recorderTimerInterval = setInterval(() => {
      const elapsed = Date.now() - recordingStartTime;
      const timeEl = toolsModal?.querySelector('.rsc-recorder-time');
      if (timeEl) {
        timeEl.textContent = formatRecorderTime(elapsed);
      }
    }, 1000);
  }

  /**
   * 録音タイマーを停止
   */
  function stopRecorderTimer() {
    if (recorderTimerInterval) {
      clearInterval(recorderTimerInterval);
      recorderTimerInterval = null;
    }
  }

  /**
   * 時間をフォーマット
   */
  function formatRecorderTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [hours, minutes, secs].map(n => n.toString().padStart(2, '0')).join(':');
  }

  /**
   * 録音エラーを表示
   */
  function showRecorderError(message) {
    const info = toolsModal?.querySelector('.rsc-recorder-info');
    if (info) {
      info.textContent = message;
      info.style.background = 'rgba(239, 68, 68, 0.2)';
      info.style.color = '#f87171';
    }
  }

  /**
   * 録音情報を表示
   */
  function showRecorderInfo(message) {
    const info = toolsModal?.querySelector('.rsc-recorder-info');
    if (info) {
      info.textContent = message;
      info.style.background = 'rgba(255,255,255,0.05)';
      info.style.color = '#718096';
    }
  }

  // メッセージを受信
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 通知音再生
    if (message.type === 'PLAY_NOTIFICATION_SOUND' && message.url) {
      const audio = new Audio(message.url);
      audio.volume = 0.7;
      audio.play().catch(console.error);
      sendResponse({ success: true });
      return true;
    }

    // カメラモーダルを開く（統合モーダルに変更）
    if (message.type === 'OPEN_CAMERA_MODAL') {
      openToolsModal('camera');
      sendResponse({ success: true });
      return true;
    }

    // カメラモーダルを閉じる
    if (message.type === 'CLOSE_CAMERA_MODAL') {
      closeToolsModal();
      sendResponse({ success: true });
      return true;
    }

    // 録音モーダルを開く
    if (message.type === 'OPEN_RECORDER_MODAL') {
      openToolsModal('recorder');
      sendResponse({ success: true });
      return true;
    }

    return false;
  });

  /**
   * ウィジェットを非表示にする（ログアウト時）
   */
  function hideAllWidgets() {
    if (timerElement) {
      timerElement.style.display = 'none';
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    console.log('[HandSign] Widgets hidden (logged out)');
  }

  /**
   * ウィジェットを表示する（ログイン時）
   */
  function showAllWidgets() {
    if (timerElement) {
      updateTimerVisibility();
    }
    if (!timerInterval) {
      startTimer();
    }
    console.log('[HandSign] Widgets shown (logged in)');
  }

  // ===== 音声設定モーダル =====

  let soundSettingsModal = null;
  // presetSounds はファイル先頭で宣言済み
  let soundSettings = null;

  const SOUND_LABELS = {
    calling: '発信中（呼び出し音）',
    incoming: '着信音',
    outgoing: '発信音',
    disconnect: '切断音',
    doorchime: 'ドアチャイム'
  };

  /**
   * 音声設定モーダルを作成
   */
  function createSoundSettingsModal() {
    if (soundSettingsModal) return soundSettingsModal;

    soundSettingsModal = document.createElement('div');
    soundSettingsModal.id = 'rsc-sound-settings-modal';
    soundSettingsModal.innerHTML = `
      <div class="rsc-modal-overlay"></div>
      <div class="rsc-modal-dialog rsc-sound-dialog">
        <div class="rsc-modal-header">
          <div class="rsc-modal-title">🔊 音声設定</div>
          <button class="rsc-modal-close">×</button>
        </div>
        <div class="rsc-sound-settings-content">
          <div class="rsc-sound-loading">読み込み中...</div>
        </div>
      </div>
    `;

    // スタイルを追加
    if (!document.getElementById('rsc-sound-settings-styles')) {
      const style = document.createElement('style');
      style.id = 'rsc-sound-settings-styles';
      style.textContent = `
        #rsc-sound-settings-modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        #rsc-sound-settings-modal.rsc-active {
          display: flex;
          align-items: center;
          justify-content: center;
        }
        #rsc-sound-settings-modal .rsc-modal-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
        }
        #rsc-sound-settings-modal .rsc-modal-dialog {
          position: relative;
          background: #1a1a2e;
          border-radius: 16px;
          padding: 0;
          max-width: 600px;
          width: 95%;
          max-height: 95vh;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }
        #rsc-sound-settings-modal .rsc-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          background: linear-gradient(135deg, #2d3748 0%, #1a202c 100%);
        }
        #rsc-sound-settings-modal .rsc-modal-title {
          color: #fff;
          font-size: 16px;
          font-weight: 500;
        }
        #rsc-sound-settings-modal .rsc-modal-close {
          background: none;
          border: none;
          color: #888;
          font-size: 28px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          transition: all 0.2s;
        }
        #rsc-sound-settings-modal .rsc-modal-close:hover {
          color: #fff;
          background: rgba(255,255,255,0.1);
        }
        .rsc-sound-settings-content {
          padding: 20px;
          max-height: calc(95vh - 70px);
          overflow-y: auto;
        }
        .rsc-sound-loading {
          text-align: center;
          color: #a0aec0;
          padding: 40px;
        }
        .rsc-sound-item {
          background: rgba(255,255,255,0.05);
          border-radius: 10px;
          padding: 16px;
          margin-bottom: 12px;
        }
        .rsc-sound-item:last-child {
          margin-bottom: 0;
        }
        .rsc-sound-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .rsc-sound-item-label {
          color: #fff;
          font-size: 14px;
          font-weight: 500;
        }
        .rsc-sound-item-mode {
          color: #a0aec0;
          font-size: 12px;
          padding: 4px 8px;
          background: rgba(255,255,255,0.1);
          border-radius: 4px;
        }
        .rsc-sound-select-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .rsc-sound-select {
          flex: 1;
          padding: 10px 12px;
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 8px;
          background: rgba(255,255,255,0.1);
          color: #fff;
          font-size: 14px;
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23a0aec0' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
        }
        .rsc-sound-select:focus {
          outline: none;
          border-color: #667eea;
        }
        .rsc-sound-select option {
          background: #1a1a2e;
          color: #fff;
        }
        .rsc-sound-play-btn {
          width: 40px;
          height: 40px;
          border: none;
          border-radius: 8px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #fff;
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .rsc-sound-play-btn:hover {
          transform: scale(1.05);
        }
        .rsc-sound-play-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .rsc-sound-upload-btn {
          width: 40px;
          height: 40px;
          border: none;
          border-radius: 8px;
          background: #6b7280;
          color: #fff;
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .rsc-sound-upload-btn:hover {
          background: #4b5563;
          transform: scale(1.05);
        }
        .rsc-sound-custom-info {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
          padding: 8px 12px;
          background: rgba(74, 222, 128, 0.1);
          border: 1px solid rgba(74, 222, 128, 0.3);
          border-radius: 6px;
          font-size: 13px;
        }
        .rsc-sound-custom-name {
          flex: 1;
          color: #4ade80;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rsc-sound-custom-delete {
          background: none;
          border: none;
          color: #ef4444;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 6px;
        }
        .rsc-sound-custom-delete:hover {
          color: #f87171;
        }
        .rsc-sound-notification {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid rgba(255,255,255,0.1);
        }
        .rsc-sound-notification-title {
          color: #fff;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 12px;
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(soundSettingsModal);

    // イベント設定
    soundSettingsModal.querySelector('.rsc-modal-overlay').addEventListener('click', closeSoundSettingsModal);
    soundSettingsModal.querySelector('.rsc-modal-close').addEventListener('click', closeSoundSettingsModal);

    return soundSettingsModal;
  }

  /**
   * 音声設定モーダルを開く
   * @param {boolean} scrollToNotification - 通知音設定にスクロールするかどうか
   */
  async function openSoundSettingsModal(scrollToNotification = false) {
    createSoundSettingsModal();
    soundSettingsModal.classList.add('rsc-active');

    // データを読み込み
    await loadSoundSettingsData();
    renderSoundSettings();

    // 通知音設定にスクロール
    if (scrollToNotification) {
      setTimeout(() => {
        const notificationSection = soundSettingsModal.querySelector('.rsc-sound-notification');
        if (notificationSection) {
          notificationSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // ハイライト効果
          notificationSection.style.transition = 'background-color 0.3s';
          notificationSection.style.backgroundColor = 'rgba(74, 144, 217, 0.2)';
          setTimeout(() => {
            notificationSection.style.backgroundColor = '';
          }, 1500);
        }
      }, 100);
    }
  }

  /**
   * 音声設定モーダルを閉じる
   */
  function closeSoundSettingsModal() {
    if (soundSettingsModal) {
      soundSettingsModal.classList.remove('rsc-active');
    }
  }

  // ===== ハンドサイン設定モーダル =====
  let handSignSettingsModal = null;

  /**
   * ハンドサイン設定モーダルを作成
   */
  function createHandSignSettingsModal() {
    if (handSignSettingsModal) return handSignSettingsModal;

    handSignSettingsModal = document.createElement('div');
    handSignSettingsModal.id = 'rsc-handsign-settings-modal';
    handSignSettingsModal.innerHTML = `
      <style>
        #rsc-handsign-settings-modal {
          display: none;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 100002;
        }
        #rsc-handsign-settings-modal.rsc-active {
          display: block;
        }
        #rsc-handsign-settings-modal .rsc-modal-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
        }
        #rsc-handsign-settings-modal .rsc-modal-dialog {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #1e1e1e;
          border-radius: 12px;
          width: 400px;
          max-height: 80vh;
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        #rsc-handsign-settings-modal .rsc-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid #333;
        }
        #rsc-handsign-settings-modal .rsc-modal-title {
          font-size: 16px;
          font-weight: 600;
          color: #fff;
        }
        #rsc-handsign-settings-modal .rsc-modal-close {
          background: none;
          border: none;
          color: #888;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        #rsc-handsign-settings-modal .rsc-modal-close:hover {
          color: #fff;
        }
        #rsc-handsign-settings-modal .rsc-modal-body {
          padding: 16px;
          overflow-y: auto;
          max-height: calc(80vh - 60px);
          color: #e0e0e0;
        }
        .rsc-hs-section {
          margin-bottom: 16px;
          padding-bottom: 16px;
          border-bottom: 1px solid #333;
        }
        .rsc-hs-section:last-child {
          border-bottom: none;
          margin-bottom: 0;
        }
        .rsc-hs-label {
          font-size: 13px;
          font-weight: 500;
          color: #a0a0a0;
          margin-bottom: 8px;
        }
        .rsc-hs-toggle {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .rsc-hs-toggle-switch {
          position: relative;
          width: 44px;
          height: 24px;
        }
        .rsc-hs-toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .rsc-hs-toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #555;
          transition: 0.3s;
          border-radius: 24px;
        }
        .rsc-hs-toggle-slider:before {
          position: absolute;
          content: "";
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }
        .rsc-hs-toggle-switch input:checked + .rsc-hs-toggle-slider {
          background-color: #4a90d9;
        }
        .rsc-hs-toggle-switch input:checked + .rsc-hs-toggle-slider:before {
          transform: translateX(20px);
        }
        .rsc-hs-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #444;
          border-radius: 6px;
          background: #2d2d2d;
          color: #fff;
          font-size: 14px;
        }
        .rsc-hs-input:focus {
          outline: none;
          border-color: #4a90d9;
        }
        .rsc-hs-sound-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .rsc-hs-sound-select {
          flex: 1;
          padding: 10px 12px;
          border: 1px solid #444;
          border-radius: 6px;
          background: #2d2d2d;
          color: #fff;
          font-size: 14px;
        }
        .rsc-hs-sound-select option,
        .rsc-hs-sound-select optgroup {
          background: #2d2d2d;
          color: #fff;
        }
        .rsc-hs-sound-btn {
          width: 36px;
          height: 36px;
          border: none;
          border-radius: 6px;
          background: #4a90d9;
          color: #fff;
          font-size: 14px;
          cursor: pointer;
        }
        .rsc-hs-sound-btn:hover {
          background: #3a7bc8;
        }
        .rsc-hs-upload-btn {
          background: #6b7280;
        }
        .rsc-hs-upload-btn:hover {
          background: #4b5563;
        }
        .rsc-hs-custom-info {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
          padding: 8px 12px;
          background: #3d3d3d;
          border-radius: 6px;
          font-size: 13px;
        }
        .rsc-hs-custom-name {
          flex: 1;
          color: #4ade80;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .rsc-hs-custom-delete {
          background: none;
          border: none;
          color: #ef4444;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 6px;
        }
        .rsc-hs-custom-delete:hover {
          color: #f87171;
        }
        .rsc-hs-test-btn {
          width: 100%;
          padding: 10px;
          border: none;
          border-radius: 6px;
          background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
          color: #fff;
          font-size: 14px;
          cursor: pointer;
          margin-top: 12px;
        }
        .rsc-hs-test-btn:hover {
          background: linear-gradient(135deg, #68d391 0%, #48bb78 100%);
        }
      </style>
      <div class="rsc-modal-overlay"></div>
      <div class="rsc-modal-dialog">
        <div class="rsc-modal-header">
          <span class="rsc-modal-title">🔔 通知設定</span>
          <button class="rsc-modal-close">&times;</button>
        </div>
        <div class="rsc-modal-body">
          <div class="rsc-hs-section">
            <div class="rsc-hs-label">ハンドサイン検出</div>
            <div class="rsc-hs-toggle">
              <label class="rsc-hs-toggle-switch">
                <input type="checkbox" id="rsc-hs-enabled">
                <span class="rsc-hs-toggle-slider"></span>
              </label>
              <span>他のメンバーの手を検出して通知</span>
            </div>
          </div>
          <div class="rsc-hs-section">
            <div class="rsc-hs-label">自分の名前（検出から除外）</div>
            <input type="text" class="rsc-hs-input" id="rsc-hs-myname" placeholder="例: 松川 幸平">
          </div>
          <div class="rsc-hs-section">
            <div class="rsc-hs-label">通知音</div>
            <div class="rsc-hs-sound-row">
              <select class="rsc-hs-sound-select" id="rsc-hs-sound"></select>
              <button class="rsc-hs-sound-btn" id="rsc-hs-sound-play" title="試聴">▶</button>
              <button class="rsc-hs-sound-btn rsc-hs-upload-btn" id="rsc-hs-sound-upload" title="カスタム音声をアップロード">📁</button>
              <input type="file" id="rsc-hs-sound-file" accept="audio/*" style="display:none;">
            </div>
            <div class="rsc-hs-custom-info" id="rsc-hs-custom-info" style="display:none;">
              <span class="rsc-hs-custom-name"></span>
              <button class="rsc-hs-custom-delete" title="削除">✕</button>
            </div>
          </div>
          <button class="rsc-hs-test-btn" id="rsc-hs-test">🔔 通知テスト</button>
        </div>
      </div>
    `;

    document.body.appendChild(handSignSettingsModal);

    // イベントハンドラ
    handSignSettingsModal.querySelector('.rsc-modal-overlay').addEventListener('click', closeHandSignSettingsModal);
    handSignSettingsModal.querySelector('.rsc-modal-close').addEventListener('click', closeHandSignSettingsModal);

    // 有効/無効トグル
    handSignSettingsModal.querySelector('#rsc-hs-enabled').addEventListener('change', async (e) => {
      settings.enabled = e.target.checked;
      await saveHandSignSettings();
    });

    // 自分の名前
    handSignSettingsModal.querySelector('#rsc-hs-myname').addEventListener('change', async (e) => {
      settings.myName = e.target.value;
      await saveHandSignSettings();
    });

    // 通知音変更
    handSignSettingsModal.querySelector('#rsc-hs-sound').addEventListener('change', async (e) => {
      if (!settings.notifications) settings.notifications = {};
      settings.notifications.soundPreset = e.target.value;
      await saveHandSignSettings();
    });

    // 試聴ボタン
    handSignSettingsModal.querySelector('#rsc-hs-sound-play').addEventListener('click', () => {
      const soundPreset = handSignSettingsModal.querySelector('#rsc-hs-sound').value;
      chrome.runtime.sendMessage({
        type: 'PLAY_HAND_SIGN_SOUND',
        preset: soundPreset
      });
    });

    // テストボタン
    handSignSettingsModal.querySelector('#rsc-hs-test').addEventListener('click', () => {
      testNotification();
    });

    // アップロードボタン
    handSignSettingsModal.querySelector('#rsc-hs-sound-upload').addEventListener('click', () => {
      handSignSettingsModal.querySelector('#rsc-hs-sound-file').click();
    });

    // ファイル選択
    handSignSettingsModal.querySelector('#rsc-hs-sound-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // ファイルサイズチェック（10MB制限）
      if (file.size > 10 * 1024 * 1024) {
        showTimerToast('ファイルサイズは10MB以下にしてください');
        return;
      }

      try {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const base64Data = event.target.result;

          // カスタム音声を保存
          await chrome.runtime.sendMessage({
            type: 'SAVE_NOTIFICATION_CUSTOM_SOUND',
            data: base64Data,
            fileName: file.name,
            mimeType: file.type
          });

          // 設定を更新
          if (!settings.notifications) settings.notifications = {};
          settings.notifications.soundPreset = 'custom';
          settings.notifications.customFileName = file.name;
          await saveHandSignSettings();

          // UI更新
          updateCustomSoundInfo(file.name);
          showTimerToast('カスタム音声を設定しました');
        };
        reader.readAsDataURL(file);
      } catch (error) {
        console.error('[HandSign] Failed to upload custom sound:', error);
        showTimerToast('アップロードに失敗しました');
      }

      // ファイル入力をリセット
      e.target.value = '';
    });

    // カスタム音声削除ボタン
    handSignSettingsModal.querySelector('.rsc-hs-custom-delete').addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'DELETE_NOTIFICATION_CUSTOM_SOUND' });

        if (!settings.notifications) settings.notifications = {};
        settings.notifications.soundPreset = 'outgoing:outgoing_horn';
        settings.notifications.customFileName = null;
        await saveHandSignSettings();

        // UI更新
        updateCustomSoundInfo(null);
        handSignSettingsModal.querySelector('#rsc-hs-sound').value = 'outgoing:outgoing_horn';
        showTimerToast('カスタム音声を削除しました');
      } catch (error) {
        console.error('[HandSign] Failed to delete custom sound:', error);
      }
    });

    return handSignSettingsModal;
  }

  /**
   * カスタム音声情報の表示を更新
   */
  function updateCustomSoundInfo(fileName) {
    const customInfo = handSignSettingsModal?.querySelector('#rsc-hs-custom-info');
    const customName = handSignSettingsModal?.querySelector('.rsc-hs-custom-name');
    const soundSelect = handSignSettingsModal?.querySelector('#rsc-hs-sound');

    if (!customInfo) return;

    if (fileName) {
      customInfo.style.display = 'flex';
      customName.textContent = `🎵 ${fileName}`;
      // プルダウンを無効化してカスタムを示す
      if (soundSelect) {
        // カスタムオプションを追加または選択
        let customOption = soundSelect.querySelector('option[value="custom"]');
        if (!customOption) {
          customOption = document.createElement('option');
          customOption.value = 'custom';
          customOption.textContent = '🎵 カスタム音声';
          soundSelect.insertBefore(customOption, soundSelect.firstChild);
        }
        soundSelect.value = 'custom';
      }
    } else {
      customInfo.style.display = 'none';
      // カスタムオプションを削除
      const customOption = soundSelect?.querySelector('option[value="custom"]');
      if (customOption) {
        customOption.remove();
      }
    }
  }

  /**
   * ハンドサイン設定モーダルを開く
   */
  async function openHandSignSettingsModal() {
    createHandSignSettingsModal();
    handSignSettingsModal.classList.add('rsc-active');

    // 現在の設定を反映
    handSignSettingsModal.querySelector('#rsc-hs-enabled').checked = settings.enabled || false;
    handSignSettingsModal.querySelector('#rsc-hs-myname').value = settings.myName || '';

    // 通知音のプリセットを読み込み
    const soundSelect = handSignSettingsModal.querySelector('#rsc-hs-sound');
    soundSelect.innerHTML = '';

    try {
      const presetsResponse = await chrome.runtime.sendMessage({ type: 'GET_PRESET_SOUNDS' });
      if (presetsResponse && presetsResponse.success && presetsResponse.data) {
        // カテゴリ名の日本語マッピング
        const categoryNames = {
          calling: '発信中（呼び出し音）',
          incoming: '着信音',
          outgoing: '発信音',
          disconnect: '切断音',
          doorchime: 'ドアチャイム'
        };
        for (const [category, sounds] of Object.entries(presetsResponse.data)) {
          if (Array.isArray(sounds) && sounds.length > 0) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = categoryNames[category] || category;
            sounds.forEach(sound => {
              const option = document.createElement('option');
              option.value = `${category}:${sound.id}`;
              option.textContent = sound.label || sound.name || sound.id;
              optgroup.appendChild(option);
            });
            soundSelect.appendChild(optgroup);
          }
        }
      }
    } catch (error) {
      console.error('[HandSign] Failed to load preset sounds:', error);
    }

    // 現在の選択を反映
    const currentSound = settings.notifications?.soundPreset || 'outgoing:outgoing_horn';

    // カスタム音声が設定されている場合
    if (currentSound === 'custom' && settings.notifications?.customFileName) {
      updateCustomSoundInfo(settings.notifications.customFileName);
    } else {
      updateCustomSoundInfo(null);
      soundSelect.value = currentSound;
    }
  }

  /**
   * ハンドサイン設定モーダルを閉じる
   */
  function closeHandSignSettingsModal() {
    if (handSignSettingsModal) {
      handSignSettingsModal.classList.remove('rsc-active');
    }
  }

  /**
   * ハンドサイン設定を保存
   */
  async function saveHandSignSettings() {
    try {
      await chrome.runtime.sendMessage({
        type: 'SAVE_HAND_SIGN_SETTINGS',
        settings: settings
      });
    } catch (error) {
      console.error('[HandSign] Failed to save settings:', error);
    }
  }

  /**
   * 音声設定データを読み込む
   */
  async function loadSoundSettingsData() {
    try {
      // プリセット音声を取得
      const presetsResponse = await chrome.runtime.sendMessage({ type: 'GET_PRESET_SOUNDS' });
      if (presetsResponse && presetsResponse.success) {
        presetSounds = presetsResponse.data;
      }

      // 現在の設定を取得
      const settingsResponse = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (settingsResponse && settingsResponse.success) {
        soundSettings = settingsResponse.data;
      }
    } catch (error) {
      console.error('[HandSign] Failed to load sound settings:', error);
    }
  }

  /**
   * 音声設定UIをレンダリング
   */
  function renderSoundSettings() {
    const content = soundSettingsModal.querySelector('.rsc-sound-settings-content');
    if (!presetSounds) {
      content.innerHTML = '<div class="rsc-sound-loading">音声データを読み込めませんでした</div>';
      return;
    }

    let html = '';

    // 各音声タイプ
    const soundTypes = ['calling', 'incoming', 'outgoing', 'disconnect', 'doorchime'];
    for (const type of soundTypes) {
      const label = SOUND_LABELS[type];
      const presets = presetSounds[type] || [];
      const currentSetting = soundSettings?.sounds?.[type] || { mode: 'original' };
      const currentMode = currentSetting.mode || 'original';
      const currentPresetId = currentSetting.presetId || '';

      const customFileName = currentSetting.customFileName || '';
      const hasCustom = currentMode === 'custom' && customFileName;

      html += `
        <div class="rsc-sound-item" data-type="${type}">
          <div class="rsc-sound-item-header">
            <span class="rsc-sound-item-label">${label}</span>
            <span class="rsc-sound-item-mode">${currentMode === 'original' ? 'オリジナル' : currentMode === 'preset' ? 'プリセット' : 'カスタム'}</span>
          </div>
          <div class="rsc-sound-select-row">
            <select class="rsc-sound-select" data-type="${type}">
              <option value="original"${currentMode === 'original' ? ' selected' : ''}>オリジナル</option>
              ${hasCustom ? `<option value="custom" selected>🎵 カスタム音声</option>` : ''}
              <optgroup label="プリセット">
                ${presets.map(p => `<option value="preset:${p.id}"${currentMode === 'preset' && currentPresetId === p.id ? ' selected' : ''}>${p.label}</option>`).join('')}
              </optgroup>
            </select>
            <button class="rsc-sound-play-btn" data-type="${type}" title="試聴">▶</button>
            <button class="rsc-sound-upload-btn" data-type="${type}" title="カスタム音声をアップロード">📁</button>
            <input type="file" class="rsc-sound-file-input" data-type="${type}" accept="audio/*" style="display:none;">
          </div>
          ${hasCustom ? `
            <div class="rsc-sound-custom-info" data-type="${type}">
              <span class="rsc-sound-custom-name">🎵 ${customFileName}</span>
              <button class="rsc-sound-custom-delete" data-type="${type}" title="削除">✕</button>
            </div>
          ` : ''}
        </div>
      `;
    }

    // 通知音設定
    const notifCustom = settings.notifications?.soundPreset === 'custom';
    const notifFileName = settings.notifications?.customFileName || '';
    html += `
      <div class="rsc-sound-notification">
        <div class="rsc-sound-notification-title">🔔 ハンドサイン検出時の通知音</div>
        <div class="rsc-sound-item" data-type="notification">
          <div class="rsc-sound-select-row">
            <select class="rsc-sound-select" data-type="notification" id="rsc-notification-sound-select">
              ${notifCustom ? '<option value="custom" selected>🎵 カスタム音声</option>' : ''}
              ${renderNotificationOptions()}
            </select>
            <button class="rsc-sound-play-btn" data-type="notification" title="試聴">▶</button>
            <button class="rsc-sound-upload-btn" data-type="notification" title="カスタム音声をアップロード">📁</button>
            <input type="file" class="rsc-sound-file-input" data-type="notification" accept="audio/*" style="display:none;">
          </div>
          ${notifCustom && notifFileName ? `
            <div class="rsc-sound-custom-info" data-type="notification">
              <span class="rsc-sound-custom-name">🎵 ${notifFileName}</span>
              <button class="rsc-sound-custom-delete" data-type="notification" title="削除">✕</button>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // カウントダウン音設定
    const countdownPresets = presetSounds.countdown || [];
    const currentCountdown = settings.countdown?.soundPreset || 'countdown:countdown_button2';
    html += `
      <div class="rsc-sound-notification">
        <div class="rsc-sound-notification-title">⏱️ 撮影5秒前カウントダウン音</div>
        <div class="rsc-sound-item" data-type="countdown">
          <div class="rsc-sound-select-row">
            <select class="rsc-sound-select" data-type="countdown">
              ${countdownPresets.map(p => `<option value="countdown:${p.id}"${currentCountdown === `countdown:${p.id}` ? ' selected' : ''}>${p.label}</option>`).join('')}
            </select>
            <button class="rsc-sound-play-btn" data-type="countdown" title="試聴">▶</button>
          </div>
        </div>
      </div>
    `;

    content.innerHTML = html;

    // イベントハンドラー
    content.querySelectorAll('.rsc-sound-select').forEach(select => {
      select.addEventListener('change', handleSoundChange);
    });
    content.querySelectorAll('.rsc-sound-play-btn').forEach(btn => {
      btn.addEventListener('click', handleSoundPreview);
    });
    content.querySelectorAll('.rsc-sound-upload-btn').forEach(btn => {
      btn.addEventListener('click', handleSoundUploadClick);
    });
    content.querySelectorAll('.rsc-sound-file-input').forEach(input => {
      input.addEventListener('change', handleSoundFileSelect);
    });
    content.querySelectorAll('.rsc-sound-custom-delete').forEach(btn => {
      btn.addEventListener('click', handleSoundCustomDelete);
    });
  }

  /**
   * 通知音オプションをレンダリング
   */
  function renderNotificationOptions() {
    const currentPreset = settings.notifications?.soundPreset || 'outgoing:outgoing_horn';
    let options = '';

    const categoryLabels = {
      outgoing: '発信音',
      incoming: '着信音',
      disconnect: '切断音',
      doorchime: 'ドアチャイム'
    };

    for (const [category, sounds] of Object.entries(presetSounds || {})) {
      if (category === 'calling') continue; // 呼び出し音は通知には不向き
      const label = categoryLabels[category] || category;
      options += `<optgroup label="${label}">`;
      for (const sound of sounds) {
        const value = `${category}:${sound.id}`;
        const selected = currentPreset === value ? ' selected' : '';
        options += `<option value="${value}"${selected}>${sound.label}</option>`;
      }
      options += '</optgroup>';
    }

    return options;
  }

  /**
   * 音声変更ハンドラー
   */
  async function handleSoundChange(e) {
    const type = e.target.dataset.type;
    const value = e.target.value;

    try {
      if (type === 'notification') {
        // 通知音設定
        settings.notifications = settings.notifications || {};
        settings.notifications.soundPreset = value;
        await chrome.storage.local.set({ handSignSettings: settings });
        showTimerToast('通知音を変更しました');
      } else if (type === 'countdown') {
        // カウントダウン音設定
        settings.countdown = settings.countdown || {};
        settings.countdown.soundPreset = value;
        await chrome.storage.local.set({ handSignSettings: settings });
        showTimerToast('カウントダウン音を変更しました');
      } else {
        // 通常の音声設定
        if (value === 'original') {
          await chrome.runtime.sendMessage({ type: 'SET_ORIGINAL', id: type });
        } else if (value.startsWith('preset:')) {
          const presetId = value.replace('preset:', '');
          await chrome.runtime.sendMessage({ type: 'SET_PRESET', id: type, presetId });
        }

        // モード表示を更新
        const item = e.target.closest('.rsc-sound-item');
        const modeSpan = item.querySelector('.rsc-sound-item-mode');
        if (modeSpan) {
          modeSpan.textContent = value === 'original' ? 'オリジナル' : 'プリセット';
        }
        showTimerToast('音声を変更しました');
      }
    } catch (error) {
      console.error('[HandSign] Failed to change sound:', error);
      showTimerToast('音声の変更に失敗しました');
    }
  }

  /**
   * 試聴ハンドラー
   */
  async function handleSoundPreview(e) {
    const type = e.target.closest('.rsc-sound-play-btn').dataset.type;
    const select = soundSettingsModal.querySelector(`.rsc-sound-select[data-type="${type}"]`);
    const value = select.value;

    try {
      let soundUrl = null;

      if (type === 'notification' || type === 'countdown') {
        // 通知音・カウントダウン音
        const [category, presetId] = value.split(':');
        const presets = presetSounds[category];
        if (presets) {
          const preset = presets.find(p => p.id === presetId);
          if (preset && preset.file) {
            soundUrl = chrome.runtime.getURL(`sounds/${category}/${preset.file}`);
          } else if (preset && !preset.file) {
            // なし（無音）の場合
            showTimerToast('無音が設定されています');
            return;
          }
        }
      } else if (value === 'original') {
        showTimerToast('オリジナル音はRemowork上で再生されます');
        return;
      } else if (value.startsWith('preset:')) {
        const presetId = value.replace('preset:', '');
        const presets = presetSounds[type];
        if (presets) {
          const preset = presets.find(p => p.id === presetId);
          if (preset) {
            soundUrl = chrome.runtime.getURL(`sounds/${type}/${preset.file}`);
          }
        }
      }

      if (soundUrl) {
        const audio = new Audio(soundUrl);
        audio.volume = 0.7;
        await audio.play();
      } else if (value === 'custom') {
        // カスタム音声の試聴
        if (type === 'notification') {
          const result = await chrome.storage.local.get('notificationCustomSound');
          if (result.notificationCustomSound?.data) {
            const audio = new Audio(result.notificationCustomSound.data);
            audio.volume = 0.7;
            await audio.play();
          }
        } else {
          const result = await chrome.runtime.sendMessage({ type: 'GET_SOUND', id: type });
          if (result.success && result.data) {
            const audio = new Audio(result.data);
            audio.volume = 0.7;
            await audio.play();
          }
        }
      }
    } catch (error) {
      console.error('[HandSign] Failed to preview sound:', error);
    }
  }

  /**
   * アップロードボタンクリックハンドラー
   */
  function handleSoundUploadClick(e) {
    const type = e.target.closest('.rsc-sound-upload-btn').dataset.type;
    const fileInput = soundSettingsModal.querySelector(`.rsc-sound-file-input[data-type="${type}"]`);
    if (fileInput) {
      fileInput.click();
    }
  }

  /**
   * ファイル選択ハンドラー
   */
  async function handleSoundFileSelect(e) {
    const type = e.target.dataset.type;
    const file = e.target.files[0];
    if (!file) return;

    // ファイルサイズチェック
    const maxSize = type === 'notification' ? 10 * 1024 * 1024 : 300 * 1024 * 1024;
    if (file.size > maxSize) {
      showTimerToast(`ファイルサイズが大きすぎます（最大${type === 'notification' ? '10MB' : '300MB'}）`);
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = event.target.result;

        if (type === 'notification') {
          // 通知音カスタム
          await chrome.runtime.sendMessage({
            type: 'SAVE_NOTIFICATION_CUSTOM_SOUND',
            data: base64Data,
            fileName: file.name,
            mimeType: file.type
          });

          settings.notifications = settings.notifications || {};
          settings.notifications.soundPreset = 'custom';
          settings.notifications.customFileName = file.name;
          await chrome.storage.local.set({ handSignSettings: settings });
        } else {
          // 通常の音声カスタム
          await chrome.runtime.sendMessage({
            type: 'SAVE_SOUND',
            id: type,
            data: base64Data,
            fileName: file.name,
            mimeType: file.type
          });

          // soundSettingsも更新
          soundSettings.sounds = soundSettings.sounds || {};
          soundSettings.sounds[type] = {
            mode: 'custom',
            customFileName: file.name
          };
        }

        showTimerToast('カスタム音声を設定しました');

        // UIを再描画
        await loadSoundSettingsData();
        renderSoundSettings();
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('[HandSign] Failed to upload sound:', error);
      showTimerToast('アップロードに失敗しました');
    }

    // ファイル入力をリセット
    e.target.value = '';
  }

  /**
   * カスタム音声削除ハンドラー
   */
  async function handleSoundCustomDelete(e) {
    const type = e.target.closest('.rsc-sound-custom-delete').dataset.type;

    try {
      if (type === 'notification') {
        await chrome.runtime.sendMessage({ type: 'DELETE_NOTIFICATION_CUSTOM_SOUND' });

        settings.notifications = settings.notifications || {};
        settings.notifications.soundPreset = 'outgoing:outgoing_horn';
        settings.notifications.customFileName = null;
        await chrome.storage.local.set({ handSignSettings: settings });
      } else {
        await chrome.runtime.sendMessage({ type: 'DELETE_SOUND', id: type });

        soundSettings.sounds = soundSettings.sounds || {};
        soundSettings.sounds[type] = { mode: 'original' };
      }

      showTimerToast('カスタム音声を削除しました');

      // UIを再描画
      await loadSoundSettingsData();
      renderSoundSettings();
    } catch (error) {
      console.error('[HandSign] Failed to delete custom sound:', error);
    }
  }

  /**
   * ページ遷移を監視（SPA対応）
   */
  function watchPageNavigation() {
    let lastPath = window.location.pathname;
    let wasLoginPage = isLoginPage();

    // URL変更を監視
    const checkNavigation = () => {
      const currentPath = window.location.pathname;
      const currentlyLoginPage = isLoginPage();

      if (currentPath !== lastPath || currentlyLoginPage !== wasLoginPage) {
        lastPath = currentPath;

        if (currentlyLoginPage && !wasLoginPage) {
          // ログアウト: ログイン画面に遷移
          hideAllWidgets();
        } else if (!currentlyLoginPage && wasLoginPage) {
          // ログイン: ログイン画面から離脱
          // 少し待ってから初期化（DOMが構築されるのを待つ）
          setTimeout(() => {
            if (!timerElement) {
              init();
            } else {
              showAllWidgets();
            }
          }, 1000);
        }

        wasLoginPage = currentlyLoginPage;
      }
    };

    // popstate（ブラウザの戻る/進む）
    window.addEventListener('popstate', checkNavigation);

    // History APIのpushState/replaceStateを監視
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      setTimeout(checkNavigation, 100);
    };

    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      setTimeout(checkNavigation, 100);
    };

    // 定期チェック（フォールバック）
    setInterval(checkNavigation, 2000);
  }

  // ページ読み込み完了後に初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      watchPageNavigation();
    });
  } else {
    init();
    watchPageNavigation();
  }
})();
