
"use strict";
const config = require("./config.js");
const paypal = require("paypal-rest-sdk");
require('dotenv').config();
paypal.configure(config.paypal_sdk);
const db = require("./database.js")(config);
const mailgun = require('mailgun-js')({"apiKey": config.mailgun.api_key, "domain": "sync-audio.com"});

/**
 * Send email notification to admins about completed artist payouts
 * @param {Object} payoutSummary - Summary of the payout (artists, amounts, counts)
 */
async function sendAdminNotification(payoutSummary) {
	try {
		// Get admin emails from database
		const admins = await db.query("SELECT email FROM admin_users");
		
		if (!admins || admins.length === 0) {
			console.log('⚠️  No admin users found to send notification');
			return;
		}

		// Build email message
		const message = {
			"to": admins.map(admin => admin.email).join(', '),
			"from": "Sync-Audio Payouts <no-reply@sync-audio.com>",
			"subject": `Artist Payout Completed - ${payoutSummary.count} Transaction(s) Processed`,
			"text": buildEmailText(payoutSummary)
		};

		// Send email
		// await mailgun.messages().send(message);
		console.log(`📧 Payout notification sent to ${admins.length} admin(s)`);
		
	} catch (error) {
		console.error('❌ Error sending admin notification:', error.message);
		// Don't throw - email failure shouldn't stop the payout process
	}
}

/**
 * Build the email text content
 */
function buildEmailText(summary) {
	const now = new Date();
	let text = `ARTIST PAYOUT SUMMARY\n`;
	text += `${'='.repeat(60)}\n\n`;
	text += `Date: ${now.toLocaleDateString('en-IN')} ${now.toLocaleTimeString('en-IN')}\n`;
	text += `Total Transactions Processed: ${summary.count}\n`;
	text += `Total Artists Paid: ${summary.artistCount}\n`;
	text += `Total Amount Paid: £${summary.totalAmount.toFixed(2)}\n\n`;
	
	if (summary.artists && summary.artists.length > 0) {
		text += `ARTIST BREAKDOWN:\n`;
		text += `${'-'.repeat(60)}\n`;
		
		summary.artists.forEach((artist, index) => {
			text += `\n${index + 1}. ${artist.email}\n`;
			text += `   Amount: £${artist.total.toFixed(2)}\n`;
			text += `   Tracks: ${artist.trackCount}\n`;
			// if (artist.tracks) {
			// 	artist.tracks.forEach(track => {
			// 		text += `     - ${track.title}\n`;
			// 	});
			// }
		});
	}
	
	text += `\n${'='.repeat(60)}\n`;
	text += `\nThis is an automated notification from the Sync-Audio payout system.\n`;
	
	return text;
}

async function addPayout(payouts, payoutJson, emails, payoutIndex) {
	if (payoutIndex < emails.length) {
		try {
			const result = await db.query("INSERT INTO artist_payout (time_created) VALUES (now())");
			const email = emails[payoutIndex];
			const itemId = result.insertId;
				// Create note with all tracks (including duplicates)
				const trackDetails = payouts[email].tracks.map(track => `${track.title} (${track.licence_name || 'N/A'})`).join(', ');
				
				payoutJson.items.push({
					"recipient_type": "EMAIL",
					"amount": {
						"value": payouts[email].total,
						"currency": "GBP"
					},
					"receiver": email,
					"sender_item_id": ""+itemId,
					"note": `Tracks: ${trackDetails}`
				});
			const inPlaceholders = new Array(payouts[email].tracks.length);
			inPlaceholders.fill("?");
			const where = [itemId];
			payouts[email].tracks.forEach(track => {
				where.push(""+track.identifier);
			});
			await db.query("UPDATE transaction_tracks SET sender_item_id = ? WHERE CONCAT(track_id,transaction_id) IN ("+inPlaceholders.join(",")+")", where);
			await addPayout(payouts, payoutJson, emails, payoutIndex+1);
		} catch (error) {
			console.error('❌ Error in addPayout:', error);
			throw error;
		}
	} else {		
		paypal.payout.create(payoutJson, (error, payout) => {
			if (error) {
				console.error('❌ PayPal payout creation failed:', error.response);
				// Don't crash the server, just log the error
				return;
			} else {
				console.log("✅ Create Payout Response");
				console.log(JSON.stringify(payout));
				if (payout.batch_header.batch_status == "SUCCESS") {
					processPayoutResponse(payout);
				} else if (payout.batch_header.batch_status != "DENIED") {
					setTimeout(function(){
						queryPayout(payout.batch_header.payout_batch_id);
					}, 5000);
				} else {
					console.error('❌ PayPal payout denied');
					// Don't crash the server
				}
			}
		});
	}
}

