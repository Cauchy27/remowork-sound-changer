/**
 * Remowork Sound Changer - Popup Script
 * 設定UIのロジック
 */

const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB
const MAX_DURATION_SECONDS = 10 * 60; // 10分

const SOUND_LABELS = {
  calling: '発信中（呼び出し音）',
  incoming: '着信音',
  outgoing: '発信音',
  disconnect: '切断音',
  doorchime: 'ドアチャイム'
};

const SOUND_DESCRIPTIONS = {
  calling: '相手を呼び出し中に鳴る音',
  incoming: '電話がかかってきた時に鳴る音',
  outgoing: '発信ボタンを押した時に鳴る音',
  disconnect: '通話が終了・切断された時に鳴る音',
  doorchime: '内線着信時に鳴る音'
};

const MODE_LABELS = {
  original: 'オリジナル',
  custom: 'カスタム'
};

// Chrome拡張機能として動作しているかチェック
const isExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage;

// デモ用のデフォルトデータ
const DEFAULT_SOUND_TYPES = {
  calling: { path: '/client/calling.mp3', label: '発信中（呼び出し音）' },
  incoming: { path: '/client/incoming.mp3', label: '着信音' },
  outgoing: { path: '/client/outgoing.mp3', label: '発信音' },
  disconnect: { path: '/client/disconnect.mp3', label: '切断音' },
  doorchime: { path: '/client/doorchime.mp3', label: 'ドアチャイム' }
};

let soundTypes = {};
let presetSounds = {};
let settings = { enabled: true, sounds: {} };
let savedSounds = [];
let previewAudio = null;
let currentPlayingId = null;

// ハンドサイン設定
let handSignSettings = {
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

// LLM設定
let llmSettings = {
  enabled: false,
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  apiKey: '',
  customEndpoint: '',
  autoStructure: true,
  extractActions: true,
  extractDecisions: true,
  profile: {
    name: '',
    company: '',
    role: '',
    context: ''
  }
};

// Whisper設定（相手の声の文字起こし用）
let whisperSettings = {
  enabled: false,
  apiKey: '',
  language: 'ja'
};

// 統計設定
let statsSettings = {
  enabled: true,
  lastSentAt: null
};

// LLMモデルの定義
const LLM_MODELS = {
  gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash（推奨）' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite（軽量・最安）' },
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash（高性能・高コスト）' }
  ],
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini（推奨）' },
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
  ],
  claude: [
    { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4（推奨）' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku（高速）' },
    { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' }
  ],
  custom: [
    { id: 'custom', name: 'カスタムモデル' }
  ]
};

/**
 * 初期化
 */
document.addEventListener('DOMContentLoaded', async () => {
  previewAudio = document.getElementById('preview-audio');

  if (isExtension) {
    try {
      // 音声タイプを取得
      const typesResponse = await sendMessage({ type: 'GET_SOUND_TYPES' });
      console.log('[Popup] typesResponse:', typesResponse);
      if (typesResponse && typesResponse.success && typesResponse.data) {
        soundTypes = typesResponse.data;
      } else {
        // フォールバック: デフォルト値を使用
        soundTypes = DEFAULT_SOUND_TYPES;
      }

      // 設定を取得
      const settingsResponse = await sendMessage({ type: 'GET_SETTINGS' });
      console.log('[Popup] settingsResponse:', settingsResponse);
      if (settingsResponse && settingsResponse.success && settingsResponse.data) {
        settings = settingsResponse.data;
      }

      // 保存済み音声を取得
      const soundsResponse = await sendMessage({ type: 'GET_ALL_SOUNDS' });
      console.log('[Popup] soundsResponse:', soundsResponse);
      if (soundsResponse && soundsResponse.success && soundsResponse.data) {
        savedSounds = soundsResponse.data;
      }

      // プリセット音声を取得
      const presetsResponse = await sendMessage({ type: 'GET_PRESET_SOUNDS' });
      console.log('[Popup] presetsResponse:', presetsResponse);
      if (presetsResponse && presetsResponse.success && presetsResponse.data) {
        presetSounds = presetsResponse.data;
      }
    } catch (error) {
      console.error('[Popup] Error loading data:', error);
      // エラー時はデフォルト値を使用
      soundTypes = DEFAULT_SOUND_TYPES;
    }
  } else {
    // デモモード（ブラウザで直接開いた場合）
    soundTypes = DEFAULT_SOUND_TYPES;
    console.log('[Demo Mode] Chrome拡張機能としてインストールしてください');
  }

  console.log('[Popup] soundTypes:', soundTypes);
  console.log('[Popup] settings:', settings);

  // ハンドサイン設定を読み込む
  if (isExtension) {
    try {
      const handSignResponse = await sendMessage({ type: 'GET_HAND_SIGN_SETTINGS' });
      console.log('[Popup] handSignResponse:', handSignResponse);
      if (handSignResponse && handSignResponse.success && handSignResponse.data) {
        handSignSettings = { ...handSignSettings, ...handSignResponse.data };
      }
    } catch (error) {
      console.error('[Popup] Error loading hand sign settings:', error);
    }
  }

  // LLM設定を読み込む
  if (isExtension) {
    try {
      const llmResponse = await sendMessage({ type: 'GET_LLM_SETTINGS' });
      console.log('[Popup] llmResponse:', llmResponse);
      if (llmResponse && llmResponse.success && llmResponse.data) {
        llmSettings = { ...llmSettings, ...llmResponse.data };
      }
    } catch (error) {
      console.error('[Popup] Error loading LLM settings:', error);
    }
  }

  // Whisper設定を読み込む
  if (isExtension) {
    try {
      const whisperResponse = await sendMessage({ type: 'GET_WHISPER_SETTINGS' });
      console.log('[Popup] whisperResponse:', whisperResponse);
      if (whisperResponse && whisperResponse.success && whisperResponse.data) {
        whisperSettings = { ...whisperSettings, ...whisperResponse.data };
      }
    } catch (error) {
      console.error('[Popup] Error loading Whisper settings:', error);
    }
  }

  // 統計設定を読み込む
  if (isExtension) {
    try {
      const statsResponse = await sendMessage({ type: 'GET_STATS_SETTINGS' });
      console.log('[Popup] statsResponse:', statsResponse);
      if (statsResponse && statsResponse.success && statsResponse.data) {
        statsSettings = { ...statsSettings, ...statsResponse.data };
      }
    } catch (error) {
      console.error('[Popup] Error loading stats settings:', error);
    }
  }

  // UIを構築
  renderSoundList();
  setupEventListeners();
  setupTabNavigation();
  await setupHandSignSettings();
  setupVirtualCamera();
  setupLLMSettings();
  setupWhisperSettings();
  setupStatsSettings();

  // 有効/無効トグルの初期状態
  document.getElementById('enabled-toggle').checked = settings.enabled !== false;

  // ポップアップを開いた統計を記録
  recordUiClick('popup_open');
});

