/**
 * Remowork Sound Changer - MP3 Converter
 * WebM形式の音声をMP3に変換（オフスクリーンドキュメント経由）
 */

(function() {
  'use strict';

  // Chrome runtime.sendMessage の上限は 64MB
  // Array.from() でJSON化するとサイズが約5倍になるため
  // 10MBでチャンク分割（JSON化後 ~50MB）
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB

  // MP3変換の最大ファイルサイズ（これを超えるとWebMのまま）
  const MAX_MP3_CONVERT_SIZE = 10 * 1024 * 1024; // 10MB

  /**
   * オフスクリーンドキュメント経由でBlobをMP3に変換
   * @param {Blob} blob - WebM形式の音声Blob
   * @returns {Promise<Blob>} MP3形式のBlob
   */
  async function convertToMp3(blob) {
    // BlobをArrayBufferに変換
    const arrayBuffer = await blob.arrayBuffer();
    const totalSize = arrayBuffer.byteLength;

    console.log('[MP3Converter] Sending to offscreen, size:', totalSize);

    const result = await chrome.runtime.sendMessage({
      type: 'CONVERT_TO_MP3',
      audioData: Array.from(new Uint8Array(arrayBuffer))
    });

    if (!result || !result.success) {
      throw new Error(result?.error || 'MP3変換に失敗しました');
    }

    const mp3Array = new Uint8Array(result.mp3Data);
    console.log('[MP3Converter] Conversion complete, size:', mp3Array.length);
    return new Blob([mp3Array], { type: 'audio/mp3' });
  }

  /**
   * 録音データをMP3としてダウンロード
   * 大きなファイル（10MB超）はWebMのままダウンロード
   * @param {Object} recording - 録音データオブジェクト（blob, nameプロパティ必須）
   * @param {Function} onProgress - 進捗コールバック（'converting', 'complete', 'error', 'webm'）
   */
  async function downloadAsMp3(recording, onProgress = () => {}) {
    if (!recording || !recording.blob) {
      throw new Error('録音データがありません');
    }

    const fileSize = recording.blob.size;
    const fileName = recording.name || 'recording';

    try {
      // 大きなファイルはWebMのままダウンロード
      if (fileSize > MAX_MP3_CONVERT_SIZE) {
        console.log(`[MP3Converter] File too large (${(fileSize / 1024 / 1024).toFixed(1)}MB), downloading as WebM`);
        onProgress('webm');

        const url = URL.createObjectURL(recording.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileName}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('[MP3Converter] Downloaded as WebM:', fileName);
        onProgress('complete');
        return;
      }

      // 小さいファイルはMP3に変換
      onProgress('converting');

      // オフスクリーン経由でMP3に変換
      const mp3Blob = await convertToMp3(recording.blob);

      // ダウンロード
      const url = URL.createObjectURL(mp3Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log('[MP3Converter] Downloaded as MP3:', fileName);
      onProgress('complete');

    } catch (error) {
      console.error('[MP3Converter] Download failed:', error);
      onProgress('error', error.message);
      throw error;
    }
  }

  /**
   * 録音データをWebMとしてダウンロード（直接）
   * @param {Object} recording - 録音データオブジェクト
   */
  function downloadAsWebm(recording) {
    if (!recording || !recording.blob) {
      throw new Error('録音データがありません');
    }

    const url = URL.createObjectURL(recording.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recording.name || 'recording'}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('[MP3Converter] Downloaded as WebM:', recording.name);
  }

  // グローバルに公開
  window.MP3Converter = {
    convert: convertToMp3,
    download: downloadAsMp3,
    downloadWebm: downloadAsWebm,
    MAX_MP3_CONVERT_SIZE: MAX_MP3_CONVERT_SIZE
  };

})();
