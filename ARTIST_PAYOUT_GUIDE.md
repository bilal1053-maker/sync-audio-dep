# Artist Payout - Monthly Automation Guide

## 🎯 Overview
The `artist_payout.js` script now runs **automatically on the 1st of every month** via the cron job system.

---

## 📊 How It Works

### **1. The 50% Artist Share Calculation**

Located at **line 145** in `artist_payout.js`:

```javascript
const track = {
    "amount": parseFloat(element.amount) * 0.5,  // 50% to artist
    // ...
};
```

**Breakdown:**
- Customer pays full price for track license
- Transaction amount is stored in `transaction_tracks.amount`
- Artist receives **50%** of that amount
- Remaining 50% is platform revenue

**Example:**
- Track license sold for £100
- Artist receives: £100 × 0.5 = **£50**
- Platform keeps: **£50**

---

### **2. Tracking Paid vs Unpaid Transactions**

The script uses the `sender_item_id` field to track payment status:

**SQL Query:**
```sql
SELECT tracks.email, amount, transaction_tracks.track_id, ...
FROM transaction_tracks 
JOIN transactions ON transactions.transaction_id = transaction_tracks.transaction_id 
JOIN tracks ON tracks.track_id = transaction_tracks.track_id 
WHERE sender_item_id IS NULL           -- Not yet paid out
  AND email IS NOT NULL                -- Artist has email
```

**How it works:**
- `sender_item_id IS NULL` = Transaction **not yet paid**
- `sender_item_id IS NOT NULL` = Transaction **already paid**

When a payout is processed, the `sender_item_id` is updated (line 30), marking it as paid:
```javascript
await db.query("UPDATE transaction_tracks SET sender_item_id = ? WHERE ...", where);
```

**Example:**
- Customer buys track on Dec 15, 2025 → `sender_item_id = NULL`
- Cron runs Jan 1, 2026 → Processes payout → `sender_item_id = 12345`
- Cron runs Feb 1, 2026 → Skips this transaction (already paid)

This means the monthly cron job processes **ALL unpaid transactions**, regardless of when they occurred.

---

## 🔄 Two Ways to Run

### **1. Automatic (Monthly Cron Job)** ✅ RECOMMENDED
Runs on the **1st of every month at 00:00** automatically.

- ✅ Processes all unpaid transactions (`sender_item_id IS NULL`)
- ✅ Integrated with your server
- ✅ No manual intervention needed

**What happens:**
```
============================================================
🎉 MONTHLY CRON JOB TRIGGERED!
📅 Date: 1-January-2026
⏰ Time: 12:00:00 AM
============================================================
Starting monthly tasks...
💰 Task 1: Processing artist payouts...
💰 Processing artist payouts for all unpaid transactions...
💰 Found 15 unpaid transaction(s) to process
✅ Artist payouts completed
   📊 Processed 15 transaction(s)
```

---

### **2. Manual Execution**
Run manually when needed:

```bash
node artist_payout.js
```

**Behavior:**
- ✅ Same as automatic mode
- Processes **ALL unpaid transactions** (`sender_item_id IS NULL`)
- Useful for:
  - Testing the payout system
  - Running payouts outside the monthly schedule
  - Emergency payout processing

**Output:**
```
🚀 Running artist payout script manually...
💰 Processing artist payouts for all unpaid transactions...
💰 Found 45 unpaid transaction(s) to process
Create Payout Response
{"batch_header": {...}}
✅ Artists paid out successfully
📊 Processed 45 transaction(s)
```

---

## 🗄️ Database Flow

### **Tables Involved:**

1. **`transactions`** - Main transaction records
   - `transaction_id` (PK)
   - `date_created` - Used for date filtering
   - `paypal_status`

2. **`transaction_tracks`** - Links transactions to tracks
   - `track_id` + `transaction_id` (composite key)
   - `amount` - Full transaction amount
   - `sender_item_id` - NULL until paid, then set to payout ID

3. **`tracks`** - Track information
   - `track_id` (PK)
   - `email` - Artist's PayPal email
   - `title`, `artist`