/**
 * 音声リストをレンダリング
 */
function renderSoundList() {
  const container = document.getElementById('sound-list');
  const template = document.getElementById('sound-item-template');

  container.innerHTML = '';

  for (const [id, typeInfo] of Object.entries(soundTypes)) {
    const clone = template.content.cloneNode(true);
    const item = clone.querySelector('.sound-item');

    item.dataset.id = id;
    item.querySelector('.sound-label').textContent = SOUND_LABELS[id] || typeInfo.label;
    item.querySelector('.sound-description').textContent = SOUND_DESCRIPTIONS[id] || '';

    // モード選択にプリセット音声を追加
    const modeSelect = item.querySelector('.sound-mode');

    // プリセット音声をドロップダウンに追加
    const presets = presetSounds[id] || [];
    if (presets.length > 0) {
      // プリセットグループを追加（customの前に挿入）
      const customOption = modeSelect.querySelector('option[value="custom"]');

      // セパレーター
      const separator = document.createElement('option');
      separator.disabled = true;
      separator.textContent = '── プリセット ──';
      modeSelect.insertBefore(separator, customOption);

      // 各プリセット音声
      for (const preset of presets) {
        const option = document.createElement('option');
        option.value = `preset:${preset.id}`;
        option.textContent = preset.label;
        modeSelect.insertBefore(option, customOption);
      }

      // カスタムの前にセパレーター
      const separator2 = document.createElement('option');
      separator2.disabled = true;
      separator2.textContent = '── カスタム ──';
      modeSelect.insertBefore(separator2, customOption);
    }

    // 現在の設定値を反映
    const currentMode = settings.sounds?.[id]?.mode || 'original';
    const currentPreset = settings.sounds?.[id]?.presetId || null;

    if (currentMode === 'preset' && currentPreset) {
      modeSelect.value = `preset:${currentPreset}`;
    } else {
      modeSelect.value = currentMode;
    }

    // ステータス表示
    updateStatusBadge(item, currentMode, currentPreset);

    // ファイル情報（カスタムモードの場合、または保存済み音声がある場合）
    const savedSound = savedSounds.find(s => s.id === id);
    const fileInfo = item.querySelector('.sound-file-info');
    if (savedSound) {
      if (currentMode === 'custom') {
        fileInfo.textContent = savedSound.fileName || 'カスタム音声';
      } else {
        // オリジナルモードでもカスタム音声があることを表示
        fileInfo.textContent = `(保存済み: ${savedSound.fileName || 'カスタム音声'})`;
        fileInfo.style.opacity = '0.6';
      }
    }

    container.appendChild(clone);
  }
}

/**
 * ステータスバッジを更新
 */
function updateStatusBadge(item, mode, presetId = null) {
  const badge = item.querySelector('.sound-status');

  if (mode === 'preset' && presetId) {
    // プリセットの場合はプリセット名を表示
    const soundId = item.dataset.id;
    const preset = (presetSounds[soundId] || []).find(p => p.id === presetId);
    badge.textContent = preset ? preset.label : 'プリセット';
    badge.className = 'sound-status preset';
  } else {
    badge.textContent = MODE_LABELS[mode] || mode;
    badge.className = `sound-status ${mode}`;
  }
}

/**
 * イベントリスナーを設定
 */
function setupEventListeners() {
  // 有効/無効トグル
  document.getElementById('enabled-toggle').addEventListener('change', async (e) => {
    settings.enabled = e.target.checked;
    if (isExtension) {
      await sendMessage({ type: 'SAVE_SETTINGS', settings });
    }
    showToast(settings.enabled ? '有効化しました' : '無効化しました');
  });

  // 音声リスト内のイベント（イベント委譲）
  document.getElementById('sound-list').addEventListener('change', handleSoundListChange);
  document.getElementById('sound-list').addEventListener('click', handleSoundListClick);
}

/**
 * 音声リストの変更イベント
 */
async function handleSoundListChange(e) {
  const target = e.target;
  const item = target.closest('.sound-item');
  if (!item) return;

  const soundId = item.dataset.id;

  // モード変更
  if (target.classList.contains('sound-mode')) {
    const mode = target.value;
    await handleModeChange(soundId, mode, item);
  }

  // ファイルアップロード
  if (target.type === 'file' && target.files.length > 0) {
    await handleFileUpload(soundId, target.files[0], item);
    target.value = ''; // リセット
  }
}

/**
 * 他の音声タイプで使用中のプリセットを取得
 */
function getUsedPresets(excludeSoundId = null) {
  const used = new Map(); // presetLabel -> soundType

  for (const [id, soundSetting] of Object.entries(settings.sounds || {})) {
    if (id === excludeSoundId) continue;
    if (soundSetting.mode === 'preset' && soundSetting.presetId) {
      // プリセットのラベル（ファイル名）を取得
      const presets = presetSounds[id] || [];
      const preset = presets.find(p => p.id === soundSetting.presetId);
      if (preset) {
        used.set(preset.file, SOUND_LABELS[id] || id);
      }
    }
  }

  return used;
}

/**
 * プリセットが他で使用中かチェック
 */
function isPresetUsedElsewhere(presetId, soundId) {
  const usedPresets = getUsedPresets(soundId);

  // このプリセットのファイル名を取得
  const presets = presetSounds[soundId] || [];
  const preset = presets.find(p => p.id === presetId);
  if (!preset) return null;

  // 同じファイル名が他で使われているかチェック
  if (usedPresets.has(preset.file)) {
    return usedPresets.get(preset.file);
  }

  return null;
}

/**
 * モード変更の処理
 */
