/**
 * Notification service supporting LINE Messaging API / LINE Notify / Webhooks (e.g. Discord, Telegram, Custom HTTP)
 */
const db = require('./db');

async function sendLineNotification(message) {
  try {
    const notifyTokenRow = db.prepare("SELECT value FROM settings WHERE key = 'line_notify_token'").get();
    const webhookUrlRow = db.prepare("SELECT value FROM settings WHERE key = 'line_webhook_url'").get();
    
    const notifyToken = notifyTokenRow ? notifyTokenRow.value.trim() : '';
    const webhookUrl = webhookUrlRow ? webhookUrlRow.value.trim() : '';

    let sent = false;

    // 1. Try LINE Notify if token configured
    if (notifyToken) {
      try {
        const response = await fetch('https://notify-api.line.me/api/notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Bearer ${notifyToken}`
          },
          body: new URLSearchParams({ message: message })
        });
        const result = await response.json();
        console.log('[LINE Notify Result]', result);
        sent = true;
      } catch (err) {
        console.error('[LINE Notify Error]', err.message);
      }
    }

    // 2. Try Generic Webhook / Discord / Custom endpoint if configured
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: message, // for Discord
            text: message,    // for Slack / LINE webhook
            message: message
          })
        });
        console.log('[Webhook Notification Sent]');
        sent = true;
      } catch (err) {
        console.error('[Webhook Notification Error]', err.message);
      }
    }

    // Always log to console as fallback
    if (!sent) {
      console.log('--- [SIMULATED LINE NOTIFICATION] ---');
      console.log(message);
      console.log('------------------------------------');
    }

    return { success: true, sent };
  } catch (error) {
    console.error('sendLineNotification global error:', error);
    return { success: false, error: error.message };
  }
}

// Function to check overdue & approaching items
async function checkAndSendDueAlerts() {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Find overdue or due today
    const dues = db.prepare(`
      SELECT * FROM transactions 
      WHERE status = 'BORROWED' AND date(due_date) <= date('now', '+1 day')
      ORDER BY due_date ASC
    `).all();

    if (dues.length === 0) {
      console.log('[Auto-Alert] No items approaching due or overdue.');
      return;
    }

    let msg = `\n📢 [ระบบแจ้งเตือนคลังอุปกรณ์ Asset Tracker]\nพบรายการยืมที่ครบกำหนดหรือค้างคืน ${dues.length} รายการ:\n`;
    
    dues.forEach((tx, idx) => {
      const isOverdue = tx.due_date < today;
      const statusText = isOverdue ? '⚠️ [เกินกำหนดส่ง!]' : '⏰ [ครบกำหนดเร็วๆนี้]';
      msg += `\n${idx + 1}. ${statusText}\n`;
      msg += `• อุปกรณ์: ${tx.item_name} (${tx.item_code})\n`;
      msg += `• ผู้ยืม: ${tx.borrower_name} (${tx.borrower_dept || 'ทั่วไป'}) โทร: ${tx.borrower_contact}\n`;
      msg += `• กำหนดคืน: ${tx.due_date}\n`;
    });

    msg += `\nกรุณาติดต่อผู้ยืมหรือตรวจเช็กในระบบได้ที่หน้าจัดการครับ`;

    await sendLineNotification(msg);
  } catch (e) {
    console.error('Error checking due alerts:', e);
  }
}

module.exports = {
  sendLineNotification,
  checkAndSendDueAlerts
};
