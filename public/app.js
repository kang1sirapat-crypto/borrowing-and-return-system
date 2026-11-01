// State variables
let currentTab = 'dashboard';
let html5QrCode = null;
let isCameraRunning = false;
let currentScannedItem = null;
let currentReturnTxId = null;
let currentTxStatusFilter = 'ALL';

// ================= CLOUD / LOCALSTORAGE FALLBACK ENGINE =================
// Automatically intercepts /api/* calls when hosted on static hosts (GitHub Pages / Vercel)
(function setupOfflineCloudFallback() {
  const STORAGE_KEY = 'asset_tracker_cloud_db_v1';

  function getTodayStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0];
  }

  function getNowDateTimeStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().replace('T', ' ').substring(0, 19);
  }

  function loadLocalDb() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn('LocalStorage read error:', e);
    }

    const initialDb = {
      nextItemId: 6,
      nextTxId: 3,
      items: [
        { id: 1, code: 'CAM-001', name: 'กล้อง Sony Alpha A6400 + เลนส์ 16-50mm', category: 'อุปกรณ์กล้อง/มีเดีย', location: 'ตู้เก็บกล้อง A1', total_qty: 2, available_qty: 2, unit: 'ชุด', description: 'ชุดกล้องสำหรับงานบันทึกวิดีโอและภาพนิ่ง' },
        { id: 2, code: 'MIC-101', name: 'ไมโครโฟนไร้สาย DJI Mic 2 (ชุด 2 ตัวส่ง + 1 รับ)', category: 'อุปกรณ์เสียง', location: 'ตู้ A2', total_qty: 3, available_qty: 2, unit: 'เซ็ต', description: 'ไมโครโฟนบันทึกเสียงไร้สายแบบพกพา' },
        { id: 3, code: 'LAB-OSC-01', name: 'Digital Oscilloscope Rigol DS1054Z', category: 'เครื่องมือวิทยาศาสตร์/แล็บ', location: 'โต๊ะทดลอง 3', total_qty: 4, available_qty: 3, unit: 'เครื่อง', description: 'เครื่องวัดสัญญาณดิจิทัล 4 แชนเนล 50MHz' },
        { id: 4, code: 'TOOL-DRL-02', name: 'สว่านไร้สาย Bosch GSB 18V-50 พร้อมกล่องดอกสว่าน', category: 'เครื่องมือช่าง', location: 'ชั้นวางช่าง B', total_qty: 2, available_qty: 1, unit: 'กล่อง', description: 'สว่านกระแทกไร้สาย มอเตอร์ไร้แปรงถ่าน' },
        { id: 5, code: 'PRJ-EPS-01', name: 'โปรเจกเตอร์ Epson EB-X51 (3,800 Lumens)', category: 'อุปกรณ์ห้องประชุม/นำเสนอ', location: 'ห้องพัสดุกลาง', total_qty: 1, available_qty: 1, unit: 'เครื่อง', description: 'เครื่องฉายโปรเจกเตอร์ความสว่างสูง พร้อมสาย HDMI' }
      ],
      transactions: [
        { id: 1, item_id: 2, item_code: 'MIC-101', item_name: 'ไมโครโฟนไร้สาย DJI Mic 2 (ชุด 2 ตัวส่ง + 1 รับ)', borrower_name: 'สมชาย สายตรวจ', borrower_contact: '089-111-2233', borrower_dept: 'ฝ่ายโสตฯ', purpose: 'ใช้บันทึกเทปสัมมนาประจำปี', qty: 1, borrowed_at: getNowDateTimeStr(-2), due_date: getTodayStr(1), returned_at: null, status: 'BORROWED', notes: '' },
        { id: 2, item_id: 4, item_code: 'TOOL-DRL-02', item_name: 'สว่านไร้สาย Bosch GSB 18V-50 พร้อมกล่องดอกสว่าน', borrower_name: 'กมล พัฒนา', borrower_contact: '081-999-8877', borrower_dept: 'ฝ่ายอาคาร', purpose: 'ซ่อมแซมแผงไฟห้องแล็บ', qty: 1, borrowed_at: getNowDateTimeStr(-2), due_date: getTodayStr(1), returned_at: null, status: 'BORROWED', notes: '' }
      ],
      settings: {
        line_notify_token: '',
        line_webhook_url: '',
        auto_alert_hour: '08:00'
      }
    };
    saveLocalDb(initialDb);
    return initialDb;
  }

  function saveLocalDb(dbData) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dbData));
    } catch (e) {
      console.warn('LocalStorage write error:', e);
    }
  }

  async function sendWebhookIfConfigured(dbData, message) {
    const webhookUrl = (dbData.settings?.line_webhook_url || '').trim();
    if (webhookUrl) {
      try {
        await originalFetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: message, text: message, message })
        });
        return true;
      } catch (e) {
        console.warn('Webhook error:', e);
      }
    }
    return false;
  }

  function makeJsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async function handleLocalApi(urlStr, options = {}) {
    const url = new URL(urlStr, window.location.origin);
    const path = url.pathname;
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};
    const dbData = loadLocalDb();
    const today = getTodayStr(0);

    // 1. GET /api/stats
    if (path.endsWith('/api/stats') && method === 'GET') {
      const totalItems = dbData.items.length;
      const totalQty = dbData.items.reduce((s, i) => s + Number(i.total_qty || 0), 0);
      const availableQty = dbData.items.reduce((s, i) => s + Number(i.available_qty || 0), 0);
      const activeBorrows = dbData.transactions.filter(t => t.status === 'BORROWED').length;
      const overdueBorrows = dbData.transactions.filter(t => t.status === 'BORROWED' && t.due_date < today).length;
      return makeJsonResponse({ totalItems, totalQty, availableQty, activeBorrows, overdueBorrows });
    }

    // 2. GET /api/items
    if (path.endsWith('/api/items') && method === 'GET') {
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const cat = url.searchParams.get('category') || 'ALL';
      let list = dbData.items.filter(i => {
        const matchSearch = !search || i.name.toLowerCase().includes(search) || i.code.toLowerCase().includes(search) || (i.location || '').toLowerCase().includes(search);
        const matchCat = !cat || cat === 'ALL' || i.category === cat;
        return matchSearch && matchCat;
      });
      list.sort((a, b) => b.id - a.id);
      return makeJsonResponse(list);
    }

    // 3. GET /api/items/code/:code
    const codeMatch = path.match(/\/api\/items\/code\/(.+)$/);
    if (codeMatch && method === 'GET') {
      const code = decodeURIComponent(codeMatch[1]).trim().toUpperCase();
      const item = dbData.items.find(i => i.code.toUpperCase() === code);
      if (!item) return makeJsonResponse({ error: 'ไม่พบอุปกรณ์ที่ตรงกับรหัสนี้' }, 404);
      const activeTx = dbData.transactions
        .filter(t => t.item_id === item.id && t.status === 'BORROWED')
        .sort((a, b) => a.due_date.localeCompare(b.due_date));
      return makeJsonResponse({ item, activeTx });
    }

    // 4. POST /api/items
    if (path.endsWith('/api/items') && method === 'POST') {
      const { code, name, category, location, total_qty, unit, description } = body;
      if (!code || !name) return makeJsonResponse({ error: 'กรุณาระบุรหัสอุปกรณ์และชื่ออุปกรณ์' }, 400);
      if (dbData.items.some(i => i.code.toUpperCase() === code.trim().toUpperCase())) {
        return makeJsonResponse({ error: 'รหัสอุปกรณ์ (Barcode/QR) นี้มีอยู่ในระบบแล้ว' }, 400);
      }
      const qty = parseInt(total_qty, 10) || 1;
      const newItem = {
        id: dbData.nextItemId++,
        code: code.trim().toUpperCase(),
        name: name.trim(),
        category: category || 'ทั่วไป',
        location: location || '',
        total_qty: qty,
        available_qty: qty,
        unit: unit || 'ชิ้น',
        description: description || ''
      };
      dbData.items.push(newItem);
      saveLocalDb(dbData);
      return makeJsonResponse({ success: true, id: newItem.id });
    }

    // 5. PUT & DELETE /api/items/:id
    const itemIdMatch = path.match(/\/api\/items\/(\d+)$/);
    if (itemIdMatch) {
      const id = Number(itemIdMatch[1]);
      const idx = dbData.items.findIndex(i => i.id === id);
      if (idx === -1) return makeJsonResponse({ error: 'ไม่พบอุปกรณ์' }, 404);

      if (method === 'PUT') {
        const current = dbData.items[idx];
        const newTotal = parseInt(body.total_qty, 10) || 1;
        const diff = newTotal - current.total_qty;
        const newAvailable = Math.max(0, current.available_qty + diff);
        dbData.items[idx] = {
          ...current,
          code: (body.code || current.code).trim().toUpperCase(),
          name: (body.name || current.name).trim(),
          category: body.category || 'ทั่วไป',
          location: body.location || '',
          total_qty: newTotal,
          available_qty: newAvailable,
          unit: body.unit || 'ชิ้น',
          description: body.description || ''
        };
        saveLocalDb(dbData);
        return makeJsonResponse({ success: true });
      }

      if (method === 'DELETE') {
        const hasActive = dbData.transactions.some(t => t.item_id === id && t.status === 'BORROWED');
        if (hasActive) return makeJsonResponse({ error: 'ไม่สามารถลบได้เนื่องจากมีรายการที่ยังไม่ส่งคืน' }, 400);
        dbData.items.splice(idx, 1);
        saveLocalDb(dbData);
        return makeJsonResponse({ success: true });
      }
    }

    // 6. POST /api/borrow
    if (path.endsWith('/api/borrow') && method === 'POST') {
      const { item_code, borrower_name, borrower_contact, borrower_dept, purpose, due_date, qty } = body;
      const borrowQty = parseInt(qty, 10) || 1;
      if (!item_code || !borrower_name || !borrower_contact || !due_date) {
        return makeJsonResponse({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' }, 400);
      }
      const item = dbData.items.find(i => i.code.toUpperCase() === item_code.trim().toUpperCase());
      if (!item) return makeJsonResponse({ error: 'ไม่พบอุปกรณ์รหัสนี้' }, 404);
      if (item.available_qty < borrowQty) {
        return makeJsonResponse({ error: `อุปกรณ์คงเหลือไม่พอ (เหลือเพียง ${item.available_qty} ${item.unit})` }, 400);
      }
      item.available_qty -= borrowQty;
      const newTx = {
        id: dbData.nextTxId++,
        item_id: item.id,
        item_code: item.code,
        item_name: item.name,
        borrower_name: borrower_name.trim(),
        borrower_contact: borrower_contact.trim(),
        borrower_dept: borrower_dept || '',
        purpose: purpose || '',
        qty: borrowQty,
        borrowed_at: getNowDateTimeStr(0),
        due_date,
        returned_at: null,
        status: 'BORROWED',
        notes: ''
      };
      dbData.transactions.push(newTx);
      saveLocalDb(dbData);

      const lineMsg = `\n📦 [บันทึกการยืมอุปกรณ์]\n• อุปกรณ์: ${item.name} (${item.code})\n• จำนวน: ${borrowQty} ${item.unit}\n• ผู้ยืม: ${borrower_name} (${borrower_dept || '-'})\n• กำหนดคืน: ${due_date}`;
      sendWebhookIfConfigured(dbData, lineMsg);
      return makeJsonResponse({ success: true, message: 'บันทึกการยืมสำเร็จ' });
    }

    // 7. POST /api/return
    if (path.endsWith('/api/return') && method === 'POST') {
      const { transaction_id, return_notes } = body;
      const tx = dbData.transactions.find(t => t.id === Number(transaction_id));
      if (!tx) return makeJsonResponse({ error: 'ไม่พบข้อมูลรายการยืม' }, 404);
      if (tx.status === 'RETURNED') return makeJsonResponse({ error: 'รายการนี้ได้รับการส่งคืนไปแล้ว' }, 400);

      tx.status = 'RETURNED';
      tx.returned_at = getNowDateTimeStr(0);
      tx.notes = return_notes || '';

      const item = dbData.items.find(i => i.id === tx.item_id);
      if (item) item.available_qty = Math.min(item.total_qty, item.available_qty + tx.qty);
      saveLocalDb(dbData);

      const lineMsg = `\n✅ [บันทึกการคืนอุปกรณ์]\n• อุปกรณ์: ${tx.item_name} (${tx.item_code})\n• ผู้ส่งคืน: ${tx.borrower_name}\n• สภาพ: ${return_notes || 'ปกติ'}`;
      sendWebhookIfConfigured(dbData, lineMsg);
      return makeJsonResponse({ success: true, message: 'บันทึกการคืนสำเร็จ' });
    }

    // 8. GET /api/transactions
    if (path.endsWith('/api/transactions') && method === 'GET') {
      const status = url.searchParams.get('status') || 'ALL';
      const search = (url.searchParams.get('search') || '').toLowerCase();
      let list = dbData.transactions.map(t => ({
        ...t,
        is_overdue: (t.status === 'BORROWED' && t.due_date < today) ? 1 : 0
      })).filter(t => {
        const matchSearch = !search || t.item_name.toLowerCase().includes(search) || t.item_code.toLowerCase().includes(search) || t.borrower_name.toLowerCase().includes(search);
        if (!matchSearch) return false;
        if (status === 'BORROWED') return t.status === 'BORROWED';
        if (status === 'RETURNED') return t.status === 'RETURNED';
        if (status === 'OVERDUE') return t.status === 'BORROWED' && t.due_date < today;
        return true;
      });
      list.sort((a, b) => b.id - a.id);
      return makeJsonResponse(list);
    }

    // 9. GET / POST /api/settings
    if (path.endsWith('/api/settings')) {
      if (method === 'GET') return makeJsonResponse(dbData.settings || {});
      if (method === 'POST') {
        dbData.settings = {
          ...dbData.settings,
          line_notify_token: (body.line_notify_token || '').trim(),
          line_webhook_url: (body.line_webhook_url || '').trim()
        };
        saveLocalDb(dbData);
        return makeJsonResponse({ success: true, message: 'บันทึกการตั้งค่าแล้ว' });
      }
    }

    // 10. POST /api/test-notify & /api/trigger-alert
    if (path.endsWith('/api/test-notify') && method === 'POST') {
      const sent = await sendWebhookIfConfigured(dbData, '🔔 ทดสอบการแจ้งเตือนจากระบบ Asset Tracker');
      return makeJsonResponse({ success: true, sent });
    }
    if (path.endsWith('/api/trigger-alert') && method === 'POST') {
      const dues = dbData.transactions.filter(t => t.status === 'BORROWED');
      await sendWebhookIfConfigured(dbData, `📢 แจ้งเตือนรายการยืมค้างส่งจำนวน ${dues.length} รายการ`);
      return makeJsonResponse({ success: true, message: `ตรวจสอบและแจ้งเตือนรายการค้างส่ง (${dues.length} รายการ) เรียบร้อยแล้ว` });
    }

    // 11. GET /api/categories
    if (path.endsWith('/api/categories') && method === 'GET') {
      const cats = [...new Set(dbData.items.map(i => i.category).filter(Boolean))];
      return makeJsonResponse(cats);
    }

    return makeJsonResponse({ error: 'Not found' }, 404);
  }

  const originalFetch = window.fetch.bind(window);
  let useLocalFallback = window.location.hostname.includes('github.io') || window.location.hostname.includes('vercel.app') || window.location.protocol === 'file:';

  window.fetch = async function(input, init) {
    const urlStr = typeof input === 'string' ? input : input.url;
    if (urlStr.includes('/api/')) {
      if (useLocalFallback) {
        return handleLocalApi(urlStr, init);
      }
      try {
        const res = await originalFetch(input, init);
        if (!res.ok && res.status === 404 && !res.headers.get('content-type')?.includes('application/json')) {
          useLocalFallback = true;
          return handleLocalApi(urlStr, init);
        }
        return res;
      } catch (err) {
        useLocalFallback = true;
        return handleLocalApi(urlStr, init);
      }
    }
    return originalFetch(input, init);
  };
})();

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  try {
    if (window.lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  } catch (e) {
    console.warn('Lucide icons init error:', e);
  }
  
  // Set default due date to 3 days from now
  try {
    const defaultDueDate = new Date();
    defaultDueDate.setDate(defaultDueDate.getDate() + 3);
    const dueInput = document.getElementById('borrow-due-date');
    if (dueInput) {
      dueInput.value = defaultDueDate.toISOString().split('T')[0];
    }
  } catch (e) {
    console.warn('Date init error:', e);
  }

  // Load Initial Data
  loadDashboard();
  loadItems();
  loadCategories();
  loadSettings();
  setupDemoButtons();
});

