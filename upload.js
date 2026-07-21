module.exports = function(config) {
	const gm = require('gm');
	const crypto = require('crypto');
	const fs = require('fs');
	const Peak = require('peak');
	const db = require('./database.js')(config);
	const { exec } = require("child_process");
	const mailgun = require('mailgun-js')({"apiKey": config.mailgun.api_key, "domain": "sync-audio.com"});
	const path = require('path');

	function waveformToFile(waveform, filename, fillColour) {
		return new Promise((resolve,reject) => {
			const canvasHeight = 24;
			const bytes = new Uint8Array(waveform.length/2);
			for (let i=0; i<bytes.length; i++) {
				const substr = waveform.substr(i*2,2);
				bytes[i] = parseInt(substr, 16);
			}
			const waveformFloats = new Float32Array(bytes.buffer);
			const img = gm(waveformFloats.length*3, canvasHeight).fill("white").drawRectangle(0, 0, waveformFloats.length*3, canvasHeight).fill(fillColour);
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = fillColour;
			for (let i=0; i<waveformFloats.length; i++) {
				const h = waveformFloats[i] * canvasHeight;
				img.drawRectangle(i*3, canvasHeight-h, 2, h)
			}
			const path = "./static/images/waveforms/"+filename+".png";
			img.write(path, function(error) {
				if (error) {
					return reject(error)
				}
				resolve()
			})
		});
	}

	// const fileToSquareCanvas = (path, size, out) => {
	// 	return new Promise((resolve, reject) => {
	// 		const img = gm(path)
	// 		img.size(function(err, val) {
	// 			if (err) {
	// 				return reject(err)
	// 			}
	// 			let width = val.width;
	// 			let height = val.height;
	// 			let x = 0;
	// 			let y = 0;
	// 			const aspectRatio = width / height;
	// 			if (size) {
	// 				if (size > aspectRatio) {
	// 					width = size;
	// 					height = width / aspectRatio;
	// 				} else {
	// 					height = size;
	// 					width = height * aspectRatio;
	// 				}
	// 				x = width / 2 - val.width / 2
	// 				y = height / 2 - val.height / 2
	// 			}
	// 			// img.crop(width, height, x, y)
	// 			img.crop(width, height, Math.abs(x), Math.abs(y))
	// 			img.write(out, function(err) {
	// 				if (err) {
	// 					return reject(err)
	// 				}
	// 				return resolve()
	// 			})
	// 		})
	// 	});
	// };

	const fileToSquareCanvas = (path, size, out) => {
		return new Promise((resolve, reject) => {
			gm(path)
				.resize(size, size) // Resize while maintaining aspect ratio
				.gravity("Center") // Align image to center
				.background("white") // Padding color (you can also use "transparent")
				.extent(size, size) // Final square canvas
				.noProfile() // Optional: strip metadata
				.write(out, (err) => {
					if (err) return reject(err);
					resolve();
				});
		});
	};
	

	function convertWavToMp3(checksum) {
		return new Promise((resolve, reject) => {
			exec(`ffmpeg -i static/tracks/${checksum}.wav -y static/tracks/${checksum}.mp3`, (err) => {
				if (err) {
					return reject(err)
				}
				resolve()
			})
		})
	}

	function errorCallback(resolve, reject) {
		return function(error) {
			if (error) {
				return reject(error)
			}
			return resolve()
		}
	}

	function getTrackDuration(file) {
		return new Promise((resolve,reject) => {
			exec(`ffprobe -i ${file} -show_entries format=duration -v quiet -of default=noprint_wrappers=1:nokey=1`, (error, duration) => {
				if (error) {
					return reject(error)
				}
				resolve(parseFloat(duration.trim()))
			})
		})
	}

	function generateWaveform(trackChecksum, colour, suffix) {
		return new Promise((resolve, reject) => {
			exec(`ffmpeg -i static/tracks/${trackChecksum}.wav -f lavfi -i "color=c=black@0.0:s=656x24,format=rgba" -filter_complex "compand,showwavespic=s=656x24:colors=${colour}[fg];[1:v][fg]overlay=format=auto" -frames:v 1 -y static/images/waveforms/${trackChecksum}-${suffix}.png`, errorCallback(resolve, reject))
		})
	}

	function generateWaveforms(checksum) {
		return Promise.all([
			generateWaveform(checksum, "0x2DA7E0", "blue"),
			generateWaveform(checksum, "0x808080", "gray")
		])
	}

	// const generateWaveformImage = async (audioFilePath, outputFilePath, color) => {
	// 	const peak = new Peak(audioFilePath);
		
	// 	const waveformImage = await peak.render({
	// 		width: 1000,
	// 		height: 200,
	// 		color: color,
	// 		backgroundColor: 'white'
	// 	});

	// 	fs.writeFileSync(outputFilePath, waveformImage);
	// };

	// const generateWaveforms = async (checksum) => {
	// 	try {
	// 		await Promise.all([
	// 			generateWaveformImage(`static/tracks/${checksum}.wav`, `static/images/waveforms/${checksum}-blue.png`, 'blue'),
	// 			generateWaveformImage(`static/tracks/${checksum}.wav`, `static/images/waveforms/${checksum}-gray.png`, 'gray')
	// 		]);
	// 		console.log('Waveforms generated successfully.');
	// 	} catch (error) {
	// 		console.error('Error generating waveforms:', error);
	// 	}
	// };

	async function downloadImage  (imageUrl, outputPath) {
		const fetch = (await import("node-fetch")).default;
		const response = await fetch(imageUrl);

		if (!response.ok) {
			throw new Error(`Failed to fetch image: ${response.statusText}`);
		}
	
		return new Promise((resolve, reject) => {
			const writer = fs.createWriteStream(outputPath);
			response.body.pipe(writer);
			writer.on("finish", resolve);
			writer.on("error", reject);
		});
	};
	

	async function onUpload(req, res, track) {
		const results = await db.query("SELECT track_id FROM tracks WHERE checksum = ?",[track.checksum]);
		if (results.length > 0) {
			res.render("error", {"error":"Track already exists"});
			return;
		}
		const wavFile = 'static/tracks/'+track.checksum+'.wav';
		await fs.promises.copyFile(req?.file?.path || req.files?.track?.[0]?.path, wavFile);
		try {
			await fs.promises.rm(req?.file?.path || req.files?.track?.[0]?.path)
		} catch (_error) {
			// No matter
		}
		console.log('before===>')
		track.duration = await getTrackDuration(wavFile);
		await generateWaveforms(track.checksum);
		await convertWavToMp3(track.checksum);
		console.log('after before===>')
		const reviewed = res.locals.isAdminUser ? 1 : 0;
		const accepted = reviewed;
		const downloadName = (track.artist+" "+track.title).replace(/[/\\?%*:|"<>]/g, ' ').trim();
		/// change here, add db field and chnage here
		const result = await db.query("INSERT INTO tracks (checksum, title, artist, writer, duration, email, copyright_year, date_added, reviewed, accepted, tempo, style, file_name, cae_number, master_recording_owner, link) VALUES (?, ?, ?, ?, ?, ?, ?, now(), ?, ?, ?, ?, ?, ?, ?, ?)", [track.checksum, track.title, track.artist, track.writer, track.duration, res.locals.paypalUserInfo.email, track.copyrightYear, reviewed, accepted, track.tempo, track.style, downloadName, track.cae_number, track.master_recording_owner, track.link]);
		res.locals.track = track;
		res.locals.trackId = result.insertId;
		if (req.body.mood && req.body.mood.length > 0) {
			const values = new Array(req.body.mood.length);
			values.fill("(?,?)");
			const args = [];
			req.body.mood.forEach(mood => {
				args.push(mood);
				args.push(result.insertId);
			});
			await db.query("INSERT INTO moods (mood, track_id) VALUES "+values.join(", "), args);
		}
		if (req.body.genres && req.body.genres.length > 0) {
			const values = new Array(req.body.genres.length);
			values.fill("(?,?)");
			const args = [];
			req.body.genres.forEach(genre => {
				args.push(genre);
				args.push(result.insertId);
			});
			await db.query("INSERT INTO genres (genre, track_id) VALUES "+values.join(", "), args);
		}
		if(res.locals.paypalUserInfo.email){
			const message = {
				"to": res.locals.paypalUserInfo.email,
				"from": "Sync-Audio <no-reply@sync-audio.com>",
				"subject": "New track uploaded",
				"text": "A new track "+track.title+" has been uploaded to sync-audio.com"
			};
			const email = res.locals.paypalUserInfo.email
			mailgun.messages().send(message).catch(error => {
				console.error("Error sending track upload notification to "+email, error);
			});
		}
		if (!res.isAdminUser) {
			const users = await db.query("SELECT email FROM admin_users");
			users.forEach(user => {
				const message = {
					"to": user.email,
					"from": "Sync-Audio <no-reply@sync-audio.com>",
					"subject": "New track uploaded",
					"text": "A new track "+track.title+" has been uploaded to sync-audio.com. Please review the track at https://sync-audio.com/admin/tracks/"+result.insertId+"."
				};
				const email = user.email
				mailgun.messages().send(message).catch(error => {
					console.error("Error sending track upload notification to "+email, error);
				});
			});
		}
	}

	return {
		"uploadArtistImage": async(req, res, next) => {
			if (!res.locals.artistId) {
				res.sendStatus(500);
			}
			if (req?.file || req?.files?.image?.[0]) {
				// await db.query("UPDATE featured_artists SET image_url = ? WHERE id = ?", [null, res.locals.artistId]);
				fileToSquareCanvas(req?.file?.path || req?.files?.image[0]?.path, 400, "./static/images/artists/"+res.locals.artistId+".jpg").then(next).catch(error => {
					console.error(error);
					res.sendStatus(500);
				});
			} else {
				next();
			}
		},
		"uploadTrack": (req, res, next) => {
			if (req?.file || req.files?.track?.[0]) {
				const track = {
					"tempo": req.body.tempo,
					"title": req.body.title,
					"artist": req.body.artist,
					"writer": req.body.writer,
					"cae_number": req.body.cae_number,
					"copyrightYear": null,
					"style": req.body.style,
					"master_recording_owner": req.body.master_recording_owner,
					"link": req?.body?.link
				};
				if (!track.title || !track.artist || !track.writer || !track.master_recording_owner) {
					res.render("error",{"error":"Missing required parameters"});
					return;
				}
				const sha1Hash = crypto.createHash("sha1");
				const input = fs.createReadStream(req?.file?.path || req.files?.track?.[0]?.path);
				input.on("readable", () => {
					const data = input.read();
					if (data) {
						sha1Hash.update(data);
					} else {
						track.checksum = sha1Hash.digest('hex');
						// Convert to mp3
						onUpload(req, res, track).then(next).catch(error => {
							console.error(error)
							res.render("error", {"error": "Track upload failed"})
						});
					}
				});
			} else {
				res.render("error");
			}
		},
		"uploadArtistImageByUrl": async (req, res, next) => {
			if (!res.locals.artistId) {
				throw new Error("No artistId found"); 
			}
		
			const imageUrl = req.body.imageUrl;
			if (!imageUrl) {
				throw new Error("No imageUrl found");
			}
		
			try {
				const outputPath = path.join(__dirname, "static/images/artists", `${res.locals.artistId}.jpg`);
				await downloadImage(imageUrl, outputPath);
				console.log('output path===>', outputPath)
				const stats = fs.statSync(outputPath);
				console.log('stats==>', stats.size)
				if (stats.size === 0) {
					throw new Error("Downloaded file is empty");
				}
				await fileToSquareCanvas(outputPath, 400, outputPath); 
				next();   
			} catch (error) {
				console.error("Error in image processing:", error);
				throw error;
			}
		}
	};
}