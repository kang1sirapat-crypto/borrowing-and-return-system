// State variables
let currentTab = 'dashboard';
let html5QrCode = null;
let isCameraRunning = false;
let currentScannedItem = null;
let currentReturnTxId = null;
let currentTxStatusFilter = 'ALL';

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