// Switch Tab Navigation
function switchTab(tabId) {
  currentTab = tabId;
  const tabs = ['dashboard', 'scanner', 'items', 'transactions', 'settings'];
  
  tabs.forEach(t => {
    const section = document.getElementById(`tab-${t}`);
    const navBtn = document.getElementById(`nav-${t}`);
    
    if (t === tabId) {
      if (section) section.classList.remove('hidden');
      if (navBtn) {
        navBtn.classList.add('bg-blue-50', 'text-blue-600');
        navBtn.classList.remove('text-slate-600');
      }
    } else {
      if (section) section.classList.add('hidden');
      if (navBtn) {
        navBtn.classList.remove('bg-blue-50', 'text-blue-600');
        navBtn.classList.add('text-slate-600');
      }
    }
  });

  // Re-run icons update
  lucide.createIcons();

  // Tab specific refreshes
  if (tabId === 'dashboard') loadDashboard();
  if (tabId === 'items') loadItems();
  if (tabId === 'transactions') loadTransactions();

  // Stop camera if navigating away from scanner
  if (tabId !== 'scanner' && isCameraRunning) {
    toggleCameraScanner();
  }
}

// ================= DASHBOARD =================
async function loadDashboard() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    
    document.getElementById('stat-total-items').textContent = data.totalItems;
    document.getElementById('stat-available-qty').textContent = data.availableQty;
    document.getElementById('stat-active-borrows').textContent = data.activeBorrows;
    document.getElementById('stat-overdue-borrows').textContent = data.overdueBorrows;

    // Load active borrows for the dashboard table
    const txRes = await fetch('/api/transactions?status=BORROWED');
    const txData = await txRes.json();
    
    const tbody = document.getElementById('dashboard-active-tx-body');
    if (txData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">ไม่มีรายการค้างคืนในขณะนี้ (อุปกรณ์ทั้งหมดอยู่ในคลัง)</td></tr>`;
      return;
    }

    tbody.innerHTML = txData.map(tx => {
      const isOverdue = tx.is_overdue === 1;
      const statusBadge = isOverdue
        ? `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-100 text-rose-700 animate-pulse">เกินกำหนดส่ง</span>`
        : `<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">กำลังยืม</span>`;

      return `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100">
          <td class="py-3 px-4 font-medium text-slate-800">
            <div>${escapeHtml(tx.item_name)}</div>
            <div class="text-xs text-blue-600 font-mono">${escapeHtml(tx.item_code)} (${tx.qty} ชิ้น)</div>
          </td>
          <td class="py-3 px-4">
            <div class="font-medium text-slate-700">${escapeHtml(tx.borrower_name)}</div>
            <div class="text-xs text-slate-400">โทร: ${escapeHtml(tx.borrower_contact)} ${tx.borrower_dept ? `(${escapeHtml(tx.borrower_dept)})` : ''}</div>
          </td>
          <td class="py-3 px-4 text-xs text-slate-500">${escapeHtml(tx.purpose || '-')}</td>
          <td class="py-3 px-4 text-xs text-slate-500">${tx.borrowed_at.split(' ')[0]}</td>
          <td class="py-3 px-4 font-medium text-xs ${isOverdue ? 'text-rose-600 font-bold' : 'text-slate-600'}">${tx.due_date}</td>
          <td class="py-3 px-4">${statusBadge}</td>
          <td class="py-3 px-4 text-right">
            <button onclick="openReturnConfirmModal(${tx.id}, '${escapeHtml(tx.item_name)}', '${escapeHtml(tx.borrower_name)}', ${tx.qty})" 
              class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition border border-emerald-200">
              รับคืนของ
            </button>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

// ================= BARCODE / QR SCANNER =================
function toggleCameraScanner() {
  const container = document.getElementById('reader-placeholder');
  const btn = document.getElementById('btn-toggle-camera');

  if (isCameraRunning) {
    if (html5QrCode) {
      html5QrCode.stop().then(() => {
        isCameraRunning = false;
        btn.textContent = 'เปิดกล้อง';
        btn.classList.remove('bg-rose-50', 'text-rose-600');
        btn.classList.add('bg-blue-50', 'text-blue-600');
        if (container) container.classList.remove('hidden');
      }).catch(err => console.error(err));
    }
  } else {
    html5QrCode = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    
    html5QrCode.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        // Scanned successfully!
        console.log(`Scan result: ${decodedText}`);
        showToast(`สแกนพบรหัส: ${decodedText}`, 'success');
        searchItemByCode(decodedText);
      },
      (errorMessage) => {
        // scan parse error, ignore normal empty frames
      }
    ).then(() => {
      isCameraRunning = true;
      btn.textContent = 'ปิดกล้อง';
      btn.classList.remove('bg-blue-50', 'text-blue-600');
      btn.classList.add('bg-rose-50', 'text-rose-600');
      if (container) container.classList.add('hidden');
    }).catch(err => {
      showToast('ไม่สามารถเข้าถึงกล้องได้: ' + err, 'error');
    });
  }
}

function handleManualSearch(e) {
  e.preventDefault();
  const input = document.getElementById('manual-code-input');
  const code = input.value.trim();
  if (code) {
    searchItemByCode(code);
  }
}

async function searchItemByCode(code) {
  try {
    const res = await fetch(`/api/items/code/${encodeURIComponent(code)}`);
    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || 'ไม่พบอุปกรณ์รหัสนี้', 'error');
      return;
    }
    const data = await res.json();
    renderScannedItem(data);
  } catch (err) {
    showToast('เกิดข้อผิดพลาดในการค้นหา: ' + err.message, 'error');
  }
}

function renderScannedItem(data) {
  currentScannedItem = data;
  const { item, activeTx } = data;

  document.getElementById('scan-empty-state').classList.add('hidden');
  document.getElementById('scan-item-content').classList.remove('hidden');

  document.getElementById('scan-res-code').textContent = item.code;
  document.getElementById('scan-res-category').textContent = item.category;
  document.getElementById('scan-res-name').textContent = item.name;
  document.getElementById('scan-res-location').textContent = item.location ? `ที่เก็บ: ${item.location}` : 'ไม่ระบุที่เก็บ';

  const badge = document.getElementById('scan-stock-badge');
  const detail = document.getElementById('scan-stock-detail');
  
  if (item.available_qty > 0) {
    badge.className = 'inline-flex items-center px-3 py-1.5 rounded-xl font-bold text-sm bg-emerald-100 text-emerald-800';
    badge.innerHTML = `🟢 ว่างให้ยืม ${item.available_qty} ${item.unit}`;
  } else {
    badge.className = 'inline-flex items-center px-3 py-1.5 rounded-xl font-bold text-sm bg-rose-100 text-rose-800';
    badge.innerHTML = `🔴 ถูกยืมหมดแล้ว`;
  }
  detail.textContent = `ทั้งหมด ${item.total_qty} ${item.unit}`;

  // Update return tab counter
  document.getElementById('scan-return-count').textContent = activeTx.length;

  // Render return list
  const activeTxList = document.getElementById('scan-active-tx-list');
  if (activeTx.length === 0) {
    activeTxList.innerHTML = `<div class="p-6 text-center text-slate-400 bg-slate-50 rounded-xl">ไม่มีประวัติการยืมค้างอยู่สำหรับอุปกรณ์นี้</div>`;
  } else {
    activeTxList.innerHTML = activeTx.map(tx => `
      <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl flex justify-between items-center">
        <div>
          <h4 class="font-bold text-slate-800 text-sm">${escapeHtml(tx.borrower_name)} (${tx.qty} ${item.unit})</h4>
          <p class="text-xs text-slate-500">โทร: ${escapeHtml(tx.borrower_contact)} • แผนก: ${escapeHtml(tx.borrower_dept || '-')}</p>
          <p class="text-xs text-rose-600 font-medium mt-0.5">กำหนดส่ง: ${tx.due_date}</p>
        </div>
        <button onclick="openReturnConfirmModal(${tx.id}, '${escapeHtml(item.name)}', '${escapeHtml(tx.borrower_name)}', ${tx.qty})" 
          class="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-4 py-2 rounded-lg text-xs shadow-sm transition">
          รับคืน
        </button>
      </div>
    `).join('');
  }

  // Auto switch to borrow tab if available, else return tab
  if (item.available_qty > 0) {
    switchScanAction('borrow');
  } else {
    switchScanAction('return');
  }

  lucide.createIcons();
}

function switchScanAction(mode) {
  const borrowBtn = document.getElementById('scan-tab-borrow-btn');
  const returnBtn = document.getElementById('scan-tab-return-btn');
  const borrowForm = document.getElementById('scan-borrow-form');
  const returnSec = document.getElementById('scan-return-section');

  if (mode === 'borrow') {
    borrowBtn.className = 'py-2 px-4 text-sm font-semibold border-b-2 border-blue-600 text-blue-600';
    returnBtn.className = 'py-2 px-4 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-800';
    borrowForm.classList.remove('hidden');
    returnSec.classList.add('hidden');
  } else {
    borrowBtn.className = 'py-2 px-4 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-800';
    returnBtn.className = 'py-2 px-4 text-sm font-semibold border-b-2 border-blue-600 text-blue-600';
    borrowForm.classList.add('hidden');
    returnSec.classList.remove('hidden');
  }
}

async function submitScanBorrow(e) {
  e.preventDefault();
  if (!currentScannedItem) return;

  const payload = {
    item_code: currentScannedItem.item.code,
    borrower_name: document.getElementById('borrower-name').value,
    borrower_contact: document.getElementById('borrower-contact').value,
    borrower_dept: document.getElementById('borrower-dept').value,
    qty: document.getElementById('borrow-qty').value,
    due_date: document.getElementById('borrow-due-date').value,
    purpose: document.getElementById('borrow-purpose').value
  };

  try {
    const res = await fetch('/api/borrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    showToast('บันทึกการยืมอุปกรณ์สำเร็จ พร้อมแจ้งเตือนไปยัง LINE เรียบร้อย', 'success');
    
    // Refresh item details
    searchItemByCode(currentScannedItem.item.code);
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ================= RETURN FLOW =================
function openReturnConfirmModal(txId, itemName, borrowerName, qty) {
  currentReturnTxId = txId;
  document.getElementById('return-modal-item').textContent = itemName;
  document.getElementById('return-modal-borrower').textContent = borrowerName;
  document.getElementById('return-modal-qty').textContent = `${qty} รายการ`;
  document.getElementById('return-notes-input').value = 'อุปกรณ์ครบถ้วน สภาพปกติ';
  document.getElementById('return-modal').classList.remove('hidden');
}

function closeReturnModal() {
  document.getElementById('return-modal').classList.add('hidden');
}

async function confirmReturnSubmit() {
  if (!currentReturnTxId) return;

  const notes = document.getElementById('return-notes-input').value;
  try {
    const res = await fetch('/api/return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: currentReturnTxId, return_notes: notes })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    closeReturnModal();
    showToast('รับคืนอุปกรณ์เรียบร้อยแล้ว เพิ่มจำนวนสต็อกกลับเข้าคลังแล้ว', 'success');

    // Refresh views
    if (currentScannedItem) {
      searchItemByCode(currentScannedItem.item.code);
    }
    loadDashboard();
    loadTransactions();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ================= ITEMS DIRECTORY =================
async function loadItems() {
  try {
    const search = document.getElementById('item-search-input')?.value || '';
    const cat = document.getElementById('item-category-filter')?.value || 'ALL';

    const res = await fetch(`/api/items?search=${encodeURIComponent(search)}&category=${encodeURIComponent(cat)}`);
    const items = await res.json();

    const grid = document.getElementById('items-grid');
    if (items.length === 0) {
      grid.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400">ไม่พบรายการอุปกรณ์</div>`;
      return;
    }

    grid.innerHTML = items.map(item => {
      const isAvailable = item.available_qty > 0;
      return `
        <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
          <div>
            <div class="flex justify-between items-start mb-2">
              <span class="px-2 py-0.5 rounded text-xs font-mono font-bold bg-blue-50 text-blue-700">${escapeHtml(item.code)}</span>
              <span class="text-xs px-2 py-0.5 rounded-full font-semibold ${isAvailable ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
                ${isAvailable ? `ว่าง ${item.available_qty}/${item.total_qty} ${item.unit}` : `ถูกยืมหมด`}
              </span>
            </div>
            <h4 class="font-bold text-slate-800 text-base mb-1">${escapeHtml(item.name)}</h4>
            <p class="text-xs text-slate-400 mb-2 flex items-center space-x-1">
              <i data-lucide="tag" class="w-3.5 h-3.5"></i>
              <span>${escapeHtml(item.category)}</span>
              <span class="mx-1">•</span>
              <i data-lucide="map-pin" class="w-3.5 h-3.5"></i>
              <span>${escapeHtml(item.location || 'คลังกลาง')}</span>
            </p>
            ${item.description ? `<p class="text-xs text-slate-500 line-clamp-2 mb-3 bg-slate-50 p-2 rounded-lg">${escapeHtml(item.description)}</p>` : ''}
          </div>

          <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
            <button onclick="showQrModal('${escapeHtml(item.code)}', '${escapeHtml(item.name)}')" 
              class="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center space-x-1">
              <i data-lucide="qr-code" class="w-4 h-4"></i>
              <span>QR Label</span>
            </button>
            <div class="flex space-x-1">
              <button onclick="quickScanSelect('${escapeHtml(item.code)}')" class="px-2.5 py-1 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
                ทำรายการยืม-คืน
              </button>
              <button onclick="openEditItemModal(${JSON.stringify(item).replace(/"/g, '&quot;')})" class="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
                <i data-lucide="edit-3" class="w-4 h-4"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    lucide.createIcons();
  } catch (err) {
    console.error(err);
  }
}

async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    const categories = await res.json();
    const filterSelect = document.getElementById('item-category-filter');
    const dataList = document.getElementById('cat-suggestions');
    
    if (filterSelect) {
      filterSelect.innerHTML = `<option value="ALL">ทุกหมวดหมู่</option>` + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }
    if (dataList) {
      dataList.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">`).join('');
    }
  } catch (err) {
    console.error(err);
  }
}

