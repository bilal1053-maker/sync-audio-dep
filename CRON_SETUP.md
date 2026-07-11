# Cron Job Setup - Monthly Task Scheduler

## Overview
This project now includes automated cron job functionality that runs tasks on the **1st day of every month at midnight (00:00)**.

## Files Added

### 1. `cronJobs.js`
Main cron job module that schedules and executes monthly tasks.

**Features:**
- Runs automatically on the 1st of every month at 00:00
- Timezone: Asia/Kolkata (IST)
- Comprehensive logging with emojis for easy monitoring
- Modular design for easy task addition

### 2. `testCron.js`
Test script to verify cron job functionality (runs every minute for testing).

## How It Works

### Cron Schedule Format
```
'0 0 1 * *'
 │ │ │ │ │
 │ │ │ │ └─── Day of week (0-7, Sunday = 0 or 7)
 │ │ │ └───── Month (1-12)
 │ │ └─────── Day of month (1-31)
 │ └───────── Hour (0-23)
 └─────────── Minute (0-59)
```

**Current schedule:** `'0 0 1 * *'` = Every 1st day of the month at 00:00 (midnight)

## Usage

### The cron job is automatically started when your server starts
Your `index.js` now initializes the cron jobs automatically. When you run:
```bash
npm start
# or
nodemon index
```

You'll see:
```
Initializing cron jobs...
✅ Monthly cron job scheduled: Runs on 1st of every month at 00:00
Server listening on port 3000
```

### Adding Your Monthly Tasks

Edit the `performMonthlyTasks()` function in `cronJobs.js`:

```javascript
async function performMonthlyTasks(config) {
    try {
        console.log('Starting monthly tasks...');
        
        // Your custom tasks here
        // Example: Generate monthly reports
        const db = require("./database.js")(config);
        const result = await db.query("SELECT COUNT(*) as total FROM users");
        console.log('Total users:', result[0].total);
        
        // Example: Send monthly emails
        // await sendMonthlyNewsletter();
        
        // Example: Clean up old data
        // await cleanupOldRecords();
        
        console.log('✅ All monthly tasks completed successfully!');
    } catch (error) {
        console.error('❌ Error performing monthly tasks:', error);
    }
}
```

## Testing

### Option 1: Test with the test script
Run the test script to see a cron job execute every minute:
```bash
node testCron.js
```

You should see output like:
```
Testing cron job functionality...
📋 Cron job scheduled to run every minute
⏰ Current time: 11/12/2025, 1:12:37 pm
⏳ Waiting for cron job to trigger...

✅ Test cron job executed at: 11/12/2025, 1:13:00 pm
✅ Test cron job executed at: 11/12/2025, 1:14:00 pm
```

Press `Ctrl+C` to stop.

### Option 2: Modify the schedule for testing
In `cronJobs.js`, temporarily change the schedule to run every minute:

```javascript
// Change from:
const monthlyJob = cron.schedule('0 0 1 * *', () => {

// To (for testing):
const monthlyJob = cron.schedule('* * * * *', () => {
```

**Remember to change it back after testing!**

### Option 3: Manually trigger the function
You can also test by calling the function directly in Node.js:

```javascript
const config = require("./config.js");
const initializeCronJobs = require("./cronJobs.js");
const jobs = initializeCronJobs(config);
```

## Common Cron Schedules

Here are some useful cron schedule patterns:

| Schedule | Cron Expression | Description |
|----------|----------------|-------------|
| Every minute | `* * * * *` | For testing |
| Every hour | `0 * * * *` | At minute 0 |
| Every day at midnight | `0 0 * * *` | Daily at 00:00 |
| Every Monday at 9 AM | `0 9 * * 1` | Weekly on Monday |
| 1st of every month | `0 0 1 * *` | **Current setting** |
| Every 3 months | `0 0 1 */3 *` | Quarterly |
| Every year (Jan 1st) | `0 0 1 1 *` | Annually |

## Timezone Configuration

The cron job is currently set to **Asia/Kolkata (IST)** timezone. To change it:

```javascript
const monthlyJob = cron.schedule('0 0 1 * *', () => {
    // ... your code
}, {
    scheduled: true,
    timezone: "America/New_York" // Change to your timezone
});
```

Common timezones:
- `"Asia/Kolkata"` - India Standard Time
- `"America/New_York"` - Eastern Time
- `"America/Los_Angeles"` - Pacific Time
- `"Europe/London"` - GMT/BST
- `"UTC"` - Coordinated Universal Time

## Monitoring

The cron job logs detailed information when it runs:
```
============================================================
🎉 MONTHLY CRON JOB TRIGGERED!
📅 Date: 1-January-2025
⏰ Time: 12:00:00 AM
============================================================
Starting monthly tasks...
📊 Task 1: Generating monthly statistics...
🗑️  Task 2: Performing database cleanup...
📧 Task 3: Sending monthly notifications...
✅ All monthly tasks completed successfully!
```

## Troubleshooting

### Cron job not running?
1. Check server logs for initialization message
2. Verify timezone is correct
3. Test with a more frequent schedule (e.g., every minute)

### Need to stop a cron job?
```javascript
const jobs = initializeCronJobs(config);
jobs.monthlyJob.stop(); // Stop the job
jobs.monthlyJob.start(); // Restart the job
```

## Dependencies

- **node-cron**: ^3.0.3 (installed)

## Next Steps

1. ✅ Cron job is installed and configured
2. ✅ Integration with `index.js` is complete
3. 🔄 Add your specific monthly tasks to `performMonthlyTasks()` function
4. 🧪 Test using one of the methods above
5. 🚀 Deploy and monitor

---

**Created:** December 2025  
**Last Updated:** December 2025
