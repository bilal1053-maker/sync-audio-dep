const cron = require('node-cron');

console.log('Testing cron job functionality...\n');

// Test job that runs every minute
const testJob = cron.schedule('* * * * *', () => {
    const now = new Date();
    console.log('✅ Test cron job executed at:', now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
}, {
    scheduled: true,
    timezone: "Asia/Kolkata"
});

console.log('📋 Cron job scheduled to run every minute');
console.log('⏰ Current time:', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
console.log('⏳ Waiting for cron job to trigger...');
console.log('Press Ctrl+C to stop\n');

// Keep the script running
process.on('SIGINT', () => {
    console.log('\n\n👋 Stopping test cron job...');
    testJob.stop();
    process.exit(0);
});