// Quick Select Item into Scanner
function quickScanSelect(code) {
  switchTab('scanner');
  document.getElementById('manual-code-input').value = code;
  searchItemByCode(code);
}

// Modal Add/Edit
function openAddItemModal() {
  document.getElementById('item-modal-title').textContent = 'เพิ่มอุปกรณ์ใหม่เข้าคลัง';
  document.getElementById('item-form-id').value = '';
  document.getElementById('item-form').reset();
  document.getElementById('item-modal').classList.remove('hidden');
}

function openEditItemModal(item) {
  document.getElementById('item-modal-title').textContent = 'แก้ไขข้อมูลอุปกรณ์';
  document.getElementById('item-form-id').value = item.id;
  document.getElementById('item-form-code').value = item.code;
  document.getElementById('item-form-category').value = item.category;
  document.getElementById('item-form-name').value = item.name;
  document.getElementById('item-form-total').value = item.total_qty;
  document.getElementById('item-form-unit').value = item.unit;
  document.getElementById('item-form-location').value = item.location;
  document.getElementById('item-form-desc').value = item.description || '';
  document.getElementById('item-modal').classList.remove('hidden');
}

function closeItemModal() {
  document.getElementById('item-modal').classList.add('hidden');
}

async function saveItemSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('item-form-id').value;
  const payload = {
    code: document.getElementById('item-form-code').value,
    name: document.getElementById('item-form-name').value,
    category: document.getElementById('item-form-category').value,
    location: document.getElementById('item-form-location').value,
    total_qty: document.getElementById('item-form-total').value,
    unit: document.getElementById('item-form-unit').value,
    description: document.getElementById('item-form-desc').value
  };

  try {
    const url = id ? `/api/items/${id}` : '/api/items';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);

    closeItemModal();
    showToast(id ? 'อัปเดตข้อมูลอุปกรณ์เรียบร้อย' : 'เพิ่มอุปกรณ์ใหม่สำเร็จ', 'success');
    loadItems();
    loadCategories();
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ================= QR CODE GENERATION & PRINT =================
function showQrModal(code, name) {
  document.getElementById('qr-item-name').textContent = name;
  document.getElementById('qr-item-code').textContent = code;
  
  const container = document.getElementById('qrcode-container');
  container.innerHTML = '';
  
  new QRCode(container, {
    text: code,
    width: 160,
    height: 160,
    colorDark : "#0f172a",
    colorLight : "#ffffff",
    correctLevel : QRCode.CorrectLevel.H
  });

  document.getElementById('qr-modal').classList.remove('hidden');
  lucide.createIcons();
}

