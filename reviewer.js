"use strict";

module.exports = function(config, adminHandlers) {
	const express = require('express');
	const router = express.Router();
	const db = require('./database.js')(config);
	const bcrypt = require('bcryptjs');
	const crypto = require('crypto');

	const SESSION_COOKIE = "reviewer_session";
	const SESSION_DAYS = 30;

	async function createSession(reviewerId) {
		const token = crypto.randomBytes(32).toString('hex');
		const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
		await db.query("INSERT INTO reviewer_sessions (token, reviewer_id, expires_at) VALUES (?, ?, ?)", [token, reviewerId, expiresAt]);
		return { token, expiresAt };
	}

	async function requireReviewer(req, res, next) {
		try {
			const token = req.cookies[SESSION_COOKIE];
			if (!token) {
				res.redirect("/reviewer/login");
				return;
			}
			const sessions = await db.query("SELECT reviewer_id, expires_at FROM reviewer_sessions WHERE token = ?", [token]);
			if (sessions.length === 0 || new Date(sessions[0].expires_at) < new Date()) {
				res.clearCookie(SESSION_COOKIE);
				res.redirect("/reviewer/login");
				return;
			}
			res.locals.reviewerId = sessions[0].reviewer_id;
			next();
		} catch (error) {
			console.error(error);
			res.redirect("/reviewer/login");
		}
	}

	router.get("/", (_req, res) => {
		res.redirect("/reviewer/tracks");
	});

	router.get("/login", (req, res) => {
		res.render("reviewer_login", { error: req.query.error === "1" });
	});

	router.post("/login", async (req, res) => {
		try {
			const username = (req.body.username || "").trim();
			const password = req.body.password || "";
			if (!username || !password) {
				res.redirect("/reviewer/login?error=1");
				return;
			}
			const users = await db.query("SELECT id, password_hash FROM reviewer_users WHERE username = ?", [username]);
			if (users.length === 0) {
				res.redirect("/reviewer/login?error=1");
				return;
			}
			const match = await bcrypt.compare(password, users[0].password_hash);
			if (!match) {
				res.redirect("/reviewer/login?error=1");
				return;
			}
			const { token, expiresAt } = await createSession(users[0].id);
			res.cookie(SESSION_COOKIE, token, { httpOnly: true, expires: expiresAt });
			res.redirect("/reviewer/tracks");
		} catch (error) {
			console.error(error);
			res.redirect("/reviewer/login?error=1");
		}
	});

	router.get("/logout", async (req, res) => {
		const token = req.cookies[SESSION_COOKIE];
		if (token) {
			await db.query("DELETE FROM reviewer_sessions WHERE token = ?", [token]).catch(() => {});
		}
		res.clearCookie(SESSION_COOKIE);
		res.redirect("/reviewer/login");
	});

	router.get("/tracks", requireReviewer, async (_req, res) => {
		try {
			const tracks = await db.query("SELECT track_id AS `id`, title, artist, accepted, reviewed FROM tracks WHERE reviewed = 1 ORDER BY accepted DESC, title, artist");
			const stemCounts = await db.query("SELECT track_id, COUNT(*) AS count FROM stems GROUP BY track_id");
			const stemCountMap = {};
			stemCounts.forEach(r => { stemCountMap[r.track_id] = r.count; });
			tracks.forEach(t => { t.stemCount = stemCountMap[t.id] || 0; });
			const accepted = tracks.filter(track => track.accepted);
			const rejected = tracks.filter(track => !track.accepted);

			const playlists = await db.query("SELECT playlist_id AS `id`, name FROM playlists");
			const playlistTracks = await db.query("SELECT playlist_id, track_id FROM playlisttracks");
			const trackById = {};
			tracks.forEach(t => { trackById[t.id] = t; });
			const playlistArray = playlists.map(playlist => ({
				id: playlist.id,
				name: playlist.name,
				tracks: playlistTracks
					.filter(pt => pt.playlist_id === playlist.id)
					.map(pt => trackById[pt.track_id])
					.filter(t => t)
			}));

			res.render("reviewer/tracks", { accepted, rejected, playlists: playlistArray });
		} catch (error) {
			console.error(error);
			res.render("error");
		}
	});

	router.get("/tracks/download", requireReviewer, adminHandlers.bulkDownloadTracks);
	router.get("/tracks/(*)/download/wav", requireReviewer, (req, res) => adminHandlers.downloadTrack(req, res, "wav"));
	router.get("/tracks/(*)/download/mp3", requireReviewer, (req, res) => adminHandlers.downloadTrack(req, res, "mp3"));

	router.get("/tracks/(*)", requireReviewer, async (req, res) => {
		try {
			const id = req.params[0];
			const tracks = await db.query("SELECT track_id AS `id`, checksum, title, artist FROM tracks WHERE track_id = ? AND reviewed = 1", [id]);
			if (tracks.length === 0) {
				res.sendStatus(404);
				return;
			}
			const stems = await db.query("SELECT stem_id, stem_type, checksum FROM stems WHERE track_id = ?", [id]);
			res.render("reviewer/track", { track: tracks[0], stems });
		} catch (error) {
			console.error(error);
			res.render("error");
		}
	});

	router.get("/stems/:stemId/download", requireReviewer, adminHandlers.downloadStem);

	return router;
};