4. **`artist_payout`** - Payout records
   - `sender_item_id` (PK, auto-increment)
   - `time_created`
   - `transaction_status`
   - `amount`, `currency`
   - `receiver` (artist email)

### **Process Flow:**

```
1. Query unpaid transactions (sender_item_id IS NULL)
   ↓
2. Group by artist email
   ↓
3. Calculate 50% for each track
   ↓
4. Create PayPal batch payout
   ↓
5. Insert record into artist_payout table
   ↓
6. Update transaction_tracks.sender_item_id
   ↓
7. Send PayPal batch
   ↓
8. Update artist_payout with PayPal response
```

---

## 🧪 Testing

### **Test the Cron Job (Every Minute)**

Temporarily modify `cronJobs.js` line 17:

```javascript
// Change from:
const monthlyJob = cron.schedule('0 0 1 * *', () => {

// To:
const monthlyJob = cron.schedule('* * * * *', () => {
```

Restart your server and watch it run every minute.

**⚠️ Remember to change it back!**

---

### **Test Manual Execution**

```bash
node artist_payout.js
```

---

## 📋 Configuration

### **Cron Schedule**
File: `cronJobs.js` (line 17)

```javascript
'0 0 1 * *'  // Midnight on 1st of every month
```

### **Timezone**
File: `cronJobs.js` (line 29)

```javascript
timezone: "Asia/Kolkata"  // IST
```

### **PayPal Configuration**
File: `artist_payout.js` (line 6)

```javascript
paypal.configure(config.paypal_sdk);
```

Make sure your `config.js` has valid PayPal credentials.

---

## 🔍 Monitoring & Logs

### **What to Monitor:**

1. **Server startup logs:**
   ```
   ✅ Monthly cron job scheduled: Runs on 1st of every month at 00:00
   ```

2. **Monthly execution logs:**
   ```
   🎉 MONTHLY CRON JOB TRIGGERED!
   💰 Task 1: Processing artist payouts...
   💰 Processing artist payouts for all unpaid transactions...
   💰 Found X unpaid transaction(s) to process
   ```

3. **PayPal responses:**
   ```
   Create Payout Response
   {"batch_header": {"batch_status": "SUCCESS", ...}}
   ```

### **Common Scenarios:**

| Log Message | Meaning |
|-------------|---------|
| `No unpaid transactions found` | All transactions already paid |
| `Found X unpaid transaction(s)` | Processing X unpaid transactions |
| `batch_status: "SUCCESS"` | PayPal accepted batch |
| `batch_status: "DENIED"` | PayPal rejected (check credentials) |
| `Error processing artist payouts` | Check error details |

---

## ⚙️ Customization

### **Change Payout Percentage**

Edit `artist_payout.js` line 145:

```javascript
// Change from 50% to 60%
"amount": parseFloat(element.amount) * 0.6,
```

### **Change Cron Schedule**

Edit `cronJobs.js` line 17. Examples:

```javascript
'0 0 1 * *'      // 1st of every month (current)
'0 0 15 * *'     // 15th of every month
'0 0 1 */3 *'    // 1st of every 3 months (quarterly)
'0 0 * * 1'      // Every Monday
```

---

## 🚨 Troubleshooting

### **Payout not running?**
1. Check server logs for cron initialization
2. Verify timezone is correct
3. Check PayPal credentials in `config.js`

### **No transactions found?**
1. Verify `sender_item_id IS NULL` in database
2. Check `tracks.email` is not NULL
3. Ensure there are actually unpaid transactions

### **PayPal errors?**
1. Check PayPal sandbox vs production mode
2. Verify API credentials
3. Check PayPal account balance
4. Ensure artist emails are valid PayPal accounts

---

## ✅ Summary

- ✅ **Automatic monthly payouts** on 1st of each month
- ✅ **50% artist share** calculated automatically
- ✅ **Processes all unpaid transactions** (`sender_item_id IS NULL`)
- ✅ **Manual override** available anytime with `node artist_payout.js`
- ✅ **Integrated with cron job** system
- ✅ **Comprehensive logging** for monitoring

Your artist payout system is now fully automated! 🚀