function closeQrModal() {
  document.getElementById('qr-modal').classList.add('hidden');
}

function printQrLabel() {
  const printContents = document.getElementById('print-area').innerHTML;
  const printWindow = window.open('', '', 'height=500, width=500');
  printWindow.document.write('<html><head><title>Print QR Label</title>');
  printWindow.document.write('<style>body{font-family:sans-serif;text-align:center;padding:20px;}</style>');
  printWindow.document.write('</head><body>');
  printWindow.document.write(printContents);
  printWindow.document.write('</body></html>');
  printWindow.document.close();
  printWindow.print();
}

// ================= TRANSACTIONS =================
function filterTxStatus(status) {
  currentTxStatusFilter = status;
  document.querySelectorAll('.tx-filter-btn').forEach(b => {
    if (b.dataset.status === status) {
      b.className = 'tx-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white';
    } else {
      b.className = 'tx-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50';
    }
  });
  loadTransactions();
}

async function loadTransactions() {
  try {
    const search = document.getElementById('tx-search-input')?.value || '';
    const res = await fetch(`/api/transactions?status=${currentTxStatusFilter}&search=${encodeURIComponent(search)}`);
    const transactions = await res.json();

    const tbody = document.getElementById('transactions-table-body');
    if (transactions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-slate-400">ไม่พบประวัติรายการยืม-คืน</td></tr>`;
      return;
    }

    tbody.innerHTML = transactions.map(tx => {
      let badge = '';
      if (tx.status === 'RETURNED') {
        badge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">คืนแล้ว</span>`;
      } else if (tx.is_overdue === 1) {
        badge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-700 animate-pulse">เกินกำหนดส่ง</span>`;
      } else {
        badge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">กำลังยืม</span>`;
      }

      return `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100">
          <td class="py-3 px-4 text-xs text-slate-400 font-mono">#${tx.id}</td>
          <td class="py-3 px-4 font-medium text-slate-800">
            <div>${escapeHtml(tx.item_name)}</div>
            <div class="text-xs text-blue-600 font-mono">${escapeHtml(tx.item_code)} (${tx.qty} ชิ้น)</div>
          </td>
          <td class="py-3 px-4">
            <div class="font-medium text-slate-700">${escapeHtml(tx.borrower_name)}</div>
            <div class="text-xs text-slate-400">${escapeHtml(tx.borrower_contact)} • ${escapeHtml(tx.borrower_dept || 'ทั่วไป')}</div>
          </td>
          <td class="py-3 px-4 text-xs text-slate-500">${escapeHtml(tx.purpose || '-')}</td>
          <td class="py-3 px-4 text-xs text-slate-500">${tx.borrowed_at.split(' ')[0]}</td>
          <td class="py-3 px-4 text-xs font-medium ${tx.is_overdue && tx.status === 'BORROWED' ? 'text-rose-600 font-bold' : 'text-slate-600'}">${tx.due_date}</td>
          <td class="py-3 px-4">${badge}</td>
          <td class="py-3 px-4 text-right">
            ${tx.status === 'BORROWED' ? `
              <button onclick="openReturnConfirmModal(${tx.id}, '${escapeHtml(tx.item_name)}', '${escapeHtml(tx.borrower_name)}', ${tx.qty})" 
                class="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition border border-emerald-200">
                รับคืน
              </button>
            ` : `<span class="text-xs text-slate-400">เสร็จสิ้น</span>`}
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  } catch (err) {
    console.error(err);
  }
}

// ================= SETTINGS & LINE NOTIFY =================
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    if (settings.line_notify_token) {
      document.getElementById('line-token-input').value = settings.line_notify_token;
    }
    if (settings.line_webhook_url) {
      document.getElementById('line-webhook-input').value = settings.line_webhook_url;
    }
  } catch (err) {
    console.error(err);
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const token = document.getElementById('line-token-input').value;
  const webhook = document.getElementById('line-webhook-input').value;

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_notify_token: token, line_webhook_url: webhook })
    });
    const data = await res.json();
    showToast(data.message || 'บันทึกสำเร็จ', 'success');
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

async function testNotification() {
  try {
    showToast('กำลังส่งสัญญาณแจ้งเตือนทดสอบ...', 'info');
    const res = await fetch('/api/test-notify', { method: 'POST' });
    const data = await res.json();
    if (data.sent) {
      showToast('ส่งแจ้งเตือนไปยัง LINE/Webhook สำเร็จแล้ว!', 'success');
    } else {
      showToast('ระบบส่งข้อความจำลองเรียบร้อย (ดูผลลัพธ์ใน Terminal/Console ได้)', 'info');
    }
  } catch (err) {
    showToast('ไม่สามารถส่งข้อความได้: ' + err.message, 'error');
  }
}

async function triggerManualAlert() {
  try {
    showToast('กำลังตรวจสอบและส่งรายงานอุปกรณ์ค้างส่ง...', 'info');
    const res = await fetch('/api/trigger-alert', { method: 'POST' });
    const data = await res.json();
    showToast(data.message, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Helpers
function openBorrowModalQuick() {
  switchTab('scanner');
  document.getElementById('manual-code-input').focus();
}

function setupDemoButtons() {
  const container = document.getElementById('quick-demo-buttons');
  if (!container) return;
  const demoCodes = ['CAM-001', 'MIC-101', 'LAB-OSC-01', 'TOOL-DRL-02', 'PRJ-EPS-01'];
  container.innerHTML = demoCodes.map(c => `
    <button onclick="quickScanSelect('${c}')" class="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 font-mono text-xs rounded-lg transition border border-slate-200">
      ${c}
    </button>
  `).join('');
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toast-msg');
  const iconEl = document.getElementById('toast-icon');

  msgEl.textContent = message;
  
  if (type === 'success') {
    iconEl.innerHTML = `<i data-lucide="check-circle" class="w-5 h-5 text-emerald-400"></i>`;
  } else if (type === 'error') {
    iconEl.innerHTML = `<i data-lucide="alert-circle" class="w-5 h-5 text-rose-400"></i>`;
  } else {
    iconEl.innerHTML = `<i data-lucide="info" class="w-5 h-5 text-blue-400"></i>`;
  }
  lucide.createIcons();

  toast.classList.remove('translate-y-20', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3500);
}

function escapeHtml(text) {
  if (!text) return '';
  return text.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