async function handleModeChange(soundId, mode, item) {
  // 該当の音声が再生中なら停止
  if (currentPlayingId === soundId) {
    stopPlayback();
  }

  item.classList.add('loading');

  try {
    // preset:xxx 形式かチェック
    if (mode.startsWith('preset:')) {
      const presetId = mode.replace('preset:', '');

      // 重複チェック
      const usedIn = isPresetUsedElsewhere(presetId, soundId);
      if (usedIn) {
        const preset = (presetSounds[soundId] || []).find(p => p.id === presetId);
        showToast(`「${preset?.label || 'この音声'}」は「${usedIn}」で使用中です`, 'error');
        // 元の値に戻す
        const currentMode = settings.sounds?.[soundId]?.mode || 'original';
        const currentPreset = settings.sounds?.[soundId]?.presetId || null;
        if (currentMode === 'preset' && currentPreset) {
          item.querySelector('.sound-mode').value = `preset:${currentPreset}`;
        } else {
          item.querySelector('.sound-mode').value = currentMode;
        }
        item.classList.remove('loading');
        return;
      }

      if (isExtension) {
        await sendMessage({ type: 'SET_PRESET', id: soundId, presetId });
      }

      // 設定を更新
      if (!settings.sounds) settings.sounds = {};
      if (!settings.sounds[soundId]) settings.sounds[soundId] = {};
      settings.sounds[soundId].mode = 'preset';
      settings.sounds[soundId].presetId = presetId;

      item.querySelector('.sound-file-info').textContent = '';
      updateStatusBadge(item, 'preset', presetId);

      const preset = (presetSounds[soundId] || []).find(p => p.id === presetId);
      showToast(`${preset?.label || 'プリセット'}に変更しました`, 'success');
    } else if (mode === 'original') {
      if (isExtension) {
        await sendMessage({ type: 'SET_ORIGINAL', id: soundId });
      }

      // 設定を更新
      if (!settings.sounds) settings.sounds = {};
      if (!settings.sounds[soundId]) settings.sounds[soundId] = {};
      settings.sounds[soundId].mode = 'original';
      delete settings.sounds[soundId].presetId;

      item.querySelector('.sound-file-info').textContent = '';
      updateStatusBadge(item, mode);
      showToast('オリジナル音声に戻しました', 'success');
    } else if (mode === 'custom') {
      // カスタムの場合は既存のカスタム音声があるか確認
      let hasCustomSound = false;

      if (isExtension) {
        const soundResponse = await sendMessage({ type: 'GET_SOUND', id: soundId });
        hasCustomSound = soundResponse && soundResponse.data;
        if (hasCustomSound) {
          item.querySelector('.sound-file-info').textContent = soundResponse.data.fileName || 'カスタム音声';
        }
      }

      if (!hasCustomSound) {
        // カスタム音声がない場合はファイル選択を促す
        showToast('音声ファイルをアップロードしてください', 'info');
        item.querySelector('input[type="file"]').click();
        // モードを元に戻す
        item.querySelector('.sound-mode').value = 'original';
        return;
      }

      updateStatusBadge(item, mode);
      showToast('カスタム音声に変更しました', 'success');
    }
  } catch (error) {
    showToast('エラーが発生しました: ' + error.message, 'error');
  } finally {
    item.classList.remove('loading');
  }
}

/**
 * ファイルアップロードの処理
 */
async function handleFileUpload(soundId, file, item) {
  // サイズチェック
  if (file.size > MAX_FILE_SIZE) {
    showToast('ファイルサイズが300MBを超えています', 'error');
    return;
  }

  // 音声ファイルかチェック
  if (!file.type.startsWith('audio/')) {
    showToast('音声ファイルを選択してください', 'error');
    return;
  }

  // 音声の長さをチェック
  try {
    const duration = await getAudioDuration(file);
    if (duration > MAX_DURATION_SECONDS) {
      showToast('音声の長さは10分以内にしてください', 'error');
      return;
    }
  } catch (e) {
    console.warn('Duration check failed:', e);
  }

  item.classList.add('loading');

  try {
    // Base64に変換
    const data = await fileToBase64(file);

    if (isExtension) {
      // 保存
      const response = await sendMessage({
        type: 'SAVE_SOUND',
        id: soundId,
        data: data,
        fileName: file.name,
        mimeType: file.type
      });

      if (!response || !response.success) {
        throw new Error(response?.error || '保存に失敗しました');
      }
    }

    // UI更新
    item.querySelector('.sound-mode').value = 'custom';
    updateStatusBadge(item, 'custom');
    item.querySelector('.sound-file-info').textContent = file.name;

    showToast('音声を保存しました', 'success');
  } catch (error) {
    showToast('アップロードに失敗しました: ' + error.message, 'error');
  } finally {
    item.classList.remove('loading');
  }
}

/**
 * 音声リストのクリックイベント
 */
async function handleSoundListClick(e) {
  const target = e.target.closest('button');
  if (!target) return;

  const item = target.closest('.sound-item');
  if (!item) return;

  const soundId = item.dataset.id;

  // 再生ボタン
  if (target.classList.contains('btn-play')) {
    await handlePlayClick(soundId, target, item);
  }
}

/**
 * 再生を停止する共通関数
 */
function stopPlayback() {
  if (!previewAudio) return;

  // イベントハンドラをクリア（前の音声の終了イベントが発火しないように）
  previewAudio.onended = null;
  previewAudio.onerror = null;

  previewAudio.pause();
  previewAudio.currentTime = 0;
  previewAudio.src = ''; // 現在のソースをクリア

  if (currentPlayingId) {
    const prevButton = document.querySelector(`.sound-item[data-id="${currentPlayingId}"] .btn-play`);
    if (prevButton) {
      updatePlayButtonState(prevButton, false);
    }
    currentPlayingId = null;
  }
}

/**
 * 再生ボタンの状態を更新
 */
function updatePlayButtonState(button, isPlaying) {
  const iconPlay = button.querySelector('.icon-play');
  const iconStop = button.querySelector('.icon-stop');

  if (isPlaying) {
    button.classList.add('playing');
    button.title = '停止';
    if (iconPlay) iconPlay.style.display = 'none';
    if (iconStop) iconStop.style.display = 'block';
  } else {
    button.classList.remove('playing');
    button.title = '再生';
    if (iconPlay) iconPlay.style.display = 'block';
    if (iconStop) iconStop.style.display = 'none';
  }
}

/**
 * 再生ボタンのクリック処理
 */
async function handlePlayClick(soundId, button, item) {
  // 再生中なら停止
  if (currentPlayingId === soundId) {
    stopPlayback();
    return;
  }

  // 他の再生を停止
  stopPlayback();

  const modeValue = item.querySelector('.sound-mode').value;
  let audioUrl = null;

  try {
    if (modeValue === 'original') {
      showToast('オリジナル音声はRemoworkサイトで再生されます', 'info');
      return;
    }

    // プリセット音声
    if (modeValue.startsWith('preset:')) {
      const presetId = modeValue.replace('preset:', '');
      const presets = presetSounds[soundId] || [];
      const preset = presets.find(p => p.id === presetId);

      if (preset) {
        // 拡張機能内のプリセット音声を再生
        audioUrl = chrome.runtime.getURL(`sounds/${soundId}/${preset.file}`);
      } else {
        showToast('プリセット音声が見つかりません');
        return;
      }
    }

    // カスタム音声
    if (modeValue === 'custom') {
      if (isExtension) {
        const soundResponse = await sendMessage({ type: 'GET_SOUND', id: soundId });
        if (soundResponse && soundResponse.data && soundResponse.data.data) {
          audioUrl = soundResponse.data.data;
        } else {
          showToast('カスタム音声が設定されていません');
          return;
        }
      } else {
        showToast('デモモードでは再生できません');
        return;
      }
    }

    if (audioUrl) {
      previewAudio.src = audioUrl;
      previewAudio.play();
      updatePlayButtonState(button, true);
      currentPlayingId = soundId;

      previewAudio.onended = () => {
        updatePlayButtonState(button, false);
        currentPlayingId = null;
      };

      previewAudio.onerror = () => {
        updatePlayButtonState(button, false);
        currentPlayingId = null;
        showToast('再生に失敗しました', 'error');
      };
    }
  } catch (error) {
    showToast('再生に失敗しました', 'error');
  }
}

