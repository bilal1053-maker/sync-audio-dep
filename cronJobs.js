const cron = require('node-cron');

/**
 * Initialize all cron jobs for the application
 * @param {Object} config - Application configuration object
 */
function initializeCronJobs(config) {
    console.log('Initializing cron jobs...');

    // Cron job that runs on the 1st day of every month at 00:00 (midnight)
    // Cron format: '0 0 1 * *'
    // Breakdown: minute hour day-of-month month day-of-week
    // 0 0 1 * * = At 00:00 on day-of-month 1
    const monthlyJob = cron.schedule('0 0 1 * *', () => {
    // const monthlyJob = cron.schedule('*/3 * * * *', () => {
        
        const now = new Date();
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
        
        console.log('='.repeat(60));
        console.log('🎉 MONTHLY CRON JOB TRIGGERED!');
        console.log(`📅 Date: ${now.getDate()}-${monthNames[now.getMonth()]}-${now.getFullYear()}`);
        console.log(`⏰ Time: ${now.toLocaleTimeString()}`);
        console.log('='.repeat(60));
        
        performMonthlyTasks(config);
    }, {
        scheduled: true,
        // timezone: "Asia/Kolkata" // Set to your timezone (IST)
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    console.log('✅ Monthly cron job scheduled: Runs on 1st of every month at 00:00');

    // Optional: For testing purposes, you can add a job that runs every minute
    // Uncomment the lines below to test
    /*
    const testJob = cron.schedule('* * * * *', () => {
        console.log('Test cron job running every minute:', new Date().toLocaleString());
    });
    console.log('✅ Test cron job scheduled: Runs every minute');
    */

    return {
        monthlyJob
        // testJob // Uncomment if using test job
    };
}

/**
 * Perform monthly tasks
 * @param {Object} config - Application configuration object
 */
async function performMonthlyTasks(config) {
    try {
        console.log('Starting monthly tasks...');
        
        // Task 1: Process all unpaid artist payouts
        console.log('💰 Task 1: Processing artist payouts...');
        try {
            const sendArtistPayout = require('./artist_payout.js');
            // Process all unpaid transactions (sender_item_id IS NULL)
            const result = await sendArtistPayout();
            
            if (result && result.success) {
                console.log(`✅ Artist payouts completed: ${result.message}`);
                if (result.count) {
                    console.log(`   📊 Processed ${result.count} transaction(s)`);
                }
            }
        } catch (error) {
            console.error('❌ Error processing artist payouts:', error.message);
        }
        
        console.log('✅ All monthly tasks completed successfully!');
    } catch (error) {
        console.error('❌ Error performing monthly tasks:', error);
    }
}

module.exports = initializeCronJobs;
