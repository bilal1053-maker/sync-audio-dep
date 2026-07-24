module.exports = function(config, paypalLogin) {
	const express = require('express');
	const router = express.Router();
	const db = require('./database.js')(config);
	const fs = require('fs');
	const multer = require('multer');
	const upload = require('./upload.js')(config);
	const multerUpload = multer({"dest":"./tmp/"});
	require('dotenv').config();
	const mailgun = require('mailgun-js')({"apiKey": config.mailgun.api_key, "domain": "sync-audio.com"});
	const url = require("url")
	const baseURL = "https://"+url.parse(config.paypal_sdk.return_url).host
	const path = require("path");

	function adminLogin(_req, res, next) {
		if (res.locals.isAdminUser) {
			next();
		} else {
			res.render("error", {"error": "Access denied"});
		}
	}

	function onArtists(resolve, reject) {
		return function(error, artists) {
			if (error) {
				return reject(error);
			} else {
				return resolve(artists.map(element => { return element.artist; }));
			}
		}
	}

	async function getFeaturedArtists() {
		const q = "SELECT artist FROM featured_artists ORDER BY artist";
		const result = await db.query(q)
		return result.map(entry => entry.artist)
	}

	async function getArtists(exclude) {
		let q = "SELECT DISTINCT artist FROM tracks ";
		if (exclude && exclude.length > 0) {
			const placeholders = new Array(exclude.length);
			placeholders.fill('?');
			q += "WHERE artist NOT IN ("+placeholders.join(", ")+") ";
		} else {
			exclude = [];
		}
		q += "ORDER BY artist";
		const result = await db.query(q, exclude)
		return result.map(entry => entry.artist)
	}

	async function renderArtistTracks(req, res) {
		try {
			const artist = req.params[0];
			const status = req.params[1] || req.params[2] || req.params[3];
			let qParams = "1";
			if (status == "accepted") {
				qParams = "accepted = 1";
			} else if (status == "rejected") {
				qParams = "accepted = 0 AND reviewed = 1";
			} else if (status == "pending") {
				qParams = "reviewed = 0";
			}
			const tracks = await db.query("SELECT track_id AS `id`, checksum, title, DATE_FORMAT(date_added, '%e %b %Y') AS `date_added`, commercial_licence_only, link as imageUrl, tracks.artist, fa.id as artist_id FROM tracks LEFT JOIN featured_artists fa ON tracks.artist = fa.artist WHERE email = ? AND "+qParams, [artist]);
			res.render("admin/artist_tracks", {"artist":artist, "tracks":tracks, "status": status});
		} catch (error) {
			renderError(res)(error)
		}
	}

	function renderError(res) {
		return function(error) {
			res.render("error",{"error":error});
		}
	}

	const deleteArtistImage = async (artistId) => {
		const imagePath = path.resolve(__dirname, "./static/images/artists", `${artistId}.jpg`);
		try {
			await fs.promises.unlink(imagePath);
		} catch (err) {
			if (err.code !== "ENOENT") {
				console.warn("Failed to delete artist image:", imagePath, err.message);
			}
		}
	};

	async function removeConnectedArtistIfNoTracks(artistName) {
		const remaining = await db.query("SELECT COUNT(*) AS count FROM tracks WHERE BINARY artist = ?", [artistName]);
		if (Number(remaining[0]?.count) > 0) {
			return;
		}
		const featuredArtists = await db.query("SELECT id FROM featured_artists WHERE BINARY artist = ?", [artistName]);
		for (const featuredArtist of featuredArtists) {
			await db.query("DELETE FROM featured_artists WHERE id = ?", [featuredArtist.id]);
			await deleteArtistImage(featuredArtist.id);
		}
	}

	router.post('/add-artist',paypalLogin.login, adminLogin, async (req, res, next) => {
		try {
			if(!req.body?.artist){
				res.json({success: false, message: 'No Artist Found'})
			}
			const artist = await db.query("SELECT link as imageUrl FROM tracks WHERE artist = ?", [req.body.artist]);
			const artistImg = artist?.[0]?.imageUrl;
			// if(!artistImg){
			// 	res.json({success: false, message: 'Please provide the link of artist image'})
			// }
			const newArtist = await db.query("INSERT INTO featured_artists (artist, job, text, priority, image_url) VALUES (?,?,?,?,?)", [req.body.artist, "", "", null, artistImg]);
	
			// req.body.imageUrl = artistImg;
			// res.locals.artistId = newArtist?.insertId;
			// if(artistImg){
			// 	await upload.uploadArtistImageByUrl(req, res, next);
			// }
			res.json({ success: true });
		} catch (error) {
			console.error("Error in /add-artist:", error);
			res.status(500).json({ success: false, message: "Internal Server Error" });
		}
	});

	router.post("/artist/(*)/((accepted)|(rejected)|(pending))", (req,res,next) => {
		res.locals.redirectUrl = baseURL+req.originalUrl;
		next();
	}, paypalLogin.login, adminLogin, async (req, _res, next) => {
		try {
			const trackIds = req.body.commercial_only;
			const artist = req.params[0];
			const status = req.params[1] || req.params[2] || req.params[3];
			let qParams = "1";
			if (status == "accepted") {
				qParams = "accepted = 1";
			} else if (status == "rejected") {
				qParams = "accepted = 0 AND reviewed = 1";
			} else if (status == "pending") {
				qParams = "reviewed = 0";
			}
			await db.query("UPDATE tracks SET commercial_licence_only = 0 WHERE email = ? AND "+qParams, [artist])
			if (trackIds && trackIds.length > 0) {
				const placeholders = new Array(trackIds.length);
				placeholders.fill("?");
				await db.query("UPDATE tracks SET commercial_licence_only = 1 WHERE track_id IN ("+placeholders.join(",")+")", trackIds);
				next();
			} else {
				next();
			}
		} catch (_error) {
			next();
		}
	}, renderArtistTracks);

	router.get("/artist/(*)/((accepted)|(rejected)|(pending))", (req,res,next) => {
		res.locals.redirectUrl = baseURL+req.originalUrl;
		next();
	}, paypalLogin.login, adminLogin, renderArtistTracks);

	router.get("/artist", paypalLogin.login, adminLogin, async (_req, res) => {
		try {
			const featured = await getFeaturedArtists();
			const artists = await getArtists(featured);
			res.render("admin/artist", {"artists":artists});
		} catch (error) {
			renderError(res)(error)
		}
	});

	router.get("/artist/(*)/delete-photo", paypalLogin.login, adminLogin, async (req, res) => {
		try {
			await deleteArtistImage(req.params?.[0]);
			res.redirect("/admin/featured_artists");
		} catch (error) {
			console.log('in er',error)
			renderError(res)(error)
		}
	});

	router.get("/artist/(*)/delete", paypalLogin.login, adminLogin, async (req, res) => {
		try {
			const artistId = req.params[0];
			await db.query("DELETE FROM featured_artists WHERE id = ?", [artistId]);
			await deleteArtistImage(artistId);
			res.redirect("/admin/featured_artists");
		} catch (error) {
			renderError(res)(error)
		}
	});

	router.get("/artist/(*)", paypalLogin.login, adminLogin, async (req, res) => {
		try {
			const artists = await db.query("SELECT id, artist, job, text, image_url FROM featured_artists WHERE id = ?",[req.params[0]]);
			if (artists.length == 0) {
				res.sendStatus(404);
				return;
			}
			const featured = await getFeaturedArtists();
			const idx = featured.indexOf(artists[0].artist);
			if (idx > -1) {
				featured.splice(idx, 1);
			}
			const allArtists = await getArtists(featured);
			res.render("admin/artist", {"artist": artists[0], "artists": allArtists});
		} catch (error) {
			renderError(res)(error)
		}
	});

	router.post("/artist", multerUpload.single("image"), paypalLogin.login, adminLogin, async (req, res, next) => {
		try {
			if (req.body.id) {
				res.locals.artistId = req.body.id;
				await db.query("UPDATE featured_artists SET artist = ?, job = ?, text = ? WHERE id = ?", [req.body.artist, req.body.job, req.body.text, req.body.id]);
				next();
			} else if (req.file) {
				const result = await db.query("SELECT max(priority) AS `priority` FROM featured_artists");
				let priority = 1;
				if (result.priority != null) {
					priority = result.priority + 1;
				}
				if (priority > 3) {
					priority = null;
				}
				const insert = await db.query("INSERT INTO featured_artists (artist, job, text, priority) VALUES (?,?,?, ?)", [req.body.artist, req.body.job, req.body.text, priority]);
				res.locals.artistId = insert.insertId;
				next();
			} else {
				res.render("error",{"error":"You must upload a picture"});
			}
		} catch (error) {
			renderError(res)(error)
		}
	}, upload.uploadArtistImage, (_req, res) => {
		res.redirect("/admin/featured_artists");
	});

	router.get("/featured_artists", paypalLogin.login, adminLogin, async function(_req, res) {
		try {
			const artists = await db.query("SELECT id, artist, job, text, priority, image_url FROM featured_artists ORDER BY priority IS NOT NULL DESC, priority");
			const featured = artists.filter(artist => {
				return artist.priority;
			});
			const overflow = featured.splice(3);
			const other = artists.filter(artist => {
				return !artist.priority;
			});
			overflow.forEach(element => {
				other.unshift(element);
			});
			res.render("admin/featured_artists", {"featured": featured, "other": other});
		} catch (error) {
			renderError(res)(error)
		}
	});

	router.post("/featured_artists", paypalLogin.login, adminLogin, async function(req, res) {
		try {
			const ids = req.body.featured_artists.map(artist => {
				return artist.id;
			});
			await db.query("UPDATE featured_artists SET priority = NULL WHERE id NOT IN ("+ids.join(",")+")");
			await Promise.all(req.body.featured_artists.map(element => db.query("UPDATE featured_artists SET priority = ? WHERE id = ?", [element.priority, element.id])))
			res.sendStatus(200);
		} catch (error) {
			console.error(error);
			res.sendStatus(500);
		}
	});

	router.get("/featured_tracks", paypalLogin.login, adminLogin, async function(_req, res) {
		try {
			const tracks = await db.query("SELECT tracks.track_id AS `id`, title, artist, priority FROM tracks LEFT JOIN featured_tracks ON featured_tracks.track_id = tracks.track_id WHERE accepted = 1 ORDER BY priority IS NOT NULL DESC, priority");
			const featured = tracks.filter((track) => {
				return track.priority;
			});
			const other = tracks.filter((track) => {
				return !track.priority;
			});
			res.render("admin/featured_tracks", {"featured": featured, "other": other});
		} catch (error) {
			renderError(res)(error)
		}
	});

	router.post("/featured_tracks", paypalLogin.login, adminLogin, async (req, res) => {
		try {
			await db.query("DELETE FROM featured_tracks");
			const values = req.body.featured_tracks.map((val) => {
				return "("+val.id+", "+val.priority+")";
			}).join(",");
			await db.query("INSERT INTO featured_tracks (track_id, priority) VALUES "+values);
			res.sendStatus(200);
		} catch (error) {
			console.error(error);
			res.sendStatus(500);
		}
	});

	router.get("/playlist", paypalLogin.login, adminLogin, async function(_req, res) {
		try {
		  const tracks = await db.query("SELECT track_id AS `id`, title, artist, accepted, reviewed FROM tracks ORDER BY reviewed, accepted DESC, title, artist");
		  const accepted = tracks.filter(track => track.reviewed && track.accepted);
		  
		  const playlists = await db.query("SELECT playlist_id AS `id`, name FROM playlists");
	  
		  const playlistTracks = await db.query("SELECT playlist_id, track_id FROM playlisttracks");
	  
		  const playlistMap = {};
		  playlists.forEach(playlist => {
			playlistMap[playlist.id] = {
			  name: playlist.name,
			  tracks: []
			};
		  });
	  
		  const trackMap = {};
		  accepted.forEach(track => {
			trackMap[track.id] = {
			  title: track.title,
			  artist: track.artist,
			  playlists: []
			};
		  });

		  playlistTracks.forEach(pt => {
			if (playlistMap[pt.playlist_id]) {
			  playlistMap[pt.playlist_id].tracks.push(pt.track_id);
			}
			if (trackMap[pt.track_id]) {
			  trackMap[pt.track_id].playlists.push(pt.playlist_id);
			}
		  });

		  const trackArray = Object.keys(trackMap).map(id => ({
			id: parseInt(id, 10),
			title: trackMap[id].title,
			artist: trackMap[id].artist,
			playlists: trackMap[id].playlists
		  }));
	  
		  const playlistArray = Object.keys(playlistMap).map(id => ({
			id: parseInt(id, 10),
			name: playlistMap[id].name,
			tracks: playlistMap[id].tracks.map(trackId => {
			  const track = trackArray.find(t => t.id === trackId);
			  return track ? { id: track.id, title: track.title, artist: track.artist } : null;
			}).filter(t => t !== null)
		  }));
	  
		  res.render("admin/playlist.pug", {
			playlists: playlistArray,
			tracks: accepted
		  });
		} catch (error) {
		  renderError(res)(error);
		}
	  });

	router.post("/playlist/add", paypalLogin.login, adminLogin, async function(_req, res) {
    const { track_id, playlist_id } = _req.body;

    if (!track_id || !playlist_id) {
        return res.status(400).json({ error: 'Missing track_id or playlist_id' });
    }

    try {
        await db.query('INSERT INTO playlisttracks (playlist_id, track_id) VALUES (?, ?)', [playlist_id, track_id]);
        res.json({ message: 'Track added to playlist successfully' });
    } catch (error) {
        console.error('Error adding track to playlist:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
	});

	router.post('/playlist/remove', async (req, res) => {
		const { track_id, playlist_id } = req.body; 
	
		if (!track_id || !playlist_id) {
			return res.status(400).json({ error: 'Missing track_id or playlist_id' });
		}
	
		try {
			await db.query('DELETE FROM playlisttracks WHERE playlist_id = ? AND track_id = ?', [playlist_id, track_id]);
	
			res.json({ message: 'Track removed from playlist successfully' });
		} catch (error) {
			console.error('Error removing track from playlist:', error);
			res.status(500).json({ error: 'Internal server error' });
		}
	});

			router.get("/tracks-by-artist", async function(_req, res) {
				try {
					const artistName = _req.query?.name || "";
					const tracks = await db.query(`SELECT COUNT(*) as total_tracks
					FROM tracks 
					WHERE 
					  BINARY artist = ?
					`, 
					  [
						artistName,
					  ] 
					  );
					res.json({ tracks: tracks?.[0]?.total_tracks });
				} catch (error) {
					renderError(res)(error)
				}
			});
	

	router.get("/tracks", paypalLogin.login, adminLogin, async function(_req, res) {
		try {
			const tracks = await db.query("SELECT track_id AS `id`, title, artist, accepted, reviewed FROM tracks ORDER BY reviewed, accepted DESC, title, artist");
			const stemCounts = await db.query("SELECT track_id, COUNT(*) AS count FROM stems GROUP BY track_id");
			const stemCountMap = {};
			stemCounts.forEach(r => { stemCountMap[r.track_id] = r.count; });
			tracks.forEach(t => { t.stemCount = stemCountMap[t.id] || 0; });
			const unreviewed = tracks.filter(track => { return !track.reviewed; });
			const accepted = tracks.filter(track => { return track.reviewed && track.accepted; });
			const rejected = tracks.filter(track => { return track.reviewed && !track.accepted; });
			const moods = require("./moods.json");
			const genres = require("./genres.json");
			res.render("admin/tracks.pug", {
				"unreviewed": unreviewed,
				"accepted": accepted,
				"rejected": rejected,
				"moods": moods,
				"genres": genres
			});
		} catch (error) {
			renderError(res)(error)
		}
	});
	async function prepareTaggedTrack(id, format) {
		const NodeID3 = require("node-id3");
		const { exec } = require("child_process");
		const os = require("os");

		const tracks = await db.query("SELECT checksum, file_name, title, artist, writer, tempo FROM tracks WHERE track_id = ?", [id]);
		if (tracks.length == 0) {
			return null;
		}
		const track = tracks[0];
		const genres = await db.query("SELECT genre FROM genres WHERE track_id = ?", [id]);
		const moods = await db.query("SELECT mood FROM moods WHERE track_id = ?", [id]);

		const baseName = (track.file_name || (track.title + " " + track.artist)).replace(/[\/\\:*?"<>|]/g, "_");
		const audioFileName = baseName + "." + format;
		const filePath = path.resolve(__dirname, "static/tracks", track.checksum + "." + format);
		const genreStr = genres.map(g => g.genre).join(", ");
		const moodStr = moods.map(m => m.mood).join(", ");

		const metadataTxt = [
			"Title: " + (track.title || ""),
			"Artist: " + (track.artist || ""),
			"Writer/Composer: " + (track.writer || ""),
			"BPM: " + (track.tempo || ""),
			"Genre: " + genreStr,
			"Mood: " + moodStr,
			"Publisher: Sync-Audio",
			"Affiliate Society: PRS",
			"Comments: Contact at info@sync-audio.com"
		].join("\r\n");

		if (format === "mp3") {
			const tags = {
				title: track.title || "",
				artist: track.artist || "",
				composer: track.writer || "",
				bpm: track.tempo ? String(track.tempo) : "",
				genre: genreStr,
				publisher: "Sync-Audio",
				userDefinedText: [
					{ description: "Mood", value: moodStr },
					{ description: "Affiliate Society", value: "PRS" },
					{ description: "Comments", value: "Contact at info@sync-audio.com" }
				]
			};
			const fileBuffer = fs.readFileSync(filePath);
			const taggedBuffer = NodeID3.write(tags, fileBuffer);
			const tmpMp3 = path.join(os.tmpdir(), track.checksum + "_tagged.mp3");
			fs.writeFileSync(tmpMp3, taggedBuffer);
			return { audioFilePath: tmpMp3, audioFileName, baseName, metadataTxt, cleanup: true };
		} else {
			const tmpWav = path.join(os.tmpdir(), track.checksum + "_tagged.wav");
			const ffmpeg = "ffmpeg";
			// WAV's RIFF INFO chunk only supports a fixed set of tags (title/artist/genre/comment/album/date/encoder) —
			// unlike ID3, it has no mechanism for arbitrary custom-named fields, so everything else is packed into comment.
			const wavComment = [
				"Writer/Composer: " + (track.writer || ""),
				"BPM: " + (track.tempo || ""),
				"Mood: " + moodStr,
				"Publisher: Sync-Audio",
				"Affiliate Society: PRS",
				"Comments: Contact at info@sync-audio.com"
			].join(" | ");
			const cmd = `"${ffmpeg}" -i "${filePath}" -y `
				+ `-metadata title="${(track.title || "").replace(/"/g, '\\"')}" `
				+ `-metadata artist="${(track.artist || "").replace(/"/g, '\\"')}" `
				+ `-metadata genre="${genreStr.replace(/"/g, '\\"')}" `
				+ `-metadata comment="${wavComment.replace(/"/g, '\\"')}" `
				+ `-codec copy "${tmpWav}"`;
			return await new Promise((resolve) => {
				exec(cmd, (err) => {
					if (err) {
						console.error("FFmpeg metadata error:", err);
						resolve({ audioFilePath: filePath, audioFileName, baseName, metadataTxt, cleanup: false });
					} else {
						resolve({ audioFilePath: tmpWav, audioFileName, baseName, metadataTxt, cleanup: true });
					}
				});
			});
		}
	}

	async function downloadTrack(req, res, format) {
		try {
			const archiver = require("archiver");
			const id = req.params[0];
			const prepared = await prepareTaggedTrack(id, format);
			if (!prepared) {
				res.sendStatus(404);
				return;
			}
			const zipName = prepared.baseName + "." + format + ".zip";
			res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);
			res.setHeader("Content-Type", "application/zip");
			const archive = archiver("zip", { zlib: { level: 0 } });
			archive.on("error", (err) => { console.error("Archiver error:", err); });
			archive.pipe(res);
			archive.file(prepared.audioFilePath, { name: prepared.audioFileName });
			archive.append(Buffer.from(prepared.metadataTxt, "utf8"), { name: "metadata.txt" });
			archive.finalize().then(() => {
				if (prepared.cleanup) fs.unlink(prepared.audioFilePath, () => {});
			});
		} catch (error) {
			renderError(res)(error);
		}
	}

	async function bulkDownloadTracks(req, res) {
		try {
			const archiver = require("archiver");
			const format = req.query.format === "mp3" ? "mp3" : "wav";
			const ids = String(req.query.ids || "").split(",").map(s => s.trim()).filter(Boolean);
			if (ids.length === 0) {
				res.sendStatus(400);
				return;
			}
			const reviewedTracks = await db.query("SELECT track_id FROM tracks WHERE track_id IN (?) AND reviewed = 1", [ids]);
			const reviewedIds = new Set(reviewedTracks.map(t => String(t.track_id)));
			const preparedTracks = [];
			for (const id of ids) {
				if (!reviewedIds.has(String(id))) continue;
				const prepared = await prepareTaggedTrack(id, format);
				if (prepared) {
					preparedTracks.push(prepared);
				}
			}
			if (preparedTracks.length === 0) {
				res.sendStatus(404);
				return;
			}
			res.setHeader("Content-Disposition", `attachment; filename="tracks.${format}.zip"`);
			res.setHeader("Content-Type", "application/zip");
			const archive = archiver("zip", { zlib: { level: 0 } });
			archive.on("error", (err) => { console.error("Archiver error:", err); });
			archive.pipe(res);
			for (const prepared of preparedTracks) {
				archive.file(prepared.audioFilePath, { name: prepared.audioFileName });
				archive.append(Buffer.from(prepared.metadataTxt, "utf8"), { name: prepared.baseName + "_metadata.txt" });
			}
			archive.finalize().then(() => {
				for (const prepared of preparedTracks) {
					if (prepared.cleanup) fs.unlink(prepared.audioFilePath, () => {});
				}
			});
		} catch (error) {
			renderError(res)(error);
		}
	}

	router.get("/tracks/download", paypalLogin.login, adminLogin, bulkDownloadTracks);
	router.get("/tracks/(*)/download/wav", paypalLogin.login, adminLogin, (req, res) => downloadTrack(req, res, "wav"));
	router.get("/tracks/(*)/download/mp3", paypalLogin.login, adminLogin, (req, res) => downloadTrack(req, res, "mp3"));

	router.get("/stems/:stemId/download", paypalLogin.login, adminLogin, async (req, res) => {
		try {
			const stems = await db.query("SELECT s.*, t.title, t.artist FROM stems s JOIN tracks t ON s.track_id = t.track_id WHERE s.stem_id = ?", [req.params.stemId]);
			if (stems.length === 0) { res.sendStatus(404); return; }
			const stem = stems[0];
			const stemPath = path.resolve(__dirname, "static/stems", stem.checksum);
			const downloadName = stem.stem_type + " - " + stem.title + " - " + stem.artist + path.extname(stem.checksum);
			res.download(stemPath, downloadName);
		} catch (e) { renderError(res)(e); }
	});

	router.get("/stems/:stemId/delete", paypalLogin.login, adminLogin, async (req, res) => {
		try {
			const stems = await db.query("SELECT s.*, t.track_id FROM stems s JOIN tracks t ON s.track_id = t.track_id WHERE s.stem_id = ?", [req.params.stemId]);
			if (stems.length === 0) { res.sendStatus(404); return; }
			const stem = stems[0];
			const stemPath = path.resolve(__dirname, "static/stems", stem.checksum);
			await db.query("DELETE FROM stems WHERE stem_id = ?", [req.params.stemId]);
			fs.unlink(stemPath, () => {});
			res.redirect("/admin/tracks/" + stem.track_id);
		} catch (e) { renderError(res)(e); }
	});

	router.get("/tracks/(*)/delete", paypalLogin.login, adminLogin, async function(req, res) {
		try {
			const id = req.params[0];
			const tracks = await db.query("SELECT title, artist, email, checksum FROM tracks WHERE track_id = ?", [id]);
			if (tracks.length == 0) {
				res.sendStatus(404);
				return;
			}
			const track = tracks[0];
			await db.query("DELETE FROM moods WHERE track_id = ?", [id]);
			await db.query("DELETE FROM genres WHERE track_id = ?", [id]);
			await db.query("DELETE FROM featured_tracks WHERE track_id = ?", [id]);
			await db.query("DELETE FROM tracks WHERE track_id = ?", [id]);
			await removeConnectedArtistIfNoTracks(track.artist);
			try {
				await Promise.all([
					fs.promises.unlink('./static/tracks/'+track.checksum+'.wav').catch(err => { if (err.code !== "ENOENT") throw err; }),
					fs.promises.unlink('./static/tracks/'+track.checksum+'.mp3').catch(err => { if (err.code !== "ENOENT") throw err; }),
					fs.promises.unlink('./static/images/waveforms/'+track.checksum+'-gray.png').catch(err => { if (err.code !== "ENOENT") throw err; }),
					fs.promises.unlink('./static/images/waveforms/'+track.checksum+'-blue.png').catch(err => { if (err.code !== "ENOENT") throw err; })
				])
				if(track?.email){
					const message = {
						"from": "Sync-Audio <no-reply@sync-audio.com>",
						"to": track.email,
						"subject": "Track reviewed"
					};
				
					message.text = "Due to a large volume of recent submissions we were unable to accept your track "+track.title+" for publication on Sync-Audio. Please do not let this discourage you to upload more tracks. Thank you for sharing your music.";
					mailgun.messages().send(message).catch(err => {
						console.error("Failed to send a track review result notification to "+track.email, err)
					});
				}
			} catch (err) {
				console.warn(err)
			} finally {
				res.render("admin/track_deleted");
			}
		} catch (error) {
			renderError(res)(error)
		}
	});

	router.get("/tracks/(*)", paypalLogin.login, adminLogin, async function(req, res) {
		try {
			const id = req.params[0];
			const tracks = await db.query("SELECT tracks.track_id AS `id`,link, checksum, title, artist, genres.genre, moods.mood, writer, duration, tempo, accepted, reviewed, cae_number, master_recording_owner, tracks.date_added, tracks.date_reviewed FROM tracks LEFT OUTER JOIN genres ON tracks.track_id = genres.track_id LEFT OUTER JOIN moods ON moods.track_id = tracks.track_id WHERE tracks.track_id = ?", [id]);
			if (tracks.length == 0) {
				res.sendStatus(404);
				return;
			}
			const moods = require("./moods.json");
			const genres = require("./genres.json");
			const track = tracks[0];
			track.genres = [];
			track.moods = [];
			tracks.forEach(element => {
				if (element.genre && track.genres.indexOf(element.genre) == -1) {
					track.genres.push(element.genre);
				}
				if (element.mood && track.moods.indexOf(element.mood) == -1) {
					track.moods.push(element.mood);
				}
			});
			delete track.genre;
			delete track.mood;
			const stems = await db.query("SELECT stem_id, stem_type, file_name, checksum, uploaded_at FROM stems WHERE track_id = ?", [id]);
			res.render("admin/track",{"track":track, "genres": genres, "moods": moods, "stems": stems});
		} catch (error) {
			renderError(res)(error)
		}
	});
	router.post("/tracks/(*)", paypalLogin.login, adminLogin, async function(req, res) {
		try {
			const id = req.params[0];
			const track = req.body;
			if (track.accepted == "-1") {
				track.reviewed = 0;
				track.accepted = 0;
			} else {
				track.reviewed = 1;
			}
			let existingTrack = await db.query("SELECT email, accepted FROM tracks WHERE track_id = ?", [id]);
			if (existingTrack.length == 0) {
				res.status(404).send(`Track ${id} not found`)
				return
			}
			existingTrack = existingTrack[0]
			await db.query("UPDATE tracks SET title = ?, artist = ?, writer = ?, tempo = ?, accepted = ?, reviewed = ?, style = ? WHERE track_id = ?", [track.title, track.artist, track.writer, track.tempo, track.accepted, track.reviewed, track.style, id]);
			await db.query("DELETE FROM moods WHERE track_id = ?", [id]);
			if (track.mood && track.mood.length > 0) {
				const values = new Array(track.mood.length);
				values.fill("(?,?)");
				const args = [];
				track.mood.forEach(mood => {
					args.push(mood);
					args.push(id);
				});
				await db.query("INSERT INTO moods (mood, track_id) VALUES "+values.join(", "), args);
			}
			await db.query("DELETE FROM genres WHERE track_id = ?", [id]);
			if (track.genres && track.genres.length > 0) {
				const values = new Array(track.genres.length);
				values.fill("(?,?)");
				const args = [];
				track.genres.forEach(genre => {
					args.push(genre);
					args.push(id);
				});
				await db.query("INSERT INTO genres (genre, track_id) VALUES "+values.join(", "), args);
			}
			// if (track.reviewed == 1 && track.accepted != existingTrack.accepted && existingTrack.email && existingTrack.email != res.locals.paypalUserInfo.email) {
			if (track.reviewed == 1 && track.accepted != existingTrack.accepted && existingTrack.email) {
				const message = {
					"from": "Sync-Audio <no-reply@sync-audio.com>",
					"to": existingTrack.email,
					// "to": existingTrack.email,
					"subject": "Track reviewed"
				};
				if (track.accepted === '1' || track.accepted === 1) {
					message.text = "Congratulations. Your track "+track.title+" has been published by Sync-Audio. Let the good times roll.\nBest wishes,\nSync-Audio team";
				} else {
					message.text = "Due to a large volume of recent submissions we were unable to accept your track "+track.title+" for publication on Sync-Audio. Please do not let this discourage you to upload more tracks. Thank you for sharing your music.";
				}
				mailgun.messages().send(message).catch(err => {
					console.error("Failed to send a track review result notification to "+existingTrack.email, err)
				});
			}
			res.render("admin/track_saved", {"track":track});
		} catch (error) {
			renderError(res)(error)
		}
	});
	router.get("/artists", (req,res,next) => {
		res.locals.redirectUrl = baseURL+req.originalUrl;
		next();
	}, paypalLogin.login, adminLogin, async (_req, res) => {
		try {
			let currentPage = _req.query.page ? parseInt(_req.query.page) : 1;
			const limit = 40;
			const offset = (currentPage - 1) * limit;
			const result = await db.query("SELECT email, count(*) as `all`, sum(accepted) as `accepted`, count(*)-sum(reviewed) as `pending`,  CEIL((SELECT COUNT(DISTINCT email) FROM tracks WHERE email IS NOT NULL) / ?) AS total_pages FROM tracks WHERE email IS NOT NULL GROUP BY email ORDER BY email LIMIT ? OFFSET ?", [limit, limit, offset]);
			result.forEach((val)=>{
				val.rejected = val.all - val.accepted - val.pending;
			});			
			res.render("admin/artists", {"artists":result, total_pages: result?.[0]?.total_pages, current_page: currentPage});
		} catch (err) {
			renderError(res)(err)
		}
	});

	// Commercial licensees page removed from admin nav; routes disabled but logic kept for potential future use.
	// router.get("/commercial_licensees/(*)/delete-license", (req,res,next) => {
	// 	res.locals.redirectUrl = baseURL+req.originalUrl;
	// 	next();
	// }, paypalLogin.login, adminLogin, async (req, res) => {
	// 	try {
	// 		await db.query("delete from commercial_transaction_tracks where email = ? ", [req.params?.[0]]);
	// 		res.redirect("/admin/commercial_licensees");
	// 	} catch (error) {
	// 		console.log('in er',error)
	// 		renderError(res)(error)
	// 	}
	// });

	// router.get("/commercial_licensees", (req,res,next) => {
	// 	res.locals.redirectUrl = baseURL+req.originalUrl;
	// 	next();
	// }, paypalLogin.login, adminLogin, async (req, res) => {
	// 	try {
	// 		if (req.query.email && req.query.first_name && req.query.last_name) {
	// 			const result = await db.query("SELECT DATE_FORMAT(tx.date_created, '%D %M %Y %H:%i:%s') AS `date_created`, tx.paypal_status, t.title, t.artist, ctt.company, ctt.website, ctt.project_title, cl.use, cl.territory, clc.name, clc.description FROM commercial_transaction_tracks AS `ctt` JOIN tracks AS `t` ON (ctt.track_id = t.track_id) JOIN commercial_licences AS `cl` ON (cl.id = ctt.licence_id) JOIN commercial_licence_categories AS `clc` ON (clc.id = cl.category) JOIN transactions AS `tx` ON (tx.transaction_id = ctt.transaction_id) WHERE ctt.first_name = ? AND ctt.last_name = ? AND ctt.email = ? ORDER BY tx.date_created DESC", [req.query.first_name, req.query.last_name, req.query.email]);
	// 			res.render("admin/licensee_tracks", {"tracks":result, "first_name":req.query.first_name, "last_name":req.query.last_name, "email":req.query.email});
	// 		} else {
	// 			const result = await db.query("SELECT DISTINCT first_name, last_name, email FROM commercial_transaction_tracks ORDER BY email");
	// 			res.render("admin/commercial_licensees", {"licensees":result});
	// 		}
	// 	} catch (error) {
	// 		renderError(res)(error)
	// 	}
	// });

	router.get("/submissions/toggle", paypalLogin.login, adminLogin, async (_req, res) => {
		try {
			const result = await db.query("SELECT value FROM settings WHERE key_name = 'submissions_open'");
			const current = result[0].value === '1' ? '1' : '0';
			const newVal = current === '1' ? '0' : '1';
			await db.query("UPDATE settings SET value = ? WHERE key_name = 'submissions_open'", [newVal]);
			res.redirect("/admin/submissions/settings");
		} catch (error) {
			renderError(res)(error);
		}
	});

	router.get("/submissions/settings", paypalLogin.login, adminLogin, async (_req, res) => {
		try {
			const result = await db.query("SELECT value FROM settings WHERE key_name = 'submissions_open'");
			const submissionsOpen = result[0].value === '1';
			res.render("admin/submissions_settings", { submissionsOpen });
		} catch (error) {
			res.render("admin/submissions_settings", { submissionsOpen: true });
		}
	});

	router.get("/email_artists", paypalLogin.login, adminLogin, (req, res) => {
		res.render("admin/email_artists", { sent: req.query.sent ? parseInt(req.query.sent) : null });
	});

	router.post("/email_artists", paypalLogin.login, adminLogin, async (req, res) => {
		try {
			const { subject, message } = req.body;
			if (!subject || !message) { res.sendStatus(400); return; }
			const emailAll = req.body.all === "on";
			const manualEmails = (req.body.manual_emails || "").split(";").map(e => e.trim()).filter(Boolean);
			if (!emailAll && manualEmails.length === 0) {
				res.render("admin/email_artists", { error: "Enter at least one email, or check \"Email all artists\"." });
				return;
			}
			const emails = emailAll
				? await db.query("SELECT DISTINCT email FROM tracks WHERE email IS NOT NULL AND email != ''")
				: manualEmails.map(email => ({ email }));
			let sent = 0;
			for (const row of emails) {
				mailgun.messages().send({
					"from": "Sync-Audio <no-reply@sync-audio.com>",
					"to": row.email,
					"subject": subject,
					"text": message
				}).catch(err => console.error("Failed to email " + row.email, err));
				sent++;
			}
			res.redirect("/admin/email_artists?sent=" + sent);
		} catch (error) {
			renderError(res)(error);
		}
	});

	router.get("/", (req,res,next) => {
		res.locals.redirectUrl = baseURL+req.originalUrl
		next();
	}, paypalLogin.login, adminLogin, (_req, res) => {
		res.render("admin/index");
	});

	return router
}
