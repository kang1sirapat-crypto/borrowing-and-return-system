const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const db = require('./db');
const { sendLineNotification, checkAndSendDueAlerts } = require('./notifier');

const app = express();
const PORT = process.env.PORT || 3001; // Port 3001 (แยกจาก merchant-tracker ที่ใช้ Port 3000)

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----------------- API ROUTES -----------------

// 1. Dashboard summary stats
app.get('/api/stats', (req, res) => {
  try {
    const totalItems = db.prepare('SELECT COUNT(*) as count FROM items').get().count;
    const totalQty = db.prepare('SELECT COALESCE(SUM(total_qty), 0) as count FROM items').get().count;
    const availableQty = db.prepare('SELECT COALESCE(SUM(available_qty), 0) as count FROM items').get().count;
    const activeBorrows = db.prepare("SELECT COUNT(*) as count FROM transactions WHERE status = 'BORROWED'").get().count;
    
    const today = new Date().toISOString().split('T')[0];
    const overdueBorrows = db.prepare(`
      SELECT COUNT(*) as count FROM transactions 
      WHERE status = 'BORROWED' AND date(due_date) < date(?)
    `).get(today).count;

    res.json({
      totalItems,
      totalQty,
      availableQty,
      activeBorrows,
      overdueBorrows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Items List & Search
app.get('/api/items', (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const category = req.query.category || '';

    let query = 'SELECT * FROM items WHERE (name LIKE ? OR code LIKE ? OR location LIKE ?)';
    let params = [search, search, search];

    if (category && category !== 'ALL') {
      query += ' AND category = ?';
      params.push(category);
    }
    query += ' ORDER BY id DESC';

    const items = db.prepare(query).all(...params);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get item by Code (Scan Barcode / QR)
app.get('/api/items/code/:code', (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM items WHERE code = ?').get(req.params.code.trim());
    if (!item) {
      return res.status(404).json({ error: 'ไม่พบอุปกรณ์ที่ตรงกับรหัสนี้' });
    }

    // Also get active borrows for this item
    const activeTx = db.prepare(`
      SELECT * FROM transactions 
      WHERE item_id = ? AND status = 'BORROWED' 
      ORDER BY due_date ASC
    `).all(item.id);

    res.json({ item, activeTx });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Create new item
app.post('/api/items', (req, res) => {
  try {
    const { code, name, category, location, total_qty, unit, description } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: 'กรุณาระบุรหัสอุปกรณ์และชื่ออุปกรณ์' });
    }

    const qty = parseInt(total_qty, 10) || 1;
    const stmt = db.prepare(`
      INSERT INTO items (code, name, category, location, total_qty, available_qty, unit, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      code.trim(),
      name.trim(),
      category || 'ทั่วไป',
      location || '',
      qty,
      qty,
      unit || 'ชิ้น',
      description || ''
    );

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'รหัสอุปกรณ์ (Barcode/QR) นี้มีอยู่ในระบบแล้ว' });
    }
    res.status(500).json({ error: err.message });
  }
});

// 5. Update item
app.put('/api/items/:id', (req, res) => {
  try {
    const { code, name, category, location, total_qty, unit, description } = req.body;
    const current = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'ไม่พบอุปกรณ์' });

    const newTotal = parseInt(total_qty, 10) || 1;
    const diff = newTotal - current.total_qty;
    const newAvailable = Math.max(0, current.available_qty + diff);

    const stmt = db.prepare(`
      UPDATE items 
      SET code = ?, name = ?, category = ?, location = ?, total_qty = ?, available_qty = ?, unit = ?, description = ?
      WHERE id = ?
    `);

    stmt.run(code.trim(), name.trim(), category, location, newTotal, newAvailable, unit, description, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Delete item
app.delete('/api/items/:id', (req, res) => {
  try {
    const active = db.prepare("SELECT COUNT(*) as count FROM transactions WHERE item_id = ? AND status = 'BORROWED'").get(req.params.id);
    if (active.count > 0) {
      return res.status(400).json({ error: 'ไม่สามารถลบได้เนื่องจากมีรายการที่ยังไม่ส่งคืน' });
    }

    db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Borrow item (บันทึกการยืม)
app.post('/api/borrow', async (req, res) => {
  try {
    const { item_code, borrower_name, borrower_contact, borrower_dept, purpose, due_date, qty } = req.body;
    const borrowQty = parseInt(qty, 10) || 1;

    if (!item_code || !borrower_name || !borrower_contact || !due_date) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน (รหัสอุปกรณ์, ชื่อผู้ยืม, เบอร์ติดต่อ, กำหนดคืน)' });
    }

    const item = db.prepare('SELECT * FROM items WHERE code = ?').get(item_code.trim());
    if (!item) {
      return res.status(404).json({ error: 'ไม่พบอุปกรณ์รหัสนี้' });
    }

    if (item.available_qty < borrowQty) {
      return res.status(400).json({ error: `อุปกรณ์คงเหลือไม่พอ (เหลือเพียง ${item.available_qty} ${item.unit})` });
    }

    // Transaction atomic update
    const borrowTx = db.transaction(() => {
      // 1. insert transaction
      const stmt = db.prepare(`
        INSERT INTO transactions (item_id, item_code, item_name, borrower_name, borrower_contact, borrower_dept, purpose, qty, due_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'BORROWED')
      `);
      stmt.run(item.id, item.code, item.name, borrower_name.trim(), borrower_contact.trim(), borrower_dept || '', purpose || '', borrowQty, due_date);

      // 2. decrement available qty
      db.prepare('UPDATE items SET available_qty = available_qty - ? WHERE id = ?').run(borrowQty, item.id);
    });

    borrowTx();

    // Send Line Notification Alert for Borrow Event
    const lineMsg = `\n📦 [บันทึกการยืมอุปกรณ์]\n` +
      `• อุปกรณ์: ${item.name} (${item.code})\n` +
      `• จำนวน: ${borrowQty} ${item.unit}\n` +
      `• ผู้ยืม: ${borrower_name} (${borrower_dept || '-'})\n` +
      `• เบอร์ติดต่อ: ${borrower_contact}\n` +
      `• วัตถุประสงค์: ${purpose || '-'}\n` +
      `• กำหนดคืน: ${due_date}`;
    sendLineNotification(lineMsg).catch(console.error);

    res.json({ success: true, message: 'บันทึกการยืมสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Return item (บันทึกการคืน)
app.post('/api/return', async (req, res) => {
  try {
    const { transaction_id, return_notes } = req.body;
    if (!transaction_id) {
      return res.status(400).json({ error: 'กรุณาระบุรหัสรายการยืม-คืน' });
    }

    const tx = db.prepare("SELECT * FROM transactions WHERE id = ?").get(transaction_id);
    if (!tx) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลรายการยืม' });
    }
    if (tx.status === 'RETURNED') {
      return res.status(400).json({ error: 'รายการนี้ได้รับการส่งคืนไปแล้ว' });
    }

    const returnTx = db.transaction(() => {
      // 1. update transaction status
      db.prepare(`
        UPDATE transactions 
        SET status = 'RETURNED', returned_at = CURRENT_TIMESTAMP, notes = ?
        WHERE id = ?
      `).run(return_notes || '', tx.id);

      // 2. increment available qty
      db.prepare('UPDATE items SET available_qty = available_qty + ? WHERE id = ?').run(tx.qty, tx.item_id);
    });

    returnTx();

    // Send Line Notification Alert for Return Event
    const lineMsg = `\n✅ [บันทึกการคืนอุปกรณ์]\n` +
      `• อุปกรณ์: ${tx.item_name} (${tx.item_code})\n` +
      `• จำนวน: ${tx.qty}\n` +
      `• ผู้ส่งคืน: ${tx.borrower_name}\n` +
      `• วันที่ยืม: ${tx.borrowed_at.split(' ')[0]}\n` +
      `• บันทึกสภาพ: ${return_notes || 'ปกติ'}`;
    sendLineNotification(lineMsg).catch(console.error);

    res.json({ success: true, message: 'บันทึกการคืนสำเร็จ' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Transactions History & Filter
app.get('/api/transactions', (req, res) => {
  try {
    const status = req.query.status || 'ALL'; // 'ALL', 'BORROWED', 'RETURNED', 'OVERDUE'
    const search = req.query.search ? `%${req.query.search}%` : '%';
    const today = new Date().toISOString().split('T')[0];

    let query = `
      SELECT t.*, 
        CASE 
          WHEN t.status = 'BORROWED' AND date(t.due_date) < date(?) THEN 1 
          ELSE 0 
        END as is_overdue
      FROM transactions t 
      WHERE (t.item_name LIKE ? OR t.item_code LIKE ? OR t.borrower_name LIKE ?)
    `;
    let params = [today, search, search, search];

    if (status === 'BORROWED') {
      query += " AND t.status = 'BORROWED'";
    } else if (status === 'RETURNED') {
      query += " AND t.status = 'RETURNED'";
    } else if (status === 'OVERDUE') {
      query += " AND t.status = 'BORROWED' AND date(t.due_date) < date(?)";
      params.push(today);
    }

    query += ' ORDER BY t.id DESC LIMIT 200';
    const transactions = db.prepare(query).all(...params);
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Settings API (Get & Save LINE Token / Webhook)
app.get('/api/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const { line_notify_token, line_webhook_url } = req.body;
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    if (line_notify_token !== undefined) stmt.run('line_notify_token', line_notify_token.trim());
    if (line_webhook_url !== undefined) stmt.run('line_webhook_url', line_webhook_url.trim());
    res.json({ success: true, message: 'บันทึกการตั้งค่าแล้ว' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Test Notification
app.post('/api/test-notify', async (req, res) => {
  try {
    const result = await sendLineNotification('\n🔔 ทดสอบการแจ้งเตือนจากระบบ Asset Tracker\nระบบเชื่อมต่อการแจ้งเตือนสำเร็จ!');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Trigger Manual Check Due Alert
app.post('/api/trigger-alert', async (req, res) => {
  try {
    await checkAndSendDueAlerts();
    res.json({ success: true, message: 'ส่งการแจ้งเตือนรายการใกล้ครบกำหนด/ค้างส่งแล้ว' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Categories
app.get('/api/categories', (req, res) => {
  try {
    const rows = db.prepare('SELECT DISTINCT category FROM items WHERE category IS NOT NULL AND category != ""').all();
    res.json(rows.map(r => r.category));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Scheduled cron job (run every morning at 08:30)
cron.schedule('30 8 * * *', () => {
  console.log('[CRON] Running daily due check...');
  checkAndSendDueAlerts();
});

const os = require('os');

// Get local network IP for sharing with others
function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && net.address.startsWith('192.168.')) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log(`\n✅ ระบบคลังอุปกรณ์ Asset & Stock Tracker พร้อมใช้งาน!`);
  console.log(`─────────────────────────────────────────────`);
  console.log(`  📌 เครื่องตัวเอง   : http://localhost:${PORT}`);
  console.log(`  🌐 คนในวง Wi-Fi    : http://${localIP}:${PORT}`);
  console.log(`─────────────────────────────────────────────`);
  console.log(`  (ต้องอยู่ใน Wi-Fi/LAN เดียวกันเท่านั้น)\n`);
});
