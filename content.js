/**
 * Gmail Auto BCC Extension - Content Script
 * 
 * このスクリプトはGmailページに注入され、以下の機能を提供します：
 * 1. ユーザーのメールアドレスを自動検出
 * 2. 新規メール作成時に自動的にBCCフィールドに自分のアドレスを追加
 * 3. 返信・転送時は手動でBCCリンクをクリックした際に自動入力
 */

// グローバル変数
let userEmail = '';  // 検出されたユーザーのメールアドレス
let isEnabled = true;  // 拡張機能の有効/無効状態
let filledInputs = new Set();  // 既に入力済みのフィールドを追跡（重複入力防止）

/**
 * 拡張機能の初期化
 * ストレージから有効/無効状態を読み込み、有効な場合はメールアドレスの検出を開始
 */
chrome.storage.sync.get(['isEnabled'], (result) => {
  isEnabled = result.isEnabled !== false;
  if (isEnabled) {
    setTimeout(getUserEmail, 2000);  // ページ読み込み後2秒待ってから実行
  }
});

/**
 * ストレージの変更を監視
 * ユーザーがポップアップで有効/無効を切り替えた際に反映
 */
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (changes.isEnabled) {
    isEnabled = changes.isEnabled.newValue;
  }
});

/**
 * ページからユーザーのメールアドレスを抽出
 * 
 * 検出方法：
 * 1. ヘッダー内の[aria-label*="@"]要素から「Google アカウント」を含むものを探す
 * 2. フォールバック: ヘッダー内の[email]属性を持つ要素から取得
 * 
 * @returns {string} 検出されたメールアドレス、見つからない場合は空文字列
 */
function extractEmailFromPage() {
  let email = '';
  
  // 方法1: Google アカウントのaria-labelから抽出（最も確実）
  const ariaElements = document.querySelectorAll('[aria-label*="@"]');
  
  for (let el of ariaElements) {
    const ariaLabel = el.getAttribute('aria-label');
    const isInHeader = !!el.closest('header, [role="banner"]');
    
    // ヘッダー内で「Google」を含むaria-labelから抽出
    if (isInHeader && ariaLabel.includes('Google')) {
      const emailMatch = ariaLabel.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);
      if (emailMatch) {
        email = emailMatch[0];
        console.log('✅ Email found:', email);
        break;
      }
    }
  }
  
  // 方法2: [email]属性から取得（フォールバック）
  if (!email) {
    const header = document.querySelector('header, [role="banner"]');
    if (header) {
      const emailElements = header.querySelectorAll('[email]');
      for (let el of emailElements) {
        const addr = el.getAttribute('email');
        if (addr && addr.includes('@')) {
          email = addr;
          break;
        }
      }
    }
  }
  
  return email;
}

/**
 * メールアドレスを取得してセットアップを開始
 * 
 * 成功した場合：
 * - ストレージに保存
 * - 自動BCC機能をセットアップ
 * 
 * 失敗した場合：
 * - 3秒後に再試行
 */
function getUserEmail() {
  userEmail = extractEmailFromPage();
  
  if (userEmail) {
    chrome.storage.local.set({ detectedEmail: userEmail });
    console.log('✅ Email saved:', userEmail);
    setupAutoBcc();
  } else {
    console.log('❌ Email not found, retrying...');
    setTimeout(getUserEmail, 3000);
  }
}

/**
 * 自動BCC機能のセットアップ
 * 
 * 以下のクリックイベントを監視：
 * 1. 新規作成ボタン → 自動的にBCCをセット
 * 2. BCCリンク（手動クリック） → 自動的にメールアドレスを入力
 */
function setupAutoBcc() {
  console.log('👀 Setting up auto-BCC');
  
  // ページ全体のクリックイベントを監視
  document.addEventListener('click', (event) => {
    const target = event.target;
    let element = target;
    
    // クリックされた要素とその親要素を最大10階層まで遡って確認
    for (let i = 0; i < 10 && element; i++) {
      const text = element.textContent?.trim() || '';
      const ariaLabel = element.getAttribute('aria-label') || '';
      const role = element.getAttribute('role');
      const tooltip = element.getAttribute('data-tooltip') || '';
      
      // 新規作成ボタンの判定
      const isCompose = 
        text === '作成' || 
        text === 'Compose' ||
        ariaLabel.includes('作成') ||
        ariaLabel.includes('Compose');
      
      // BCCリンクの判定（手動クリック検知用）
      // 「宛先を追加」を含むものだけ（「連絡先を選択」は除外）
      const isBccLink = 
        role === 'link' && 
        (text === 'Bcc' || text === 'BCC') &&
        (tooltip.includes('宛先を追加') || tooltip.includes('Add recipients'));
      
      if (isCompose) {
        console.log('✉️ COMPOSE clicked!');
        scheduleComposeAutoBcc();
        break;
      }
      
      if (isBccLink) {
        console.log('📧 BCC link clicked manually!');
        // BCCフィールドが表示されるまで複数回試行
        setTimeout(() => { fillBccField(); }, 500);
        setTimeout(() => { fillBccField(); }, 1000);
        setTimeout(() => { fillBccField(); }, 1500);
        break;
      }
      
      element = element.parentElement;
    }
  }, true);  // キャプチャフェーズで実行（早期検出）
  
  console.log('✅ Auto-BCC active (Compose only)');
}

/**
 * 新規作成時の自動BCC処理をスケジュール
 * 
 * 作成ウィンドウが完全に読み込まれるまで待つため、
 * 複数のタイミングで試行
 */