/**
 * ファイルをBase64に変換
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 音声ファイルの長さを取得（秒）
 */
function getAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.onloadedmetadata = () => {
      resolve(audio.duration);
      URL.revokeObjectURL(audio.src);
    };
    audio.onerror = () => {
      reject(new Error('Failed to load audio'));
      URL.revokeObjectURL(audio.src);
    };
    audio.src = URL.createObjectURL(file);
  });
}

/**
 * Background Scriptにメッセージを送信
 */
function sendMessage(message) {
  return new Promise((resolve) => {
    if (!isExtension) {
      resolve({ success: false, error: 'Not running as extension' });
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        // chrome.runtime.lastError をチェック
        if (chrome.runtime.lastError) {
          console.error('[Popup] sendMessage error:', chrome.runtime.lastError.message);
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    } catch (error) {
      console.error('[Popup] sendMessage exception:', error);
      resolve({ success: false, error: error.message });
    }
  });
}

/**
 * トースト通知を表示
 */
function showToast(message, type = 'info') {
  // 既存のトーストを削除
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

/**
 * タブナビゲーションを設定
 */
function setupTabNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  // タブ名と統計キーのマッピング
  const tabStatKeys = {
    'sound': 'tab_sound',
    'handsign': 'tab_handSign',
    'virtual-camera': 'tab_virtualCamera',
    'llm': 'tab_llm',
    'settings': 'tab_settings'
  };

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;

      // ボタンのアクティブ状態を更新
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // コンテンツの表示を切り替え
      tabContents.forEach(content => {
        if (content.id === `tab-${tabId}`) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });

      // タブクリックを統計に記録
      const statKey = tabStatKeys[tabId];
      if (statKey) {
        recordUiClick(statKey);
      }
    });
  });
}

/**
 * ハンドサイン設定を初期化
 */