async function updatePayout(payout, itemIndex) {
	if (itemIndex < payout.items.length) {
		const item = payout.items[itemIndex];
		const queryParams = [
			item.transaction_status,
			item.payout_item.amount.value,
			item.payout_item.amount.currency,
			item.payout_item.receiver,
			item.payout_item_fee.value,
			item.payout_item_fee.currency,
			item.payout_item.sender_item_id
		];
		await db.query("UPDATE artist_payout SET transaction_status = ?, amount = ?, currency = ?, receiver = ?, payout_item_fee = ?, fee_currency = ? WHERE sender_item_id = ?", queryParams);
		await updatePayout(itemIndex + 1);
	} else {
		if (payout.batch_header.batch_status == "SUCCESS") {
			console.log('✅ All payouts updated successfully');
			// Don't exit, just finish
		} else if (payout.batch_header.batch_status == "DENIED") {
			console.error('❌ Payout batch denied');
			// Don't crash the server
		} else {
			setTimeout(function(){
				queryPayout(payout.batch_header.payout_batch_id);
			}, 5000);
		}
	}
}

/**
 * Send payout to artists for all unpaid transactions
 * Processes all transactions where sender_item_id IS NULL (not yet paid)
 */
async function sendPayout() {
	try {
		console.log('💰 Processing artist payouts for all unpaid transactions...');

		// Query all unpaid transactions (sender_item_id IS NULL)
		const query = `
			SELECT 
				tracks.email, 
				amount, 
				transaction_tracks.track_id, 
				transaction_tracks.transaction_id, 
				tracks.title, 
				tracks.artist, 
				transaction_tracks.licence_name,
				sender_item_id
			FROM transaction_tracks 
			JOIN transactions ON transactions.transaction_id = transaction_tracks.transaction_id 
			JOIN tracks ON tracks.track_id = transaction_tracks.track_id 
			WHERE sender_item_id IS NULL AND email IS NOT NULL
		`;
		
		const result = await db.query(query);
		
		
		if (result.length > 0) {
			console.log(`💰 Found ${result.length} unpaid transaction(s) to process`);
		} else {
			console.log('ℹ️  No unpaid transactions found');
			return { success: true, message: 'No transactions to process', count: 0 };
		}
		
		if (result.length > 0) {
			const payouts = {};
			let totalAmount = 0;
			
			result.forEach(element => {
				if (!payouts[element.email]) {
					payouts[element.email] = {"total":0,"tracks":[]};
				}
				const track = {
					"amount": parseFloat(element.amount) * 0.5,
					"id": element.track_id,
					"title": element.title,
					"artist": element.artist,
					"licence_name": element.licence_name,
					"identifier": ""+element.track_id+element.transaction_id
				};
				payouts[element.email].total += track.amount;
				payouts[element.email].tracks.push(track);
				totalAmount += track.amount;
			});
			
			const senderBatchId = Math.random().toString(36).substring(9);
			const payoutJson = {
				"sender_batch_header": {
					"sender_batch_id": senderBatchId,
					"email_subject": "Sync-Audio Payout - Track Royalties"
				},
				"items": []
			};
			const emails = Object.keys(payouts);
			await addPayout(payouts, payoutJson, emails, 0);
			
			// Prepare summary for admin notification
			const payoutSummary = {
				count: result.length,
				artistCount: emails.length,
				totalAmount: totalAmount,
				artists: emails.map(email => ({
					email: email,
					total: payouts[email].total,
					trackCount: payouts[email].tracks.length,
					tracks: payouts[email].tracks
				}))
			};
			
			// Send email notification to admins
			console.log('📧 Sending notification to admins...');
			await sendAdminNotification(payoutSummary);
			
			return { success: true, message: 'Artists paid out', count: result.length };
		} else {
			console.log('ℹ️  No unpaid transactions found');
			return { success: true, message: 'No transactions to process', count: 0 };
		}
	} catch (error) {
		console.error('❌ Error in sendPayout:', error);
		throw error;
	}
}

function queryPayout(payoutId) {
	paypal.payout.get(payoutId, function (error, payout) {
		if (error) {
			console.error('❌ Error querying payout:', error);
			// Don't crash the server
			return;
		} else {
			console.log("Get Payout Response");
			console.log(JSON.stringify(payout));
			processPayoutResponse(payout);
		}
	});
}

function processPayoutResponse(payout) {
	if (payout.items && payout.items.length > 0) {
		updatePayout(payout, 0);
	}
}

// Export the function for use in other modules (like cron jobs)
module.exports = sendPayout;

// If this file is run directly (not imported), execute the payout
if (require.main === module) {
	console.log('🚀 Running artist payout script manually...');
	sendPayout()
		.then((result) => {
			console.log("✅ Artists paid out successfully");
			if (result) {
				console.log(`📊 Processed ${result.count || 0} transaction(s)`);
			}
			// Only exit when run manually (not when imported by cron)
			process.exit(0);
		})
		.catch(error => {
			console.error("❌ Artist payout failed: ", error);
			// Only exit when run manually (not when imported by cron)
			process.exit(1);
		});
}