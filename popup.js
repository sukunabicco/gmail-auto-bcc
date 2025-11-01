/**
 * Gmail Auto BCC Extension - Popup Script
 * 
 * このスクリプトは拡張機能のポップアップUIを制御します：
 * 1. 有効/無効トグルスイッチの状態管理
 * 2. 検出されたメールアドレスの表示
 * 3. ユーザー設定の保存と読み込み
 */

/**
 * ポップアップが開かれた際の初期化処理
 * 
 * 実行内容：
 * 1. 保存されている有効/無効状態を読み込んでトグルスイッチに反映
 * 2. 検出されたメールアドレスを表示
 */
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggleEnabled');
  const emailDisplay = document.getElementById('emailDisplay');

  // 保存されている設定を読み込み
  chrome.storage.sync.get(['isEnabled'], (result) => {
    // デフォルトはtrue（有効）
    toggle.checked = result.isEnabled !== false;
  });

  // 検出されたメールアドレスを表示
  chrome.storage.local.get(['detectedEmail'], (result) => {
    if (result.detectedEmail) {
      emailDisplay.textContent = result.detectedEmail;
    } else {
      emailDisplay.textContent = 'メールアドレスを検出中...';
    }
  });

  /**
   * トグルスイッチの変更イベントハンドラ
   * 
   * ユーザーがスイッチを切り替えた際に：
   * 1. 新しい状態をストレージに保存
   * 2. content scriptに自動的に反映される（chrome.storage.onChanged経由）
   */
  toggle.addEventListener('change', () => {
    const isEnabled = toggle.checked;
    chrome.storage.sync.set({ isEnabled: isEnabled }, () => {
      console.log('設定を保存しました:', isEnabled);
    });
  });
});