function scheduleComposeAutoBcc() {
  const timings = [1000, 1500, 2000, 2500, 3000];  // ミリ秒
  
  timings.forEach(delay => {
    setTimeout(() => {
      tryComposeAutoBcc();
    }, delay);
  });
}

/**
 * 新規作成ウィンドウでBCCリンクを探してクリック
 * 
 * 処理フロー：
 * 1. 「Bcc の宛先を追加」リンクを探す
 * 2. BCCフィールドが既に表示されている場合は直接入力
 * 3. 表示されていない場合はBCCリンクをクリックしてから入力
 */
function tryComposeAutoBcc() {
  if (!userEmail || !isEnabled) {
    return;
  }
  
  console.log('🔍 [Compose] Looking for BCC link...');
  
  // BCCリンクを探す
  const bccLinks = Array.from(document.querySelectorAll('span[role="link"]'))
    .filter(span => {
      const text = span.textContent.trim();
      const tooltip = span.getAttribute('data-tooltip') || '';
      return (text === 'Bcc' || text === 'BCC') && 
             (tooltip.includes('宛先を追加') || tooltip.includes('Add recipients'));
    });
  
  if (bccLinks.length === 0) {
    return;
  }
  
  console.log(`  Found ${bccLinks.length} BCC link(s)`);
  
  bccLinks.forEach((bccLink, index) => {
    const composeWindow = findComposeWindow(bccLink);
    
    // BCCフィールドが既に表示されているか確認
    const existingBccFields = composeWindow.querySelectorAll('input[aria-label*="Bcc"]');
    
    if (existingBccFields.length > 0 && existingBccFields[0].offsetWidth > 0) {
      // 既にBCCフィールドがある場合は直接入力
      console.log(`  BCC field already visible`);
      fillBccField();
    } else {
      // BCCリンクをクリックしてフィールドを表示
      console.log(`  Clicking BCC link`);
      bccLink.click();
      
      // クリック後、フィールドが表示されるまで待つ
      setTimeout(() => {
        fillBccField();
      }, 1000);
    }
  });
}

/**
 * BCCリンクから作成ウィンドウの親要素を探す
 * 
 * GmailのDOM構造に基づいて、BCCリンクから作成ウィンドウ全体を
 * 包含する要素を見つける
 * 
 * @param {HTMLElement} bccLink - BCCリンク要素
 * @returns {HTMLElement} 作成ウィンドウ要素、見つからない場合はdocument.body
 */
function findComposeWindow(bccLink) {
  let element = bccLink;
  
  // 最大20階層まで親要素を遡る
  for (let i = 0; i < 20 && element; i++) {
    const className = element.className || '';
    
    // 作成ウィンドウの特徴的なクラスを探す
    if (className.includes('GS') || 
        className.includes('compose') ||
        element.tagName === 'TABLE') {
      return element;
    }
    
    element = element.parentElement;
  }
  
  return document.body;
}

/**
 * BCCフィールドを探して自分のメールアドレスを入力
 * 
 * 処理フロー：
 * 1. ページ内の表示されているinput要素を探す
 * 2. aria-labelに「Bcc」を含むものを見つける
 * 3. 既に入力済みでないかチェック
 * 4. メールアドレスを入力してEnterキーを送信
 * 
 * 重複入力防止：
 * - filledInputs Setで既に入力したフィールドを追跡
 * - 既に自分のメールアドレスが入っている場合はスキップ
 */
function fillBccField() {
  if (!userEmail || !isEnabled) {
    return;
  }
  
  console.log('  🔍 Looking for BCC field...');
  
  // 全ページから表示されているBCC入力フィールドを探す
  // type="hidden"は除外
  const allInputs = document.querySelectorAll('input:not([type="hidden"]), textarea, [contenteditable="true"]');
  
  for (let i = 0; i < allInputs.length; i++) {
    const input = allInputs[i];
    
    // 既に入力済みのフィールドはスキップ（重複入力防止）
    if (filledInputs.has(input)) {
      continue;
    }
    
    // 表示されているか確認（offsetWidthとoffsetHeightが0より大きい）
    const isVisible = input.offsetWidth > 0 && input.offsetHeight > 0;
    if (!isVisible) {
      continue;
    }
    
    // aria-labelでBCCフィールドか判定
    const ariaLabel = input.getAttribute('aria-label') || '';
    
    if (ariaLabel.includes('Bcc') || ariaLabel.includes('BCC')) {
      console.log('  ✅ Found BCC field!');
      
      // 既に入力済みかチェック（値に自分のメールアドレスが含まれているか）
      const currentValue = input.value || input.textContent || '';
      if (currentValue.includes(userEmail)) {
        console.log('  ✓ Already filled');
        filledInputs.add(input);
        return;
      }
      
      console.log('  📝 Filling with:', userEmail);
      
      // フィールドにフォーカス
      input.focus();
      
      // 値を設定（INPUTとTEXTAREAは.value、その他は.textContent）
      if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
        input.value = userEmail;
      } else {
        input.textContent = userEmail;
      }
      
      // Gmailが変更を検知できるようにイベントを発火
      ['input', 'change'].forEach(type => {
        input.dispatchEvent(new Event(type, { bubbles: true }));
      });
      
      // 入力済みとしてマーク（重複入力防止）
      filledInputs.add(input);
      
      // Enterキーを送信してメールアドレスを確定
      setTimeout(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true
        }));
        
        // フォーカスを外す
        setTimeout(() => {
          input.blur();
          console.log('  ✅✅✅ BCC FILLED! ✅✅✅');
        }, 200);
      }, 300);
      
      return;
    }
  }
  
  console.log('  ⚠️ BCC field not found yet');
}