async function setupHandSignSettings() {
  // 有効/無効トグル
  const enabledToggle = document.getElementById('handsign-enabled-toggle');
  if (enabledToggle) {
    enabledToggle.checked = handSignSettings.enabled !== false;
    enabledToggle.addEventListener('change', async (e) => {
      handSignSettings.enabled = e.target.checked;
      await saveHandSignSettings();
      showToast(handSignSettings.enabled ? 'ハンドサイン検出を有効化しました' : 'ハンドサイン検出を無効化しました');
    });
  }

  // 自分の名前
  const myNameInput = document.getElementById('handsign-myname');
  if (myNameInput) {
    myNameInput.value = handSignSettings.myName || '';
    myNameInput.addEventListener('blur', async () => {
      handSignSettings.myName = myNameInput.value.trim();
      await saveHandSignSettings();
    });
  }

  // 検出対象（全員/選択）
  const detectTargetRadios = document.querySelectorAll('input[name="detect-target"]');
  detectTargetRadios.forEach(radio => {
    if (radio.value === 'all') {
      radio.checked = handSignSettings.detectAll !== false;
    } else {
      radio.checked = handSignSettings.detectAll === false;
    }

    radio.addEventListener('change', async () => {
      handSignSettings.detectAll = document.querySelector('input[name="detect-target"]:checked').value === 'all';
      const memberList = document.getElementById('member-list');
      if (memberList) {
        memberList.style.display = handSignSettings.detectAll ? 'none' : 'block';
      }
      await saveHandSignSettings();
    });
  });

  // メンバーリストの表示/非表示
  const memberList = document.getElementById('member-list');
  if (memberList) {
    memberList.style.display = handSignSettings.detectAll ? 'none' : 'block';
  }

  // トースト通知
  const toastCheckbox = document.getElementById('handsign-toast');
  if (toastCheckbox) {
    toastCheckbox.checked = handSignSettings.notifications?.toast !== false;
    toastCheckbox.addEventListener('change', async () => {
      handSignSettings.notifications = handSignSettings.notifications || {};
      handSignSettings.notifications.toast = toastCheckbox.checked;
      await saveHandSignSettings();
    });
  }

  // 通知音
  const soundCheckbox = document.getElementById('handsign-sound');
  if (soundCheckbox) {
    soundCheckbox.checked = handSignSettings.notifications?.sound !== false;
    soundCheckbox.addEventListener('change', async () => {
      handSignSettings.notifications = handSignSettings.notifications || {};
      handSignSettings.notifications.sound = soundCheckbox.checked;
      await saveHandSignSettings();
    });
  }

  // 通知音プリセット - 全音声からプルダウン生成
  const soundPresetSelect = document.getElementById('handsign-sound-preset');
  if (soundPresetSelect) {
    await populateHandSignSoundOptions(soundPresetSelect);
    soundPresetSelect.value = handSignSettings.notifications?.soundPreset || 'outgoing:outgoing_horn';
    soundPresetSelect.addEventListener('change', async () => {
      handSignSettings.notifications = handSignSettings.notifications || {};
      handSignSettings.notifications.soundPreset = soundPresetSelect.value;

      // カスタム以外の場合はカスタムデータをクリア
      if (!soundPresetSelect.value.startsWith('custom:')) {
        handSignSettings.notifications.customSoundData = null;
        handSignSettings.notifications.customSoundFileName = null;
        document.getElementById('handsign-custom-file-info').textContent = '';
      }

      await saveHandSignSettings();
    });
  }

  // テスト再生ボタン
  const testSoundBtn = document.getElementById('test-handsign-sound');
  if (testSoundBtn) {
    testSoundBtn.addEventListener('click', async () => {
      const soundValue = handSignSettings.notifications?.soundPreset || 'outgoing:outgoing_horn';
      await playHandSignTestSound(soundValue);
    });
  }

  // カスタムアップロード
  const customUpload = document.getElementById('handsign-custom-upload');
  if (customUpload) {
    customUpload.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        await handleHandSignCustomUpload(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  // カスタム音声があれば表示
  if (handSignSettings.notifications?.customSoundFileName) {
    document.getElementById('handsign-custom-file-info').textContent =
      `カスタム: ${handSignSettings.notifications.customSoundFileName}`;
  }
}

/**
 * ハンドサイン通知音のプルダウンを生成
 */
async function populateHandSignSoundOptions(selectElement) {
  selectElement.innerHTML = '';

  // プリセット音声を取得
  if (isExtension) {
    try {
      const response = await sendMessage({ type: 'GET_PRESET_SOUNDS' });
      if (response.success && response.data) {
        const categoryLabels = {
          doorchime: 'ドアチャイム',
          incoming: '着信音',
          outgoing: '発信音',
          disconnect: '切断音',
          calling: '呼び出し音'
        };

        for (const [category, sounds] of Object.entries(response.data)) {
          const optgroup = document.createElement('optgroup');
          optgroup.label = categoryLabels[category] || category;

          for (const sound of sounds) {
            const option = document.createElement('option');
            option.value = `${category}:${sound.id}`;
            option.textContent = sound.label;
            // デフォルトは法螺貝
            if (category === 'outgoing' && sound.id === 'outgoing_horn') {
              option.selected = true;
            }
            optgroup.appendChild(option);
          }

          selectElement.appendChild(optgroup);
        }
      }
    } catch (error) {
      console.error('[Popup] Error loading preset sounds:', error);
    }
  }

  // カスタムオプション
  const separator = document.createElement('option');
  separator.disabled = true;
  separator.textContent = '── カスタム ──';
  selectElement.appendChild(separator);

  const customOption = document.createElement('option');
  customOption.value = 'custom:uploaded';
  customOption.textContent = 'アップロードした音声';
  selectElement.appendChild(customOption);
}

/**
 * ハンドサイン通知音をテスト再生
 */
async function playHandSignTestSound(soundValue) {
  if (!isExtension) {
    showToast('デモモードでは再生できません');
    return;
  }

  try {
    if (soundValue.startsWith('custom:')) {
      // カスタム音声
      const customData = handSignSettings.notifications?.customSoundData;
      if (customData) {
        const audio = new Audio(customData);
        audio.volume = 0.7;
        await audio.play();
        showToast('テスト再生中', 'info');
      } else {
        showToast('カスタム音声がアップロードされていません', 'error');
      }
    } else {
      // プリセット音声
      const [category, presetId] = soundValue.split(':');
      const response = await sendMessage({ type: 'GET_PRESET_SOUNDS' });

      if (response.success && response.data && response.data[category]) {
        const preset = response.data[category].find(p => p.id === presetId);
        if (preset) {
          const soundUrl = chrome.runtime.getURL(`sounds/${category}/${preset.file}`);
          const audio = new Audio(soundUrl);
          audio.volume = 0.7;
          await audio.play();
          showToast('テスト再生中', 'info');
        } else {
          showToast('音声が見つかりません', 'error');
        }
      }
    }
  } catch (error) {
    console.error('[Popup] Test play error:', error);
    showToast('再生に失敗しました', 'error');
  }
}

/**
 * ハンドサイン用カスタム音声アップロード
 */
async function handleHandSignCustomUpload(file) {
  if (file.size > MAX_FILE_SIZE) {
    showToast('ファイルサイズが300MBを超えています', 'error');
    return;
  }

  if (!file.type.startsWith('audio/')) {
    showToast('音声ファイルを選択してください', 'error');
    return;
  }

  try {
    const data = await fileToBase64(file);

    handSignSettings.notifications = handSignSettings.notifications || {};
    handSignSettings.notifications.soundPreset = 'custom:uploaded';
    handSignSettings.notifications.customSoundData = data;
    handSignSettings.notifications.customSoundFileName = file.name;

    await saveHandSignSettings();

    // UIを更新
    const selectElement = document.getElementById('handsign-sound-preset');
    if (selectElement) {
      selectElement.value = 'custom:uploaded';
    }
    document.getElementById('handsign-custom-file-info').textContent = `カスタム: ${file.name}`;

    showToast('カスタム通知音を保存しました', 'success');
  } catch (error) {
    showToast('アップロードに失敗しました', 'error');
  }
}

/**
 * ハンドサイン設定を保存
 */
async function saveHandSignSettings() {
  if (isExtension) {
    try {
      await sendMessage({ type: 'SAVE_HAND_SIGN_SETTINGS', settings: handSignSettings });
      console.log('[Popup] Hand sign settings saved:', handSignSettings);
    } catch (error) {
      console.error('[Popup] Error saving hand sign settings:', error);
    }
  }
}

// ===============================================
// 仮想カメラ機能
// ===============================================

const MAX_IMAGES_PER_TYPE = 12;
let virtualCameraImages = {
  wave: [],     // 最大12枚の配列
  thumbsup: []  // 最大12枚の配列
};

/**
 * 仮想カメラ設定を初期化
 */
async function setupVirtualCamera() {
  // グリッドを初期化
  renderImageGrid('wave');
  renderImageGrid('thumbsup');

  // ストレージから画像を読み込み
  if (isExtension) {
    try {
      const result = await chrome.storage.local.get(['virtualCameraImages']);
      if (result.virtualCameraImages) {
        // 旧形式（単一画像）から新形式（配列）への移行
        if (result.virtualCameraImages.wave && !Array.isArray(result.virtualCameraImages.wave)) {
          virtualCameraImages.wave = [result.virtualCameraImages.wave];
        } else {
          virtualCameraImages.wave = result.virtualCameraImages.wave || [];
        }
        if (result.virtualCameraImages.thumbsup && !Array.isArray(result.virtualCameraImages.thumbsup)) {
          virtualCameraImages.thumbsup = [result.virtualCameraImages.thumbsup];
        } else {
          virtualCameraImages.thumbsup = result.virtualCameraImages.thumbsup || [];
        }
        updateImageGrids();
      }
    } catch (error) {
      console.error('[Popup] Error loading virtual camera settings:', error);
    }
  }

  // カメラ起動ボタン（Remoworkサイト上でモーダルを開く）
  const startCameraBtn = document.getElementById('start-camera-btn');
  if (startCameraBtn) {
    startCameraBtn.addEventListener('click', openCameraOnSite);
  }

  // 撮影ボタン（ポップアップ内のカメラは廃止、サイト上で撮影）
  const captureWaveBtn = document.getElementById('capture-wave-btn');
  const captureThumbsupBtn = document.getElementById('capture-thumbsup-btn');

  if (captureWaveBtn) {
    captureWaveBtn.addEventListener('click', openCameraOnSite);
  }
  if (captureThumbsupBtn) {
    captureThumbsupBtn.addEventListener('click', openCameraOnSite);
  }

  // 全削除ボタン
  const clearWaveBtn = document.getElementById('clear-wave-btn');
  const clearThumbsupBtn = document.getElementById('clear-thumbsup-btn');

  if (clearWaveBtn) {
    clearWaveBtn.addEventListener('click', () => clearAllImages('wave'));
  }
  if (clearThumbsupBtn) {
    clearThumbsupBtn.addEventListener('click', () => clearAllImages('thumbsup'));
  }

  // デフォルト画像ボタン
  const defaultWaveBtn = document.getElementById('default-wave-btn');
  const defaultThumbsupBtn = document.getElementById('default-thumbsup-btn');

  if (defaultWaveBtn) {
    defaultWaveBtn.addEventListener('click', () => setDefaultImages('wave'));
  }
  if (defaultThumbsupBtn) {
    defaultThumbsupBtn.addEventListener('click', () => setDefaultImages('thumbsup'));
  }
}

/**
 * カメラ撮影モーダルを開く（Remoworkサイト上で）
 */
async function openCameraOnSite() {
  try {
    // アクティブなRemoworkタブを取得
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab || !tab.url) {
      showToast('Remoworkサイトを開いてください', 'error');
      return;
    }

    // Remoworkサイトかチェック
    if (!tab.url.includes('remowork.biz')) {
      showToast('Remoworkサイトを開いてから\n撮影ボタンを押してください', 'error');
      return;
    }

    // content scriptにメッセージを送信してカメラモーダルを開く
    await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_CAMERA_MODAL' });
    showToast('Remoworkサイト上でカメラが開きます', 'success');

    // ポップアップを閉じる（ユーザーがサイトで操作できるように）
    window.close();
  } catch (error) {
    console.error('[Popup] Failed to open camera modal:', error);
    showToast('カメラの起動に失敗しました\nRemoworkサイトを開いてください', 'error');
  }
}

/**
 * 画像グリッドを描画
 */
function renderImageGrid(type) {
  const grid = document.getElementById(`${type}-images-grid`);
  if (!grid) return;

  grid.innerHTML = '';
  for (let i = 0; i < MAX_IMAGES_PER_TYPE; i++) {
    const slot = document.createElement('div');
    slot.className = 'registered-image-item';
    slot.dataset.index = i;
    slot.innerHTML = `
      <span class="slot-number">${i + 1}</span>
      <button class="delete-btn" title="削除">×</button>
    `;

    // 削除ボタンのイベント
    slot.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteImageAt(type, i);
    });

    grid.appendChild(slot);
  }
}

