/**
 * Remowork Sound Changer - Inject Script
 * ページコンテキストで実行され、Howler.js と Audio オブジェクトをオーバーライド
 */

(function() {
  'use strict';

  // 二重実行防止
  if (window.__remoworkSoundChangerInjected) return;
  window.__remoworkSoundChangerInjected = true;

  // 設定を取得（CSP対応: data属性から読み取り）
  let config = { enabled: false, sounds: {} };
  const configElement = document.getElementById('__remoworkSoundConfig');
  if (configElement && configElement.dataset.config) {
    try {
      config = JSON.parse(configElement.dataset.config);
    } catch (e) {
      console.error('[RemoworkSoundChanger] Failed to parse config:', e);
    }
  }

  if (!config.enabled) {
    console.log('[RemoworkSoundChanger] Disabled');
    return;
  }

  console.log('[RemoworkSoundChanger] Initializing with config:', config);

  // 対象パスのマッピング（複数パス対応）
  const pathToId = {};
  for (const [id, soundConfig] of Object.entries(config.sounds)) {
    // メインパス
    if (soundConfig.path) {
      pathToId[soundConfig.path] = id;
      console.log(`[RemoworkSoundChanger] Mapping ${soundConfig.path} -> ${id}`);
    }
    // 追加パス（paths配列がある場合）
    if (soundConfig.paths && Array.isArray(soundConfig.paths)) {
      for (const path of soundConfig.paths) {
        pathToId[path] = id;
        console.log(`[RemoworkSoundChanger] Mapping ${path} -> ${id}`);
      }
    }
  }

  // カスタム音声のキャッシュ（Blob URL）
  const customSoundCache = {};

  /**
   * URLから対象音声IDを取得
   */
  function getSoundIdFromUrl(url) {
    if (!url) return null;

    // 配列の場合は最初の要素を使用
    const urlStr = Array.isArray(url) ? url[0] : url;
    if (typeof urlStr !== 'string') return null;

    try {
      const urlObj = new URL(urlStr, window.location.origin);
      const pathname = urlObj.pathname;

      for (const [path, id] of Object.entries(pathToId)) {
        if (pathname.endsWith(path) || pathname === path) {
          return id;
        }
      }
    } catch (e) {
      // パースエラーは無視
    }

    return null;
  }

  /**
   * 拡張機能のベースURLを取得
   */
  function getExtensionBaseUrl() {
    const scripts = document.getElementsByTagName('script');
    for (const script of scripts) {
      if (script.src && script.src.includes('inject.js')) {
        return script.src.replace('inject.js', '');
      }
    }
    return null;
  }

  const extensionBaseUrl = getExtensionBaseUrl();

  /**
   * カスタム音声のURLを取得
   */
  function getCustomSoundUrl(soundId) {
    const soundConfig = config.sounds[soundId];
    if (!soundConfig) return null;

    // カスタム音声（Base64データ）
    if (soundConfig.mode === 'custom' && soundConfig.customData) {
      if (!customSoundCache[soundId]) {
        customSoundCache[soundId] = soundConfig.customData;
      }
      return customSoundCache[soundId];
    }

    // プリセット音声（拡張機能内のファイル）
    if (soundConfig.mode === 'preset' && soundConfig.presetFile && extensionBaseUrl) {
      // soundId からカテゴリを取得（例: doorchime -> doorchime）
      const category = soundId;
      const presetUrl = `${extensionBaseUrl}sounds/${category}/${encodeURIComponent(soundConfig.presetFile)}`;
      console.log(`[RemoworkSoundChanger] Preset URL: ${presetUrl}`);
      return presetUrl;
    }

    return null;
  }

  // オリジナルの Audio コンストラクタを保存
  const OriginalAudio = window.Audio;

  /**
   * Audio コンストラクタをオーバーライド
   */
  window.Audio = function(src) {
    const soundId = getSoundIdFromUrl(src);

    if (soundId) {
      const customUrl = getCustomSoundUrl(soundId);
      if (customUrl) {
        console.log(`[RemoworkSoundChanger] Audio() intercepted for ${soundId}`);
        return new OriginalAudio(customUrl);
      }
    }

    return new OriginalAudio(src);
  };
  window.Audio.prototype = OriginalAudio.prototype;

  /**
   * HTMLAudioElement の src プロパティをオーバーライド
   */
  const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');

  Object.defineProperty(HTMLMediaElement.prototype, 'src', {
    get: function() {
      return originalSrcDescriptor.get.call(this);
    },
    set: function(value) {
      const soundId = getSoundIdFromUrl(value);

      if (soundId && this instanceof HTMLAudioElement) {
        const customUrl = getCustomSoundUrl(soundId);
        if (customUrl) {
          console.log(`[RemoworkSoundChanger] src setter intercepted for ${soundId}`);
          return originalSrcDescriptor.set.call(this, customUrl);
        }
      }

      return originalSrcDescriptor.set.call(this, value);
    },
    enumerable: true,
    configurable: true
  });

  /**
   * Howler.js の Howl コンストラクタをオーバーライド
   * Howler.js は Web Audio API を使用するため、src を差し替える必要がある
   */
  function interceptHowler() {
    if (typeof window.Howl === 'undefined') {
      return false;
    }

    const OriginalHowl = window.Howl;

    window.Howl = function(options) {
      if (options && options.src) {
        const srcArray = Array.isArray(options.src) ? options.src : [options.src];
        const soundId = getSoundIdFromUrl(srcArray[0]);

        if (soundId) {
          const customUrl = getCustomSoundUrl(soundId);
          if (customUrl) {
            console.log(`[RemoworkSoundChanger] Howl() intercepted for ${soundId}`);
            // カスタムURLに置き換え
            options = Object.assign({}, options, {
              src: [customUrl],
              format: ['mp3', 'wav', 'ogg', 'webm'] // Base64データURLをサポート
            });
          }
        }
      }

      return new OriginalHowl(options);
    };

    // プロトタイプとスタティックプロパティを継承
    window.Howl.prototype = OriginalHowl.prototype;
    Object.keys(OriginalHowl).forEach(key => {
      if (OriginalHowl.hasOwnProperty(key)) {
        window.Howl[key] = OriginalHowl[key];
      }
    });

    console.log('[RemoworkSoundChanger] Howler.js intercepted');
    return true;
  }

  // Howler.js がロードされるのを待つ
  if (!interceptHowler()) {
    // Howler.js がまだロードされていない場合は監視
    let attempts = 0;
    const maxAttempts = 50; // 5秒間監視
    const checkInterval = setInterval(() => {
      attempts++;
      if (interceptHowler() || attempts >= maxAttempts) {
        clearInterval(checkInterval);
        if (attempts >= maxAttempts) {
          console.log('[RemoworkSoundChanger] Howler.js not found, using Audio interception only');
        }
      }
    }, 100);
  }

  /**
   * XMLHttpRequest もオーバーライド（Howler.js が音声をロードする際に使用）
   */
  const OriginalXHR = window.XMLHttpRequest;

  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open;

    xhr.open = function(method, url, ...args) {
      const soundId = getSoundIdFromUrl(url);

      if (soundId) {
        const customUrl = getCustomSoundUrl(soundId);
        if (customUrl) {
          console.log(`[RemoworkSoundChanger] XHR intercepted for ${soundId}`);
          return originalOpen.call(this, method, customUrl, ...args);
        }
      }

      return originalOpen.call(this, method, url, ...args);
    };

    return xhr;
  };
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;

  /**
   * fetch もオーバーライド
   */
  const originalFetch = window.fetch;

  window.fetch = function(input, init) {
    let url = typeof input === 'string' ? input : (input instanceof Request ? input.url : null);

    if (url) {
      const soundId = getSoundIdFromUrl(url);

      if (soundId) {
        const customUrl = getCustomSoundUrl(soundId);
        if (customUrl) {
          console.log(`[RemoworkSoundChanger] fetch intercepted for ${soundId}`);
          // Base64 data URL の場合は直接 Response を返す
          if (customUrl.startsWith('data:')) {
            return fetch(customUrl);
          }
          input = customUrl;
        }
      }
    }

    return originalFetch.call(this, input, init);
  };

  /**
   * 設定変更をリアルタイムで受信
   */
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.source !== 'remowork-sound-changer-content') return;

    if (event.data.type === 'CONFIG_UPDATED' && event.data.config) {
      console.log('[RemoworkSoundChanger] Config updated:', event.data.config);

      // 設定を更新
      Object.assign(config, event.data.config);

      // パスマッピングを再構築（複数パス対応）
      Object.keys(pathToId).forEach(key => delete pathToId[key]);
      for (const [id, soundConfig] of Object.entries(config.sounds)) {
        // メインパス
        if (soundConfig.path) {
          pathToId[soundConfig.path] = id;
        }
        // 追加パス（paths配列がある場合）
        if (soundConfig.paths && Array.isArray(soundConfig.paths)) {
          for (const path of soundConfig.paths) {
            pathToId[path] = id;
          }
        }
      }

      // キャッシュをクリア
      Object.keys(customSoundCache).forEach(key => delete customSoundCache[key]);

      console.log('[RemoworkSoundChanger] Config reloaded - changes will apply to new audio requests');
    }
  });

  console.log('[RemoworkSoundChanger] Ready - Intercepting Howler.js, Audio, XHR, and fetch');
})();
