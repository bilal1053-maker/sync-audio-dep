const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const config = require("./config.js");
const mysql = require("mysql2");
const protobuf = require("protobufjs");
config.database.waitForConnections = true;
config.database.connectionLimit = 10;
config.database.queueLimit = 0;
config.database.pool = mysql.createPool(config.database);
const paypalLogin = require("./paypal_login.js")(config);
const db = require("./database.js")(config);
require('dotenv').config();

// Initialize cron jobs
const initializeCronJobs = require("./cronJobs.js");
initializeCronJobs(config);

const app = express();
app.set('view engine', 'pug');
async function getLicences(licenceIds) {
	let params = [];
	let query = "SELECT id, name, description, track_price, IF(id = 10, 1, 0) AS `commercial` FROM licence_types";
	if (licenceIds && licenceIds.length > 0) {
		query += " WHERE id IN (?)";
		params = [licenceIds];
	} else if (licenceIds) {
		return {};
	}
	const result = await db.query(query, params);
	if (result.length == 0) {
		throw new Error("Licence not found");
	}
	const licences = {};
	for (const licence of result) {
		licences[licence.id] = licence;
	}
	return licences;
}


app.use(async (req, res, next) => {
	try {
	  const licences = await getLicences();
	  res.locals.licences = licences;
	  res.locals.year = new Date().getFullYear();
	  next();
	} catch (error) {
	  console.error("Error fetching licences:", error);
	  res.status(500).send("Internal Server Error");
	}
});
// app.use((req, res, next) => {
//     res.setHeader(
//         "Content-Security-Policy",
//         "script-src 'self' https://www.paypal.com;"
//     );
//     next();
// });
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));
app.use(cookieParser());
app.use(express.static("static"));
app.use("/proto", express.static("proto"));
app.enable('trust proxy');
app.set('trust proxy','loopback');

app.use(async function(req, res, next) {
	if (typeof(req.cookies.trolley) === "string") {
		res.locals.trolley = JSON.parse(req.cookies.trolley);
	}
	if (typeof(req.cookies.shortlists) === "string") {
		const root = await protobuf.load("proto/shortlist.proto");
		const Shortlist = root.lookupType("syncaudio.Shortlist");
		const shortlists = JSON.parse(req.cookies.shortlists).map(item => {
			const msg = Shortlist.decode(Buffer.from(item, "base64"));
			const obj = Shortlist.toObject(msg);
			obj.encoded = item;
			return obj;
		});
		res.locals.shortlists = shortlists;
	}
	if (req.cookies.paypal_access_token) {
		res.locals.paypalAccessToken = req.cookies.paypal_access_token;
	}
	next();
});

const admin = require('./admin.js')(config, paypalLogin);
const main = require('./main.js')(config);
const trolley = require("./trolley.js")(config);
const user = require("./user.js")(config, paypalLogin);
const shortlist = require("./shortlist.js")(config, paypalLogin);
app.use("/", main);
app.use("/trolley", trolley);
app.use("/admin", admin);
app.use("/account", user);
app.use("/shortlist", shortlist);

try {
	app.listen(config.port, () => {
		console.log(`Server listening on port ${config.port}`)
	});
} catch (error) {
	console.log("Error starting server: ", error);
}