/**
 * 画像グリッドを更新
 */
function updateImageGrids() {
  updateImageGrid('wave');
  updateImageGrid('thumbsup');
}

/**
 * 特定タイプの画像グリッドを更新
 */
function updateImageGrid(type) {
  const grid = document.getElementById(`${type}-images-grid`);
  const countSpan = document.getElementById(`${type}-count`);
  const clearBtn = document.getElementById(`clear-${type}-btn`);

  if (!grid) return;

  const images = virtualCameraImages[type] || [];
  const slots = grid.querySelectorAll('.registered-image-item');

  slots.forEach((slot, i) => {
    const existingImg = slot.querySelector('img');
    if (existingImg) existingImg.remove();

    if (images[i]) {
      slot.classList.add('has-image');
      const img = document.createElement('img');
      img.src = images[i];
      img.alt = `${type} ${i + 1}`;
      slot.insertBefore(img, slot.firstChild);
    } else {
      slot.classList.remove('has-image');
    }
  });

  // カウント更新
  if (countSpan) {
    countSpan.textContent = images.length;
  }

  // 全削除ボタンの表示
  if (clearBtn) {
    clearBtn.style.display = images.length > 0 ? 'inline-block' : 'none';
  }
}

/**
 * 特定インデックスの画像を削除
 */
function deleteImageAt(type, index) {
  if (virtualCameraImages[type] && virtualCameraImages[type][index]) {
    virtualCameraImages[type].splice(index, 1);
    saveVirtualCameraImages();
    updateImageGrid(type);

    const emoji = type === 'wave' ? '👋' : '👍';
    showToast(`${emoji} を削除しました`, 'info');
  }
}

/**
 * 全画像を削除
 */
function clearAllImages(type) {
  virtualCameraImages[type] = [];
  saveVirtualCameraImages();
  updateImageGrid(type);

  const emoji = type === 'wave' ? '👋' : '👍';
  showToast(`${emoji} を全て削除しました`, 'info');
}

/**
 * デフォルト画像を生成（1〜12の数字入り）
 */
function generateDefaultImage(number, emoji) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');

  // 背景
  ctx.fillStyle = emoji === '👋' ? '#4CAF50' : '#2196F3';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 絵文字
  ctx.font = '120px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, canvas.width / 2, canvas.height / 2 - 40);

  // 番号
  ctx.font = 'bold 80px sans-serif';
  ctx.fillStyle = 'white';
  ctx.fillText(number.toString(), canvas.width / 2, canvas.height / 2 + 100);

  return canvas.toDataURL('image/jpeg', 0.8);
}

/**
 * デフォルト画像をセット
 */
function setDefaultImages(type) {
  const emoji = type === 'wave' ? '👋' : '👍';
  virtualCameraImages[type] = [];

  for (let i = 1; i <= MAX_IMAGES_PER_TYPE; i++) {
    virtualCameraImages[type].push(generateDefaultImage(i, emoji));
  }

  saveVirtualCameraImages();
  updateImageGrid(type);

  showToast(`${emoji} にデフォルト画像をセットしました`, 'success');
}

/**
 * 仮想カメラ画像を保存
 */
async function saveVirtualCameraImages() {
  if (isExtension) {
    try {
      await chrome.storage.local.set({ virtualCameraImages });
      console.log('[Popup] Virtual camera images saved');
    } catch (error) {
      console.error('[Popup] Error saving virtual camera images:', error);
    }
  }
}

// ストレージ変更を監視（content scriptで撮影した画像を反映）
if (isExtension) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.virtualCameraImages) {
      const newImages = changes.virtualCameraImages.newValue;
      if (newImages) {
        virtualCameraImages = newImages;
        updateImageGrids();
        console.log('[Popup] Virtual camera images updated from storage');
      }
    }
  });
}

/**
 * LLM設定をセットアップ
 */
