module.exports = function(config, paypalLogin) {
    const express = require('express');
    const router = express.Router();
    const db = require('./database.js')(config);
    const url = require("url");
    const protobuf = require("protobufjs");
    const baseURL = "https://"+url.parse(config.paypal_sdk.return_url).host

    function setRedirectURL(req, res, next) {
        res.locals.redirectUrl = baseURL+req.originalUrl;
        next();
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

    async function getUserIdFromResponse(res) {
        const email = res.locals.paypalUserInfo.email;
        const result = await db.query("SELECT user_id FROM users WHERE email = ?", [email]);
        if (result.length == 0) {
            throw new Error("User not found");
        }
        return result[0].user_id;
    }

    async function replaceTracksInShortlist(trackIds, shortlistId) {
        const placeholders = new Array(trackIds.length);
        placeholders.fill("(?, ?)");
        const values = [];
        for (const trackId of trackIds) {
            values.push(shortlistId, trackId);
        }
        await db.query("DELETE FROM shortlist_tracks WHERE shortlist_id = ?", [shortlistId]);
        if (trackIds.length > 0) {
            await db.query("INSERT INTO shortlist_tracks (shortlist_id, track_id) VALUES "+placeholders.join(","), values);
        }
    }

    async function getTracksByIds(trackIds) {
        const inPlaceholder = new Array(trackIds.length);
        inPlaceholder.fill("?")
        const result = await db.query("SELECT tracks.track_id AS `id`, checksum, title, artist, genres.genre, moods.mood, duration, style, tempo, 1 AS `featured` FROM tracks LEFT OUTER JOIN genres ON genres.track_id = tracks.track_id LEFT OUTER JOIN moods ON moods.track_id = tracks.track_id WHERE accepted = 1 AND tracks.track_id IN ("+inPlaceholder.join(",")+") ORDER BY title", trackIds);
        const tracks = [];
        result.forEach(element => {
            let index = tracks.findIndex(val => {
                return val.id == element.id;
            });
            if (index == -1) {
                element.genres = [];
                element.moods = [];
                tracks.push(element);
                index = tracks.length - 1;
            }
            if (element.genre && tracks[index].genres.indexOf(element.genre) == -1) {
                tracks[index].genres.push(element.genre);
            }
            if (element.mood && tracks[index].moods.indexOf(element.mood) == -1) {
                tracks[index].moods.push(element.mood);
            }
            tracks[index].genre = tracks[index].genres.join(", ");
            tracks[index].mood = tracks[index].moods.join(", ");
        });
        return tracks;
    }

    async function encodeShortlist(list) {
        const root = await protobuf.load("proto/shortlist.proto");
        const Shortlist = root.lookupType("syncaudio.Shortlist");
        const msg = Shortlist.create(list);
        const encoded = Shortlist.encode(msg).finish();
        return Buffer.from(encoded).toString("base64");
    }

    async function decodeShortlist(base64Encoded) {
        const encodedShortlist = Buffer.from(base64Encoded, "base64");
        const root = await protobuf.load("proto/shortlist.proto")
        const Shortlist = root.lookupType("syncaudio.Shortlist");
        const message = Shortlist.decode(encodedShortlist);
        const list = Shortlist.toObject(message);
        const tracks = await getTracksByIds(list.tracks);
        return {"name": list.name, "tracks": tracks, "encoded": base64Encoded};
    }

    async function addShortlist(res, name, trackId) {
        if (!res.locals.shortlists) {
            res.locals.shortlists = [];
        }
        trackId = parseInt(trackId);
        let added = false;
        for (const list of res.locals.shortlists) {
            if (list.name == name) {
                if (list.tracks.indexOf(trackId) == -1) {
                    list.tracks.push(trackId);
                }
                list.encoded = await encodeShortlist(list);
                added = true;
                break;
            }
        }
        if (!added) {
            const encoded = await encodeShortlist({"name": name, "tracks": [trackId]});
            res.locals.shortlists.push({"name": name, "tracks": [trackId], "encoded": encoded});
        }
        const encodedShortlists = res.locals.shortlists.map(list => list.encoded);
        res.cookie("shortlists", JSON.stringify(encodedShortlists));
    }

    async function removeTrackFromShortlist(res, name, trackId) {
        if (!res.locals.shortlists) {
            res.locals.shortlists = [];
        }
        trackId = parseInt(trackId);
        for (let i=0; i<res.locals.shortlists.length; i++) {
            const list = res.locals.shortlists[i];
            if (list.name == name) {
                const trackIndex = list.tracks.indexOf(trackId);
                if (trackIndex >= 0) {
                    list.tracks.splice(trackIndex, 1);
                }
                if (list.tracks.length == 0) {
                    res.locals.shortlists.splice(i, 1);
                } else {
                    list.encoded = await encodeShortlist(list);
                }
                break;
            }
        }
        const encodedShortlists = res.locals.shortlists.map(list => list.encoded);
        if (encodedShortlists.length > 0) {
            res.cookie("shortlists", JSON.stringify(encodedShortlists));
        } else {
            res.clearCookie("shortlists");
        }
    }

    router.get("/", async (req, res) => {
        if (req.query && req.query.name && req.query.track) {
            await addShortlist(res, req.query.name, req.query.track);
        } else if (req.query && req.query.name && req.query.remove) {
            await removeTrackFromShortlist(res, req.query.name, req.query.remove);
        }
        if (req.query && req.query.name) {
            for (const list of res.locals.shortlists) {
                if (list.name == req.query.name && list.encoded) {
                    res.redirect("/shortlist/"+list.encoded);
                    return;
                }
            }
        }
        res.render("shortlists",{active:'/shortlists'});
    });

    router.get("/(*)", async function(req, res) {
        try {
            const shortlist = await decodeShortlist(req.params[0]);
            let licences = await getLicences();
				licences = Object.values(licences);
				licences.filter(val => {
					return val.id != 10;
				});
            shortlist.tracks.forEach(track => {
                const durationMinutes = Math.floor(track.duration / 60);
                const durationSeconds = Math.round(track.duration % 60);
                track.formattedDuration = `${String(durationMinutes).padStart(2, '0')}:${String(durationSeconds).padStart(2, '0')}`;
            });
            shortlist.showingShortlist = true;
            shortlist.licences = licences;
            // console.log(shortlist)
            res.render("shortlist", shortlist);
        } catch (error) {
            res.render("error",{"error":error});
        }
    });

    router.post("/", async function(req, res) {
        try {
            const trackId = req.body.track;
            const name = req.body.name;
            if (!name) {
                throw new Error("Shortlist name not supplied");
            }
            if (trackIds.length == 0) {
                throw new Error("No tracks submitted");
            }
            await addShortlist(res, name, trackId);
            res.render("shortlists");
        } catch (error) {
            res.render("error", {"error": error});
        }
    });

    router.post("/(*)", setRedirectURL, paypalLogin.login, async function(req, res) {
        try {
            const trackIds = req.body.tracks;
            const userId = getUserIdFromResponse(res);
            const shortlistId = req.params[0];
            const result = await db.query("SELECT user FROM shortlists WJERE id = ?", [shortlistId]);
            if (result.length == 0) {
                throw new Error("Shortlist does not exist");
            }
            if (result[0].user != userId) {
                throw new Error("You are not authorized to edit this shortlist");
            }
            await replaceTracksInShortlist(trackIds, shortlistId);
            res.redirect(router.baseUrl + "/" + shortlistId);
        } catch (error) {
            res.render("error", {"error": error});
        }
    });

    return router;
}