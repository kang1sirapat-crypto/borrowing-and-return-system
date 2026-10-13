const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'inventory.db');
const db = new Database(dbPath);

// Enable foreign keys and WAL mode for performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,          -- Barcode / QR Code id (e.g. LAB-CAM-001)
      name TEXT NOT NULL,
      category TEXT DEFAULT 'ทั่วไป',
      location TEXT DEFAULT 'ห้องแล็บ 1',
      total_qty INTEGER DEFAULT 1,
      available_qty INTEGER DEFAULT 1,
      unit TEXT DEFAULT 'เครื่อง',
      image_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      item_code TEXT NOT NULL,
      item_name TEXT NOT NULL,
      borrower_name TEXT NOT NULL,
      borrower_contact TEXT NOT NULL,
      borrower_dept TEXT DEFAULT '',
      purpose TEXT DEFAULT '',
      qty INTEGER DEFAULT 1,
      borrowed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      due_date DATE NOT NULL,
      returned_at DATETIME,
      status TEXT DEFAULT 'BORROWED',      -- 'BORROWED', 'RETURNED', 'OVERDUE'
      notes TEXT DEFAULT '',
      FOREIGN KEY (item_id) REFERENCES items (id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Default settings (Line Notify / Line Token or Webhook)
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  insertSetting.run('line_notify_token', '');
  insertSetting.run('line_webhook_url', '');
  insertSetting.run('auto_alert_hour', '08:00'); // 8:00 AM daily check

  // Seed sample data if items table is empty
  const itemCount = db.prepare('SELECT COUNT(*) as count FROM items').get().count;
  if (itemCount === 0) {
    const insertItem = db.prepare(`
      INSERT INTO items (code, name, category, location, total_qty, available_qty, unit, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertItem.run('CAM-001', 'กล้อง Sony Alpha A6400 + เลนส์ 16-50mm', 'อุปกรณ์กล้อง/มีเดีย', 'ตู้เก็บกล้อง A1', 2, 2, 'ชุด', 'ชุดกล้องสำหรับงานบันทึกวิดีโอและภาพนิ่ง');
    insertItem.run('MIC-101', 'ไมโครโฟนไร้สาย DJI Mic 2 (ชุด 2 ตัวส่ง + 1 รับ)', 'อุปกรณ์เสียง', 'ตู้ A2', 3, 2, 'เซ็ต', 'ไมโครโฟนบันทึกเสียงไร้สายแบบพกพา');
    insertItem.run('LAB-OSC-01', 'Digital Oscilloscope Rigol DS1054Z', 'เครื่องมือวิทยาศาสตร์/แล็บ', 'โต๊ะทดลอง 3', 4, 3, 'เครื่อง', 'เครื่องวัดสัญญาณดิจิทัล 4 แชนเนล 50MHz');
    insertItem.run('TOOL-DRL-02', 'สว่านไร้สาย Bosch GSB 18V-50 พร้อมกล่องดอกสว่าน', 'เครื่องมือช่าง', 'ชั้นวางช่าง B', 2, 1, 'กล่อง', 'สว่านกระแทกไร้สาย มอเตอร์ไร้แปรงถ่าน');
    insertItem.run('PRJ-EPS-01', 'โปรเจกเตอร์ Epson EB-X51 (3,800 Lumens)', 'อุปกรณ์ห้องประชุม/นำเสนอ', 'ห้องพัสดุกลาง', 1, 1, 'เครื่อง', 'เครื่องฉายโปรเจกเตอร์ความสว่างสูง พร้อมสาย HDMI');
    
    // Seed initial active borrow for demonstration
    const insertTx = db.prepare(`
      INSERT INTO transactions (item_id, item_code, item_name, borrower_name, borrower_contact, borrower_dept, purpose, qty, borrowed_at, due_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-2 days'), date('now', '+1 day'), 'BORROWED')
    `);
    
    // Borrow 1 mic and 1 drill to show realistic status
    const micItem = db.prepare('SELECT * FROM items WHERE code = ?').get('MIC-101');
    if (micItem) {
      insertTx.run(micItem.id, micItem.code, micItem.name, 'สมชาย สายตรวจ', '089-111-2233', 'ฝ่ายโสตฯ', 'ใช้บันทึกเทปสัมมนาประจำปี', 1);
    }
    const drillItem = db.prepare('SELECT * FROM items WHERE code = ?').get('TOOL-DRL-02');
    if (drillItem) {
      insertTx.run(drillItem.id, drillItem.code, drillItem.name, 'กมล พัฒนา', '081-999-8877', 'ฝ่ายอาคาร', 'ซ่อมแซมแผงไฟห้องแล็บ', 1);
    }
  }
}

initDb();

module.exports = db;