function setupLLMSettings() {
  const enabledToggle = document.getElementById('llm-enabled-toggle');
  const providerSelect = document.getElementById('llm-provider');
  const modelSelect = document.getElementById('llm-model');
  const apiKeyInput = document.getElementById('llm-api-key');
  const toggleVisibilityBtn = document.getElementById('toggle-api-key-visibility');
  const customEndpointInput = document.getElementById('llm-custom-endpoint');
  const customSection = document.getElementById('llm-custom-section');
  const apiNote = document.getElementById('llm-api-note');
  const autoStructureCheckbox = document.getElementById('llm-auto-structure');
  const extractActionsCheckbox = document.getElementById('llm-extract-actions');
  const extractDecisionsCheckbox = document.getElementById('llm-extract-decisions');
  const testConnectionBtn = document.getElementById('test-llm-connection');
  const testResultEl = document.getElementById('llm-test-result');

  // プロフィール入力欄
  const profileNameInput = document.getElementById('llm-profile-name');
  const profileCompanyInput = document.getElementById('llm-profile-company');
  const profileRoleInput = document.getElementById('llm-profile-role');
  const profileContextInput = document.getElementById('llm-profile-context');

  // 初期値を設定
  enabledToggle.checked = llmSettings.enabled;
  providerSelect.value = llmSettings.provider;
  apiKeyInput.value = llmSettings.apiKey || '';
  customEndpointInput.value = llmSettings.customEndpoint || '';
  autoStructureCheckbox.checked = llmSettings.autoStructure !== false;
  extractActionsCheckbox.checked = llmSettings.extractActions !== false;
  extractDecisionsCheckbox.checked = llmSettings.extractDecisions !== false;

  // プロフィール情報を設定
  const profile = llmSettings.profile || {};
  profileNameInput.value = profile.name || '';
  profileCompanyInput.value = profile.company || '';
  profileRoleInput.value = profile.role || '';
  profileContextInput.value = profile.context || '';

  // モデルリストを更新
  updateModelList(llmSettings.provider);
  if (llmSettings.model) {
    modelSelect.value = llmSettings.model;
  }

  // カスタムセクションの表示切替
  customSection.style.display = llmSettings.provider === 'custom' ? 'block' : 'none';

  // APIノートを更新
  updateApiNote(llmSettings.provider);

  // 有効/無効トグル
  enabledToggle.addEventListener('change', async () => {
    llmSettings.enabled = enabledToggle.checked;
    await saveLLMSettings();
    showToast(llmSettings.enabled ? 'AI構造化メモを有効化しました' : 'AI構造化メモを無効化しました');
  });

  // プロバイダー変更
  providerSelect.addEventListener('change', async () => {
    llmSettings.provider = providerSelect.value;
    updateModelList(providerSelect.value);
    llmSettings.model = modelSelect.value;
    customSection.style.display = providerSelect.value === 'custom' ? 'block' : 'none';
    updateApiNote(providerSelect.value);
    await saveLLMSettings();
  });

  // モデル変更
  modelSelect.addEventListener('change', async () => {
    llmSettings.model = modelSelect.value;
    await saveLLMSettings();
  });

  // APIキー変更
  apiKeyInput.addEventListener('change', async () => {
    llmSettings.apiKey = apiKeyInput.value.trim();
    await saveLLMSettings();
    showToast('APIキーを保存しました');
  });

  // APIキー表示/非表示
  toggleVisibilityBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleVisibilityBtn.textContent = '🙈';
    } else {
      apiKeyInput.type = 'password';
      toggleVisibilityBtn.textContent = '👁';
    }
  });

  // カスタムエンドポイント変更
  customEndpointInput.addEventListener('change', async () => {
    llmSettings.customEndpoint = customEndpointInput.value.trim();
    await saveLLMSettings();
  });

  // 構造化設定
  autoStructureCheckbox.addEventListener('change', async () => {
    llmSettings.autoStructure = autoStructureCheckbox.checked;
    await saveLLMSettings();
  });

  extractActionsCheckbox.addEventListener('change', async () => {
    llmSettings.extractActions = extractActionsCheckbox.checked;
    await saveLLMSettings();
  });

  extractDecisionsCheckbox.addEventListener('change', async () => {
    llmSettings.extractDecisions = extractDecisionsCheckbox.checked;
    await saveLLMSettings();
  });

  // プロフィール情報変更
  const saveProfile = async () => {
    llmSettings.profile = {
      name: profileNameInput.value.trim(),
      company: profileCompanyInput.value.trim(),
      role: profileRoleInput.value.trim(),
      context: profileContextInput.value.trim()
    };
    await saveLLMSettings();
  };

  profileNameInput.addEventListener('change', saveProfile);
  profileCompanyInput.addEventListener('change', saveProfile);
  profileRoleInput.addEventListener('change', saveProfile);
  profileContextInput.addEventListener('change', saveProfile);

  // 接続テスト
  testConnectionBtn.addEventListener('click', async () => {
    await testLLMConnection(testResultEl);
  });
}

/**
 * モデルリストを更新
 */
function updateModelList(provider) {
  const modelSelect = document.getElementById('llm-model');
  modelSelect.innerHTML = '';

  const models = LLM_MODELS[provider] || [];
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    modelSelect.appendChild(option);
  }
}

/**
 * APIノートを更新
 */
function updateApiNote(provider) {
  const apiNote = document.getElementById('llm-api-note');
  const notes = {
    gemini: '⚠️ 文字起こし機能はBraveブラウザでは利用できません（Chromeを推奨）\nGeminiは無料枠で利用可能（10 RPM / 250 RPD）',
    openai: '⚠️ 文字起こし機能はBraveブラウザでは利用できません（Chromeを推奨）\nOpenAIは従量課金制です',
    claude: '⚠️ 文字起こし機能はBraveブラウザでは利用できません（Chromeを推奨）\nClaudeは従量課金制です',
    custom: '⚠️ 文字起こし機能はBraveブラウザでは利用できません（Chromeを推奨）\nOpenAI互換のエンドポイントを指定してください'
  };
  apiNote.textContent = notes[provider] || '';
  apiNote.style.whiteSpace = 'pre-line';
}

/**
 * LLM設定を保存
 */
async function saveLLMSettings() {
  if (isExtension) {
    try {
      await sendMessage({ type: 'SAVE_LLM_SETTINGS', settings: llmSettings });
      console.log('[Popup] LLM settings saved');
    } catch (error) {
      console.error('[Popup] Error saving LLM settings:', error);
    }
  }
}

/**
 * LLM接続テスト
 */
async function testLLMConnection(resultEl) {
  if (!llmSettings.apiKey && llmSettings.provider !== 'custom') {
    resultEl.textContent = '❌ APIキーを入力してください';
    resultEl.style.color = 'var(--danger-color)';
    return;
  }

  resultEl.textContent = '🔄 テスト中...';
  resultEl.style.color = 'var(--text-secondary)';

  try {
    const response = await sendMessage({
      type: 'TEST_LLM_CONNECTION',
      settings: llmSettings
    });

    if (response.success) {
      resultEl.textContent = `✅ 接続成功！レスポンス: "${response.message}"`;
      resultEl.style.color = 'var(--success-color)';
    } else {
      resultEl.textContent = `❌ エラー: ${response.error}`;
      resultEl.style.color = 'var(--danger-color)';
    }
  } catch (error) {
    resultEl.textContent = `❌ 接続エラー: ${error.message}`;
    resultEl.style.color = 'var(--danger-color)';
  }
}

/**
 * Whisper設定をセットアップ
 */
function setupWhisperSettings() {
  const enabledToggle = document.getElementById('whisper-enabled-toggle');
  const apiKeyInput = document.getElementById('whisper-api-key');
  const toggleVisibilityBtn = document.getElementById('toggle-whisper-key-visibility');
  const languageSelect = document.getElementById('whisper-language');
  const testConnectionBtn = document.getElementById('test-whisper-connection');
  const testResultEl = document.getElementById('whisper-test-result');

  if (!enabledToggle) return; // 要素がなければスキップ

  // 初期値を設定
  enabledToggle.checked = whisperSettings.enabled;
  apiKeyInput.value = whisperSettings.apiKey || '';
  languageSelect.value = whisperSettings.language || 'ja';

  // 有効/無効トグル
  enabledToggle.addEventListener('change', async () => {
    whisperSettings.enabled = enabledToggle.checked;
    await saveWhisperSettings();
    showToast(whisperSettings.enabled ? 'Whisper文字起こしを有効化しました' : 'Whisper文字起こしを無効化しました');
  });

  // APIキー変更
  apiKeyInput.addEventListener('change', async () => {
    whisperSettings.apiKey = apiKeyInput.value.trim();
    await saveWhisperSettings();
    showToast('Whisper APIキーを保存しました');
  });

  // APIキー表示/非表示
  toggleVisibilityBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleVisibilityBtn.textContent = '🙈';
    } else {
      apiKeyInput.type = 'password';
      toggleVisibilityBtn.textContent = '👁';
    }
  });

  // 言語変更
  languageSelect.addEventListener('change', async () => {
    whisperSettings.language = languageSelect.value;
    await saveWhisperSettings();
  });

  // 接続テスト
  testConnectionBtn.addEventListener('click', () => {
    testWhisperConnection(testResultEl);
  });
}

