"use strict";

module.exports = function(config) {
	const paypal = require("paypal-rest-sdk");
	const db = require("./database.js")(config);
	require('dotenv').config();
	
	paypal.configure({
		"mode": config.paypal_sdk.mode,
		"openid_client_id": config.paypal_sdk.client_id,
		"openid_client_secret": config.paypal_sdk.client_secret,
		"openid_redirect_uri": config.paypal_sdk.return_url
	});
	const openIdConnect = paypal.openIdConnect;

	const request = require("request");

	function userInfo(req, res, next) {
		openIdConnect.userinfo.get(res.locals.paypalAccessToken, (error, userinfo) => {
			const redirectUrl = req.cookies.login_redirect_url
			res.clearCookie("login_redirect_url")
			if (error) {
				setTokenInfoCookie(res, null);
				console.log(error);
				res.sendStatus(500);
			} else {
				res.locals.paypalUserInfo = userinfo;
				db.query("SELECT email FROM admin_users WHERE email = ?", [userinfo.email]).then(result => {
					res.locals.isAdminUser = result.length > 0;
					res.cookie("is_admin_user", result.length > 0, {
						// "maxAge": tokeninfo.expires_in*1000,
						"httpOnly": true
					});
				}).catch(() => {
					res.locals.isAdminUser = false;
				}).finally(() => {
					if (redirectUrl) {
						res.redirect(redirectUrl)
					} else {
						next();
					}
				});
			}
		});
	}
	function login(req, res, next) {
		const onTokenInfo = (error, tokeninfo) => {
			if (error) {
				console.log(error);
				res.sendStatus(500);
			} else {
				setTokenInfoCookie(res, tokeninfo);
				userInfo(req, res, next);
			}
		}

		if (res.locals.paypalAccessToken) {
			userInfo(req, res, next);
		} else if (req.cookies.paypal_refresh_token) {
			openIdConnect.tokeninfo.refresh(req.cookies.paypal_refresh_token, onTokenInfo);
		} else if (req.query.code) {
			openIdConnect.tokeninfo.create(req.query.code, onTokenInfo);
		} else {
			const loginUrl = openIdConnect.authorizeUrl({
				"scope": "openid email"
			});
			res.cookie("login_redirect_url", req.originalUrl, {
				"maxAge": 600000,
				"httpOnly": true
			});
			res.render("redirect", {"redirect_url": loginUrl});
		}
	}

	function logout(req, res, next) {
		console.log("logout process start")
		if (req.cookies.paypal_id_token) {
		console.log("req.cookies.paypal_id_token", req.cookies.paypal_id_token)
			const logoutUrl = openIdConnect.logoutUrl({ 'id_token': req.cookies.paypal_id_token });
			console.log("paypal logout process start...")
			request.get(logoutUrl, (_error, _response, _body) => {
				console.log("paypal logout response get...")
				setTokenInfoCookie(res, null);
				next();
			});
		} else {
			setTokenInfoCookie(res, null);
			next();
		}
	}

	function setTokenInfoCookie(res, tokeninfo) {
		if (tokeninfo && tokeninfo.access_token && tokeninfo.expires_in) {
			res.locals.paypalAccessToken = tokeninfo.access_token;
			res.cookie("paypal_access_token", tokeninfo.access_token, {
				"maxAge": tokeninfo.expires_in*1000,
				"httpOnly": true
			});
		} else {
			res.clearCookie("paypal_access_token");
			res.clearCookie("paypal_refresh_token");
			res.clearCookie("paypal_id_token");
			res.clearCookie("is_admin_user");
		}
		const longTime = 365 * 24 * 60 * 60 * 1000;
		const longLivedOptions = {
			"maxAge": longTime,
			"httpOnly": true
		};
		console.log("final logout...")
		if (tokeninfo && tokeninfo.refresh_token) {
			res.cookie("paypal_refresh_token", tokeninfo.refresh_token, longLivedOptions);
		}
		if (tokeninfo && tokeninfo.id_token) {
			res.cookie("paypal_id_token", tokeninfo.id_token, longLivedOptions);
		}
	}

	return {
		"login": login,
		"logout": logout
	};
}