const { cookie } = require('request');

module.exports = function(config) {

	const express = require('express');
	const router = express.Router();
	const db = require("./database.js")(config);
	const payment = require("./payment.js")(config);
	const fs = require("fs");
	const md = require('jstransformer')(require('jstransformer-markdown-it'));
	const mailgun = require('mailgun-js')({"apiKey": config.mailgun.api_key, "domain": "sync-audio.com"});

	function renderTrolley(_req, res) {
		res.render("trolley", { discountEligibleIds: [5, 6, 9] });
	}

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

	async function isTrackCommercialOnly(trackId) {
		const result = await db.query("SELECT commercial_licence_only FROM tracks WHERE track_id = ?", [trackId]);
		if (result.length == 0) {
			throw new Error("Track not found");
		}
		return result[0].commercial_licence_only == 1;
	}

	function getCommercialLicenceCategories() {
		return db.query("SELECT id, name, description FROM commercial_licence_categories");
	}

	async function getCommercialLicences(licenceIds) {
		let params = [];
		let query = "SELECT commercial_licences.id, commercial_licence_categories.name, description, `use`, territory, unit, price FROM commercial_licences JOIN commercial_licence_categories ON (commercial_licence_categories.id = commercial_licences.category)";
		if (licenceIds && licenceIds.length > 0) {
			query += " WHERE commercial_licences.id IN (?)";
			params = [licenceIds];
		} else if (licenceIds) {
			return {};
		}
		const result = await db.query(query, params);
		const commLicences = {};
		for (const licence of result) {
			commLicences[licence.id] = licence;
		}
		return commLicences;
	}

	function getCommercialLicencesInCategory(categoryId) {
		const query = "SELECT commercial_licences.id, commercial_licence_categories.name, description, `use`, territory, unit, price FROM commercial_licences JOIN commercial_licence_categories ON (commercial_licence_categories.id = commercial_licences.category) WHERE commercial_licence_categories.id = ? ORDER BY sort_order";
		return db.query(query, categoryId);
	}

	async function getTrolleyTracks(_req, res, next) {
		try {
			if (res.locals.trolley && res.locals.trolley.tracks && res.locals.trolley.tracks.length > 0) {
				const trackIds = res.locals.trolley.tracks.map(val => {return val.track_id});
				const commLicenceIds = res.locals.trolley.tracks.filter(val => {return val.comm_licence_id}).map(val => {return val.comm_licence_id});
				const licenceIds = res.locals.trolley.tracks.filter(val => {return val.licence_id}).map(val => {return val.licence_id});
				const result = await db.query("SELECT tracks.track_id AS `id`, checksum, title, artist, genres.genre, moods.mood, duration, style, tempo FROM tracks LEFT OUTER JOIN genres ON genres.track_id = tracks.track_id LEFT OUTER JOIN moods ON moods.track_id = tracks.track_id WHERE accepted = 1 AND tracks.track_id IN (?) ORDER BY tracks.title, tracks.artist", [trackIds]);
				if (result.length == 0) {
					res.redirect("/music");
					return;
				}
				const tracks = {};
				for (const track of result) {
					tracks[track.id] = track;
				}
				const licences = await getLicences(licenceIds);
				const commLicences = await getCommercialLicences(commLicenceIds);
				const trolleyTracks = [];
				const DISCOUNT_ELIGIBLE_LICENCE_IDS = [5, 6, 9];
				let discountEligibleCount = 0;
				let total = 0;
				for (const tr of res.locals.trolley.tracks) {
					const track = {
						"track": tracks[tr.track_id]
					}
					if (tr.comm_licence_id) {
						track.comm_licence = commLicences[tr.comm_licence_id];
						const clientProps = ["first_name", "last_name", "company", "email", "website", "project_title"];
						clientProps.forEach(val => {
							if (tr[val]) {
								track[val] = tr[val];
							}
						});
						total += track.comm_licence.price;
					} else if (tr.licence_id) {
						track.licence = licences[tr.licence_id];
						if (DISCOUNT_ELIGIBLE_LICENCE_IDS.includes(parseInt(tr.licence_id))) {
							discountEligibleCount++;
							track.discountEligiblePosition = discountEligibleCount;
							if (discountEligibleCount % 3 === 0) {
								const originalPrice = track.licence.track_price;
								const discountedPrice = Math.round(originalPrice * 0.9 * 100) / 100;
								track.discount_applied = true;
								track.original_price = originalPrice;
								track.discounted_price = discountedPrice;
								total += discountedPrice;
							} else {
								total += track.licence.track_price;
							}
						} else {
							total += track.licence.track_price;
						}
					}
					trolleyTracks.push(track);
				}
				const completedGroupsBoundary = Math.floor(discountEligibleCount / 3) * 3;
				for (const track of trolleyTracks) {
					if (track.discountEligiblePosition) {
						track.showDiscountHint = !track.discount_applied && track.discountEligiblePosition > completedGroupsBoundary;
					}
				}
				res.locals.trolleyTracks = trolleyTracks;
				res.locals.total = Math.round(total*100)/100;
				next();
			} else {
				res.redirect('/music');
			}
		} catch (error) {
			console.error(error)
			res.render("error")
		}
	}

	function onError(res) {
		return function(_error) {
			res.render("error");
		}
	}

	function renderLicence(_req, res) {
		if (!res.locals.licenceName) {
			res.sendStatus(500);
			return;
		}
		fs.readFile("views/licence/generic.md", (error, buffer) => {
			if (error) {
				console.error(error);
				res.sendStatus(500);
				return;
			}
			// const text = buffer.toString("utf8").replace("___name___", res.locals.licenceName);
			// const html = md.render(text).body
			res.render("licence_tnc", {"text":res.locals.licenceName});
		});
	}

	function sendMessage(req,res, admins, i, sent, isSendRes = true) {
		if (i<admins.length) {
			const admin = admins[i].email;
			const message = {
				"to": admin,
				"from": "Sync-Audio website <no-reply@sync-audio.com>",
				"subject": "Submit request "+(req?.body?.selectedCat ? `(${req?.body?.selectedCat})` : ""),
				"text": `${!req?.body?.selectedCat ? 'submit request' : 'Commercial licence Request Quote'}`
			};
			if(req?.track?.name){
				message.text += "\n\nMusic: "+(req?.track?.name);
			}
			if (req.body?.trackArtist) {
				message.text += "\nTrack Artist: "+req.body.trackArtist;
			}
			if(req?.body?.firstName || req?.cookies?.first_name){
				message.text += "\n\nFirst name: "+(req?.body?.firstName || req?.cookies?.first_name);
			}
			if(req?.body?.lastName || req?.cookies?.last_name){
				message.text += "\nLast name: "+(req?.body?.lastName || req?.cookies?.last_name);
			}
			if(req?.body?.company || req?.cookies?.company){
				message.text += "\nClient company name: "+(req?.body?.company || req?.cookies?.company);
			}
			message.text += "\nEmail: "+(req?.body?.email || req?.cookies?.email);
			if(req?.body?.coverage_details){
				message.text += (req?.body?.isCartForm ? "\nExtra Details:" :"\nInquiry Details: "+(req?.body?.coverage_details || "-"));
			}
			if(req?.body?.website || req?.cookies?.website){
				message.text += "\nWebsite: "+(req?.body?.website || req?.cookies?.website);
			}
			if (req.body.projectTitle) {
				message.text += "\nProject title: "+req.body.projectTitle;
			}
			if (req.body?.use) {
				message.text += "\nUse: "+req.body.use;
			}
			if (req.body?.territory) {
				message.text += "\nTerritory: "+req.body.territory;
			}
			mailgun.messages().send(message).then(_response => {
				sent = true;
				console.log("Quote request sent to "+admin);
			}).catch(error => {
				console.log('error===>', error)
				console.log("Error sending quote request to "+admin+": "+JSON.stringify(error));
			}).finally(() => {
				i++;
				sendMessage(req, res, admins, i, sent, isSendRes);
			});
		} else if (!sent && isSendRes) {
			res.render("error",{"error":"Failed to send a quote request. Please email your request to info@sync-audio.com."});
		} else {
			if(isSendRes){
				res.render("quote_sent");
			}
		}
	}

	router.get("/add/(*)/commercial/(*)", (req, res) => {
		const trackId = req.params[0];
		const licenceCategoryId = req.params[1];
		res.render("licence_form_comm", {
			"trackId": trackId, 
			"licenceCategory": licenceCategoryId, 
			"firstName": req.cookies.first_name,
			"lastName": req.cookies.last_name,
			"company": req.cookies.company,
			"email": req.cookies.email,
			"website": req.cookies.website,
			"projectTitle": req.cookies.project_title
		});
	});

	router.get("/add/(*)/commercial", async(req, res) => {
		const trackId = req.params[0];
		const result = await db.query("SELECT tracks.track_id AS `id`, checksum, title, artist, genres.genre, moods.mood, duration, style, tempo FROM tracks LEFT OUTER JOIN genres ON genres.track_id = tracks.track_id LEFT OUTER JOIN moods ON moods.track_id = tracks.track_id WHERE accepted = 1 AND tracks.track_id IN (?) ORDER BY tracks.title, tracks.artist", [[trackId]]);
		getCommercialLicenceCategories().then(categories => {
			res.render("licence_form_comm", {
				"trackId": trackId, 
				"firstName": req.cookies.first_name,
				"lastName": req.cookies.last_name,
				"company": req.cookies.company,
				"email": req.cookies.email,
				"website": req.cookies.website,
				"projectTitle": req.cookies.project_title,
				"licenceCategories": categories,
				"track": result?.[0] || {}
			});
		}).catch(onError);
	});

	router.post("/save-cookies", async (req, res, next) => {
	// 	let now = new Date();
    // now.setHours(23, 59, 59, 999); // Set time to today 11:59:59 PM
	const options = {
		// expires: now
	};
	req.body = {
		...req.body,
		firstName: req.body.first_name,
		lastName: req.body.last_name
	}
		res.cookie("company", req.body.company, options);
			res.cookie("email", req.body.email, options);
			res.cookie("first_name", req.body.first_name, options);
			res.cookie("last_name", req.body.last_name, options);
			res.cookie("form_submitted", "true", options);
			sendMessage(req,res, [{email: "archive@sync-audio.com"}], 0, false, false);
			res.json("Successfully set")
	})

	router.post("/add/(*)/commercial", async (req, res, next) => {
		try {
			// test
			const trackId = req.params[0];
			const licenceCategoryId = req.body.licenceCategory;
			const licenceId = req.body.licenceId;
			if(licenceCategoryId !== "other"){
				if(!req.body.email){
					req.body.email = req.cookies.email
				}
				
			}
			const result = await db.query("SELECT tracks.track_id AS `id`, checksum, title, artist, genres.genre, moods.mood, duration, style, tempo FROM tracks LEFT OUTER JOIN genres ON genres.track_id = tracks.track_id LEFT OUTER JOIN moods ON moods.track_id = tracks.track_id WHERE accepted = 1 AND tracks.track_id IN (?) ORDER BY tracks.title, tracks.artist", [[trackId]]);
			// if (!req.body.firstName || req.body.firstName.trim().length == 0) {
			// 	res.render("error", {"error": "Please enter your first name"});
			// 	return;
			// }
		
			// if (!req.body.company || req.body.company.trim().length == 0) {
			// 	res.render("error", {"error": "Please the company name of the end client"});
			// 	return;
			// }
			if (!req.body.email || req.body.email.trim().length == 0) {
				res.render("error", {"error": "Please enter your email"});
				return;
			}
			// if ((!req.body.coverage_details || req.body.coverage_details.trim().length == 0) && licenceCategoryId == "other") {
			// 	res.render("error", {"error": "Please enter your details in Add Details Field"});
			// 	return;
			// }

			// if (!req.body.website || req.body.website.trim().length == 0) {
			// 	res.render("error", {"error": "Please enter your website"});
			// 	return;
			// }
			// res.cookie("first_name", req.body.firstName);
			// res.cookie("last_name", req.body.lastName);
			res.cookie("company", req.body.company);
			res.cookie("email", req.body.email);
			res.cookie("coverage_details", req.body.coverage_details);
			// res.cookie("website", req.body.website);
			// if (req.body.projectTitle) {
			// 	res.cookie("project_title", req.body.projectTitle);
			// }
			if (licenceId) {
				if (!req.body.agree) {
					res.render("error", {"error": "You must agree to the licence terms and conditions"});
					return;
				}
				let trolley = req.cookies.trolley;
				const track = {
					"track_id": trackId,
					"comm_licence_id": licenceId,
					"first_name": req.body.firstName,
					"last_name": req.body.lastName,
					"company": req.body.company,
					"email": req.body.email,
					"website": req.body.website,
					"coverage_details": req.body.coverage_details
				};
				// if (req.body.projectTitle) {
				// 	track.project_title = req.body.projectTitle;
				// }
				if (trolley) {
					trolley = JSON.parse(trolley);
				}
				if (trolley && trolley.tracks && trolley.tracks.length > 0) {
					const index = trolley.tracks.findIndex(val => {
						return val.track_id == trackId && val.comm_licence_id == licenceId;
					});
					if (index == -1) {
						trolley.tracks.push(track);
					}
				} else {
					trolley = {"tracks": [track]};
				}
				res.cookie("trolley", JSON.stringify(trolley));
				res.locals.trolley = trolley;
				next();
			} else if (licenceCategoryId) {
				if (licenceCategoryId == "other") {
					const admins = await db.query("SELECT email FROM admin_users");
					req.track = {name : result?.[0]?.title};
					// sendMessage(req,res, [...admins, {email: "sales@sync-audio.com"}, {email: "supportteam@sync-audio.com"}, {email: "archive@sync-audio.com"}, {email: "other@sync-audio.com"}], 0, false);
					// sendMessage(req,res, [...admins, {email: "sales@sync-audio.com"}, {email: "archive@sync-audio.com"}, {email: "other@sync-audio.com"}], 0, false);
					sendMessage(req,res, [...admins, {email: req.body?.selectedCat === "Other" ? "other@sync-audio.com" :  "sales@sync-audio.com"}], 0, false);
				} else {
					const licences = await getCommercialLicencesInCategory(licenceCategoryId);
					const defaultLicenceId = licences?.find((val) => val?.price)?.id;
					const params = {
						"form": req.body,
						"licences": licences,
						"trackId": trackId,
						"company": req.cookies.company,
						"email": req.cookies.email,
						"track": result?.[0] || {},
						"defaultLicenceId": defaultLicenceId
					};
					res.render("licence_select_commercial", params);
				}
			} else {
				onError(res)();
			}
		} catch (error) {
			console.error(error)
			onError(res)(error);
		}
	}, getTrolleyTracks, renderTrolley);

	router.get("/add/(*)/licence/(*)", async function(req, res) {
		try {
			const trackId = req.params[0];
			const licenceId = req.params[1];
			if (licenceId == "10") {
				const categories = await getCommercialLicenceCategories();
				res.render("licence_form_comm", {"trackId": trackId, "licenceCategories": categories});
			} else {
				const licences = await getLicences([licenceId]);
				res.render("licence_agreement_nonprof", {"trackId": trackId, "licence": Object.values(licences)[0]});
			}
		} catch(error) {
			onError(res)(error);
		}
	});

	router.post("/add/(*)/licence/(*)", (req, res, next) => {
		if (!req.body.agree) {
			res.render("error",{"error":"You must agree to the licence terms and conditions."});
			return;
		}
		next();
	}, (req, res, next) => {
		const trackId = req.params[0];
		const licenceId = req.params[1];
		let trolley = req.cookies.trolley;
		const track = {
			"track_id": trackId,
			"licence_id": licenceId
		};
		if (trolley) {
			trolley = JSON.parse(trolley);
		}
		if (trolley && trolley.tracks && trolley.tracks.length > 0) {
			const index = trolley.tracks.findIndex(val => {
				return val.track_id == trackId && val.licence_id == licenceId;
			});
			if (index == -1) {
				trolley.tracks.push(track);
			}
		} else {
			trolley = {"tracks": [track]};
		}
		res.cookie("trolley", JSON.stringify(trolley));
		res.locals.trolley = trolley;
		next();
	}, getTrolleyTracks, renderTrolley);

	router.get("/add/(*)", async function(req, res) {
		try {
			const comOnly = await isTrackCommercialOnly(req.params[0]);
			console.log('in here===>alpesh',)
			if (comOnly) {
				return res.redirect("/trolley/add/"+req.params[0]+"/commercial");
			} else {
				let licences = await getLicences();
				licences = Object.values(licences);
				licences.filter(val => {
					return val.id != 10;
				});
				res.render("licences_nonprof", {"licences": licences, "trackId": req.params[0]});
			}
		} catch (error) {
			res.render("error")
		}
	});

	router.get("/remove/(*)/(*)/(*)", function(req, res, next) {
		const trackId = req.params[0];
		const type = req.params[1];
		const licenceId = req.params[2];
		let trolley = req.cookies.trolley;
		let tracks;
		if (trolley) {
			trolley = JSON.parse(trolley);
			tracks = trolley.tracks;
		} else {
			trolley = {};
		}
		if (!tracks) {
			tracks = [];
		} else {
			const index = tracks.findIndex(val => {
				if (val.track_id != trackId) {
					return false;
				}
				if (type == "licence" && val.licence_id && val.licence_id == licenceId) {
					return true;
				}
				if (type == "comm_licence" && val.comm_licence_id && val.comm_licence_id == licenceId ) {
					// if (req.query.projectTitle && val.project_title) {
					// 	return val.project_title == req.query.projectTitle;
					// }
					return true;
				}
				return false;
			});
			if (index > -1) {
				tracks.splice(index, 1);
			}
		}
		if (!trolley || tracks.length == 0) {
			res.clearCookie("trolley");
		} else {
			trolley.tracks = tracks;
			res.cookie("trolley", JSON.stringify(trolley));
		}
		res.locals.trolley = trolley;
		next();
	}, getTrolleyTracks, renderTrolley);

	router.get("/licence", async (_req, res) => {
		try {
			const licences = await db.query("SELECT id, name, description, track_price FROM licence_types ORDER BY id");
			res.render("licences",{"licences":licences});
		} catch (error) {
			render("error");
		}
	});

	router.get("/licence_tnc/(*)", async (req, res, next) => {
		try {
			const licences = await db.query("SELECT id, name, description, track_price FROM licence_types WHERE id = ?",[req.params[0]]);
			if (licences.length == 0) {
				return res.render(error)
			}
			res.locals.licenceName = licences[0].name;
			next();
		} catch (error) {
			res.render(error)
		}
	}, renderLicence);

	function onLicence(res, next) {
		return function(error, licences) {
			if (error || licences.length == 0) {
				res.render("error");
			} else {
				res.locals.licenceName = licences[0].name;
				next();
			}
		}
	}

	router.get("/com_licence_tnc/(*)", async (req, res) => {
		try {
			const licences = await db.query("SELECT cl.id, clc.name, clc.description, cl.`use`, cl.territory FROM commercial_licences AS `cl` LEFT JOIN commercial_licence_categories AS `clc` ON clc.id = cl.category WHERE cl.id = ?",[req.params[0]]);
			if (licences.length == 0) {
				res.render("error");
			} else {
				res.render("com_licence_tnc", {"licence":licences[0], "print": req.cookies?.is_admin_user === "true"});
			}
		} catch (_error) {
			res.render("error")
		}
	});

	router.post("/licence", (req, res, next) => {
		res.locals.trolley.licenceId = req.body.licence_id;
		res.cookie("trolley", JSON.stringify(res.locals.trolley));
		next();
	}, renderTrolley);

	router.get("/licence_tnc", async (_req, res, next) => {
		try {
			const licences = await db.query("SELECT id, name, description, track_price FROM licence_types WHERE id = ?",[res.locals.trolley.licenceId]);
			if (licences.length == 0) {
				throw new Error();
			}
			res.locals.licenceName = licences[0].name;
			next()
		} catch (_error) {
			res.render("error")
		}
	});

	router.get("/checkout", getTrolleyTracks, payment.createTransaction, payment.createPayment);

	router.get("/payment_success/(*)", payment.executePayment, async (req, res) => {
		try {
			const transactionId = req.params[0];
			res.clearCookie("trolley");
			const tracks = await payment.getTransactionTracks(transactionId);
			res.render("download", {"purchases":tracks.nonCommercial, "comPurchases":tracks.commercial});
		} catch(_error) {
			console.error(_error);
			res.sendStatus(500);
		}
	});

	router.get("/payment_cancel/(*)", (req) => {
		const txid = req.params[0];
		payment.deleteTransaction(txid);
	});

	router.get("/", getTrolleyTracks, renderTrolley);

	return router;
}