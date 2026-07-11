require('dotenv').config();
module.exports = {
	"port": process.env.PORT || "8082",
	"database": {
		"host": process.env.DB_HOST,
		"user": process.env.DB_USER,
		"password": process.env.DB_PASSWORD,
		"database": process.env.DB_DATABASE || "1234"
	},
	"paypal_sdk": {
		"mode": process.env.PAYPAL_MODE || "sandbox",
		"client_id": process.env.PAYPAL_CLIENT_ID,
		"client_secret": process.env.PAYPAL_CLIENT_SECRET,
		"return_url": process.env.PAYPAL_RETURN_URL
	},
	"mailgun": {
		"api_key": process.env.MAILGUN_API_KEY
	}
};