/**
 * Whisper設定を保存
 */
async function saveWhisperSettings() {
  if (isExtension) {
    try {
      await sendMessage({ type: 'SAVE_WHISPER_SETTINGS', settings: whisperSettings });
      console.log('[Popup] Whisper settings saved');
    } catch (error) {
      console.error('[Popup] Error saving Whisper settings:', error);
    }
  }
}

/**
 * Whisper接続テスト
 */
async function testWhisperConnection(resultEl) {
  if (!whisperSettings.apiKey) {
    resultEl.textContent = '❌ APIキーを入力してください';
    resultEl.style.color = 'var(--danger-color)';
    return;
  }

  resultEl.textContent = '🔄 テスト中...';
  resultEl.style.color = 'var(--text-secondary)';

  try {
    const response = await sendMessage({
      type: 'TEST_WHISPER_CONNECTION',
      apiKey: whisperSettings.apiKey
    });

    if (response.success) {
      resultEl.textContent = `✅ ${response.message}`;
      resultEl.style.color = 'var(--success-color)';
    } else {
      resultEl.textContent = `❌ エラー: ${response.error}`;
      resultEl.style.color = 'var(--danger-color)';
    }
  } catch (error) {
    resultEl.textContent = `❌ 接続エラー: ${error.message}`;
    resultEl.style.color = 'var(--danger-color)';
  }
}

// ===============================================
// 統計設定
// ===============================================

/**
 * 統計設定をセットアップ
 */
async function setupStatsSettings() {
  const enabledToggle = document.getElementById('stats-enabled-toggle');
  const sendNowBtn = document.getElementById('send-stats-now');
  const lastSentEl = document.getElementById('stats-last-sent');
  const statsPreviewEl = document.getElementById('stats-preview');
  const versionEl = document.getElementById('extension-version');

  if (!enabledToggle) return;

  // バージョン表示
  if (versionEl && isExtension) {
    const manifest = chrome.runtime.getManifest();
    versionEl.textContent = `v${manifest.version}`;
  }

  // 初期値を設定
  enabledToggle.checked = statsSettings.enabled !== false;

  // 最終送信時刻を表示
  if (lastSentEl && statsSettings.lastSentAt) {
    const lastSent = new Date(statsSettings.lastSentAt);
    lastSentEl.textContent = `最終送信: ${lastSent.toLocaleString('ja-JP')}`;
  }

  // 現在の統計を表示
  await updateStatsPreview(statsPreviewEl);

  // 有効/無効トグル
  enabledToggle.addEventListener('change', async () => {
    statsSettings.enabled = enabledToggle.checked;
    await saveStatsSettings();
    showToast(statsSettings.enabled ? '統計送信を有効化しました' : '統計送信を無効化しました');
  });

  // 今すぐ送信ボタン
  if (sendNowBtn) {
    sendNowBtn.addEventListener('click', async () => {
      sendNowBtn.disabled = true;
      sendNowBtn.textContent = '📊 送信中...';

      try {
        const response = await sendMessage({ type: 'SEND_STATS_NOW' });

        if (response.success) {
          showToast('統計を送信しました', 'success');
          statsSettings.lastSentAt = new Date().toISOString();
          if (lastSentEl) {
            lastSentEl.textContent = `最終送信: ${new Date().toLocaleString('ja-JP')}`;
          }
          // 統計プレビューを更新
          await updateStatsPreview(statsPreviewEl);
        } else {
          showToast(`送信失敗: ${response.error || response.reason}`, 'error');
        }
      } catch (error) {
        showToast(`送信エラー: ${error.message}`, 'error');
      } finally {
        sendNowBtn.disabled = false;
        sendNowBtn.textContent = '📊 今すぐ統計を送信';
      }
    });
  }
}

/**
 * 統計プレビューを更新
 */
async function updateStatsPreview(previewEl) {
  if (!previewEl || !isExtension) return;

  try {
    const response = await sendMessage({ type: 'GET_CURRENT_STATS' });

    if (response.success && response.data) {
      const stats = response.data;
      const html = `
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">ハンドサイン検出</span>
            <span class="stat-value">${sumObject(stats.handSigns || {})}回</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">表情分析</span>
            <span class="stat-value">${stats.expression?.analyzeCount || 0}回</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">外線通話</span>
            <span class="stat-value">${stats.calls?.external?.count || 0}回</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">内線通話</span>
            <span class="stat-value">${stats.calls?.internal?.count || 0}回</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">ポップアップ表示</span>
            <span class="stat-value">${stats.uiClicks?.popup_open || 0}回</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">エラー</span>
            <span class="stat-value">${sumObject(stats.errors || {})}回</span>
          </div>
        </div>
      `;
      previewEl.innerHTML = html;
    } else {
      previewEl.innerHTML = '<p class="note">統計データがありません</p>';
    }
  } catch (error) {
    console.error('[Popup] Error loading stats:', error);
    previewEl.innerHTML = '<p class="note">統計の読み込みに失敗しました</p>';
  }
}

/**
 * オブジェクトの値を合計
 */
function sumObject(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  return Object.values(obj).reduce((sum, val) => sum + (Number(val) || 0), 0);
}

/**
 * 統計設定を保存
 */
async function saveStatsSettings() {
  if (isExtension) {
    try {
      await sendMessage({ type: 'SAVE_STATS_SETTINGS', settings: statsSettings });
      console.log('[Popup] Stats settings saved');
    } catch (error) {
      console.error('[Popup] Error saving stats settings:', error);
    }
  }
}

/**
 * UIクリックを記録
 */
async function recordUiClick(key) {
  if (!isExtension) return;
  try {
    await sendMessage({ type: 'RECORD_STAT', category: 'uiClicks', key: key });
  } catch (error) {
    console.error('[Popup] Error recording UI click:', error);
  }
}

/**
 * エラーを記録
 */
async function recordError(key) {
  if (!isExtension) return;
  try {
    await sendMessage({ type: 'RECORD_STAT', category: 'errors', key: key });
  } catch (error) {
    console.error('[Popup] Error recording error:', error);
  }
}
