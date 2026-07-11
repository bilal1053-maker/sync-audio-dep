module.exports = function(config, paypalLogin) {

    const express = require('express');
    const router = express.Router();
    const multer = require('multer');
    const upload = require('./upload.js')(config);
    const db = require('./database.js')(config);
    const payment = require("./payment.js")(config);
    const fs = require('fs');
    const PdfPrinter = require("pdfmake");
    const uuid = require("uuid/v4");
    const archiver = require("archiver");

    const multerUpload = multer({"dest":"./tmp/"});

    async function getUserUploadLimit(_req, res, next) {
        if (res.locals.isAdminUser) {
            res.locals.uploadPermitted = true;
            next();
            return;
        }
        res.locals.uploadPermitted = false;
        try {
            const settings = await db.query("SELECT value FROM settings WHERE key_name = 'submissions_open'");
            if (settings.length > 0 && settings[0].value !== '1') {
                res.locals.submissionsClosed = true;
            } else {
                const unreviewedCounts = await db.query("SELECT COUNT(track_id) as `unreviewed_count` FROM tracks WHERE email = ? AND reviewed = 0", [res.locals.paypalUserInfo.email]);
                res.locals.uploadPermitted = unreviewedCounts[0].unreviewed_count < 4;
            }
        } catch (error) {
            console.warn(error);
        } finally {
            next();
        }
    }

    function getUserTracks(email) {
        return db.query("SELECT track_id AS `id`, checksum, title, artist, duration, tempo, accepted, reviewed FROM tracks WHERE email = ?", [email]);
    }

    function getUserTransactions(email) {
        return db.query("SELECT transaction_id, date_created, paypal_status FROM transactions WHERE paypal_sender_email = ?", [email]);
    }

    async function getUserPurchases(email) {
        const transactions = await getUserTransactions(email);
        return payment.getTransactionTracks(transactions.map(val => {return val.transaction_id}));
    }

    function getUserShortlists(email) {
        return db.query("SELECT id, name FROM shortlists JOIN users ON (users.user_id = shortlists.user) WHERE users.email = ?", [email]);
    }

    function onError(res) {
        return (error) => {
            res.render("error",{"error": error});
        }
    }
    function formatDuration(trackDuration) {
        const durationMinutes = Math.floor(trackDuration / 60);
        const durationSeconds = Math.round(trackDuration % 60);
        return (durationMinutes+"").padStart(2, "0")+":"+(durationSeconds+"").padStart(2, "0");
    }

    function createPDF(content) {
        const fonts = {
            Helvetica: {
                normal: 'Helvetica',
                bold: 'Helvetica-Bold',
                italics: 'Helvetica-Oblique',
                bolditalics: 'Helvetica-BoldOblique'
            },
            Times: {
                normal: 'Times-Roman',
                bold: 'Times-Bold',
                italics: 'Times-Italic',
                bolditalics: 'Times-BoldItalic'
            },
        };
        const docDefinition = {
            pageSize: "A4",
            pageOrientation: "portrait",
            pageMargins: 40,
            content: content,
            styles: {
                h1: {
                    fontSize: 24,
                    bold: true,
                    margin: [0, 0, 0, 0]
                },
                h2: {
                    fontSize: 18,
                    bold: true,
                    margin: [0, 20, 0, 0]
                },
                h3: {
                    bold: true,
                    margin: [0, 20, 0, 0]
                },
                h4: {
                    margin: [0, 20, 0, 0]
                }
            },
            defaultStyle: {
                font: "Helvetica",
                fontSize: 10,
                lineHeight: 1.5,
                margin: [0, 5, 0, 5]
            }
        };
        const filename = __dirname+"/tmp/"+uuid()+'.pdf';
        const fileStream = fs.createWriteStream(filename);
        const printer = new PdfPrinter(fonts);
        const pdfDoc = printer.createPdfKitDocument(docDefinition);
        pdfDoc.pipe(fileStream);
        pdfDoc.end();
        return filename;
    }

    function zipDownload(_req, res) {
        const archive = archiver("zip");
        archive.on('finish', () => {
            fs.unlinkSync(res.locals.pdfFile);
        });
        archive.on('error', function(err) {
            throw err;
        });
        archive.file(res.locals.pdfFile, {name: "licence.pdf"});
        archive.file(res.locals.trackPath, {name: res.locals.trackFilename});
        res.setHeader("Content-Disposition", "attachment; filename=\""+res.locals.trackFilename+".zip\"");
        archive.pipe(res);
        archive.finalize();
    }

    function pdfDownload(_req, res) {
        const stream = fs.createReadStream(res.locals.pdfFile);
        stream.on("close", () => {
            fs.unlinkSync(res.locals.pdfFile);
        });
        res.setHeader("Content-Type", "application/pdf");
        stream.pipe(res);
    }

    async function prepareCommercialLicencePdf(req, res) {
        const licenceId = req.params.licenceId;
        const transactionId = req.params.transactionId;
        const trackId = req.params.trackId;
        const fileType = req.params.fileType;
        const result = await db.query("SELECT cl.id, clc.name, clc.description, cl.`use`, cl.territory, t.track_id, t.title, t.artist, t.writer, t.duration, t.master_recording_owner, t.checksum, t.file_name, ctt.first_name, ctt.last_name, ctt.company, ctt.email, ctt.website, ctt.project_title FROM commercial_licences AS `cl` LEFT JOIN commercial_licence_categories AS `clc` ON clc.id = cl.category LEFT JOIN commercial_transaction_tracks AS `ctt` ON ctt.licence_id = cl.id LEFT JOIN tracks AS `t` ON t.track_id = ctt.track_id WHERE cl.id = ? AND t.track_id = ? AND ctt.transaction_id = ?", [licenceId, trackId, transactionId]);
        if (result.length == 0) {
            res.status(404)
            throw new Error("Licence not found")
        }
        const item = result[0];
        const licenceHolderTable = {
            body: []
        };
        if (item.first_name) {
            licenceHolderTable.body.push(["First name", item.first_name]);
        }
        if (item.last_name) {
            licenceHolderTable.body.push(["Last name", item.last_name]);
        }
        if (item.company) {
            licenceHolderTable.body.push(["Company", item.company]);
        }
        if (item.email) {
            licenceHolderTable.body.push(["Email", item.email]);
        }
        if (item.website) {
            licenceHolderTable.body.push(["Website", item.website]);
        }
        if (item.project_title) {
            licenceHolderTable.body.push(["Project title", item.project_title]);
        }
        const trackTable = {
            body: [
                ["Title", item.title],
                ["Artist", item.artist],
                ["Duration", formatDuration(item.duration)]
            ]
        };
        if (item.writer) {
            trackTable.body.push(["Writer/composer", item.writer]);
        }
        if (item.master_recording_owner) {
            trackTable.body.push(["Master recording owner", item.master_recording_owner]);
        }
        const content = [
            {text: "Licence Agreement: "+item.name, style: "h1"},
            {text: item.description, style: "h3"},
            {text: "APPLICABLE TO A DOWNLOAD PURCHASE FROM SYNC-AUDIO AND YOU WILL BE BOUND BY THESE.", style: "h4"},
            {text: "Use", style: "h2"},
            item.use,
            {text: "Territory Covered by the Licence", style: "h2"},
            item.territory,
            {columns: [
                {
                    stack: [
                        {text: "Track Information", style: "h2"},
                        {table: trackTable}
                    ],
                    fontSize: 9
                },
                {
                    stack: [
                        {text: "Licence Holder", style: "h2"},
                        {table: licenceHolderTable}
                    ],
                    fontSize: 9
                }
            ]},
            {text: "Definitions", style: "h2"},
            "In these terms and conditions the following words shall have the following meanings: \"you\" \"your\" means the Person using the Service; “Service” means data Download transmission of a song or songs or other form of audio recording otherwise referred to as the Track or Tracks and other services offered by Sync-Audio under this licence Policy or otherwise for a Single Licence Usage; “Single Licence Usage” means the licence granted solely for the Track(s) within the scope of the licence usage permitted by this Policy: \"Track(s)\" means the Sync-Audio “audio file” downloaded by you from the Audio Library; “Audio Library” means the storage database from the Sync-Audio Platform; “Platform” means Sync-Audio website supplied to you on any other online or mobile media platform or off-line software application either by itself or together with the website; “Licensors” shall mean statutory rights owners whose Tracks are assigned to the Audio Library; \"we\" \"us\" means Sync-Audio, Kemp House, 152 City Road, London, EC1V 2NX, United Kingdom.",
            {ol: [
                {stack: [
                        {text: "Licence to Use", style: "h3"},
                        "We grant you a non-exclusive licence to use the Service for "+item.name+" to use in all audio and visual media and mobile platforms which may include, but are not limited to, CDs, DVDs, UGC, MP3’s, MP4’s, Internet Streaming, Podcasts, Streaming on Smart TV, Inter-Computer Streaming and File Sharing, Mobile File Sharing, Emails and Cloud Accounts as FREE File Sharing and Streaming service, and every branch and medium and formats known or presently unknown in the Territory of the world. You may NOT transfer, assign, sublicense, or otherwise distribute or enable a third party to use the Service or any part of Sync-Audio rights in the Track(s) for commercial purposes. You may NOT directly or indirectly contribute or provide any Licensed content for the purpose of artificial intelligence, machine learning and algorithmic development. Furthermore, you may NOT alter the fundamental character of the Track(s), remix, or make foreign adaptation of the Track(s). You further agree that all ISRC (International Standard Record Code) Encrypted and Embedded codes generated by Sync-Audio are the property of Sync-Audio and where physically possible all original file details must at all times include the full Title of the Track(s), the names of Authors, Performers, and Publishers where applicable."
                ],
                unbreakable: true},
                {stack: [
                    {text: "Default to Commercial Use Licence", style: "h3"},
                    "You accept that in the event that the Track(s) being a part of your Video or Film Sync which through internet exposure may derive so-called commercial interest as a so-called “internet hit” you agree that such occurrence will automatically invoke a ‘Commercial Use Licence’ which is neither negotiable nor transferable whether initiated directly by you or via any third parties that Sync-Audio and its licensors are properly credited and remunerated in accordance to Clause 5 on Royalty Rights in this Policy. You further agree to waiver any rights to any fees and advances eligible to any ‘original rights owners’ whereas Sync-Audio will have full rights to such fees and advances paid by any prospective commercial interest as it applies to Royalty Rights."
                ],
                unbreakable: true},
                {stack: [
                    {text: "Download Purchase", style: "h3"},
                    "You can purchase Track(s) as Downloads (so-called) at any time subject to the Purchase Prices determined by Sync-Audio from time to time. Until further notice the current Sync-Audio price is TBA (view receipt) per download of each Track. Sync-Audio maintains that its prices will be competitive to all users. There are no limits to the number of Track(s) you can purchase from the Audio Library under the terms and conditions of this Policy. All downloads and Licence purchases are perpetual and are subject to the “30-day policy” as stipulated in the Sync-Audio Payment Policy provided on the site."
                ],
                unbreakable: true},
                {stack: [
                    {text: "Fair Use Policy", style: "h3"},
                    "We and/or our licensors as the case may be, own all the copyright in sound recording, mechanical rights, digital rights performing rights and other intellectual property rights in and to the Service. By supplying you with the Service we have permitted you to use it strictly on the terms and conditions of this licence in accordance to Clause 2 above and therefore should not be treated as a transfer of any of our or our Licensors statutory rights."
                ],
                unbreakable: true},
                {stack: [
                    {text: "Royalty Rights", style: "h3"},
                    "We and/or our licensors as the case may be, will be entitled to receive or collect so-called Mechanical, Digital, Performance, Synchronisation and Licensing Rights (collectively the Statutory Rights so-called) applicable to all Rights Owners credited on each Track with respect to royalties derived from so-called ‘streaming’ from online websites. Sync-Audio reserve the right to receive advances (so-called) where applicable from activities derived from any ‘commercial use licence’ as stated in Clause 2 above. Sync-Audio reserves the right to register, assign all Tracks from its Audio Library for such collection from appropriate collection agencies societies and organisations in the territory."
                ],
                unbreakable: true},
                {stack: [
                    {text: "Customer Services", style: "h3"},
                    "If you need any help with the Service email us on info@sync-audio.com"
                ],
                unbreakable: true},
                {stack: [
                    {text: "Exclusion of warranties", style: "h3"},
                    "To the fullest extent permitted by applicable law, the Service is furnished to you \"as is\" without any warranty, conditions, representations or other terms regarding the Service from our licensors. Neither we nor our licensors warrant that the Service will meet your requirements or that the operation of the Service will be uninterrupted or error free. To the extent permitted by law we and our licensors disclaim and exclude all warranties, representations, conditions and other terms of any kind, express or implied or whether arising by statute, common law or otherwise. This clause does not affect your statutory rights."
                ],
                unbreakable: true},
                {stack: [
                    {text: "Limitation of Liability", style: "h3"},
                    "We or our licensors will not be liable to you for any compensation reimbursement or damages on account of the loss of present or prospective profits, loss of revenue, turnover of sales; loss of good will; loss or damage to reputation; loss of contracts or customers; loss of anticipated savings; loss of or damages to data or programs or any other reasons whatsoever or indirect, special, incidental or consequential damages whether arising in tort (including negligence) or contract and even if we or our licensors have been informed of the possibility of such losses or damages."
                ],
                unbreakable: true},
                {stack: [
                    {text: "Prohibition", style: "h3"},
                    "We or our licensors reserve the right to prohibit use of its songs/tracks downloaded from the Sync-Audio website or via any other websites in any combination or format as content in any rendered composite synchronisation of audio visual production caused by you where any such rendition of Sync-Audio contents is depicted in a derogatory or defamatory form causing discrimination or misrepresentation of any individuals or groups commonly known as ‘protected characteristics’ under the Equality Act 2010 and the Human Rights Acts 1998 you will be liable to any third parties seeking compensation reimbursement or damages for any such demeanour in breach of this prohibition clause."
                ],
                unbreakable: true},
                {stack: [
                    {text: "Termination", style: "h3"},
                    "This Licence shall terminate immediately without notice if “you” breach this Licence."
                ],
                unbreakable: true},
                {stack: [
                    {text: "Law and Jurisdiction", style: "h3"},
                    "These terms and conditions shall be governed by the laws of England and the parties hereby irrevocably submit to the exclusive jurisdiction of the English courts."
                ],
                unbreakable: true}
            ]}
        ];
        res.locals.pdfFile = createPDF(content);
        res.locals.trackPath = __dirname+"/static/tracks/"+item.checksum+"."+fileType;
        res.locals.trackFilename = item.file_name+"."+fileType;
    }

    async function prepareNonCommercialLicencePdf(req, res) {
        const licenceId = req.params.licenceId;
        const transactionId = req.params.transactionId;
        const trackId = req.params.trackId;
        const fileType = req.params.fileType;
        const result = await db.query("SELECT lt.id, lt.name, lt.description, t.track_id, t.title, t.artist, t.writer, t.duration, t.master_recording_owner, t.checksum, t.file_name FROM licence_types AS `lt` LEFT JOIN transaction_tracks AS `tt` ON tt.licence_type_id = lt.id LEFT JOIN tracks AS `t` ON t.track_id = tt.track_id WHERE lt.id = ? AND t.track_id = ? AND tt.transaction_id = ?", [licenceId, trackId, transactionId]);
        if (result.length == 0) {
            res.status(404);
            throw new Error("Licence not found");
        }
        const item = result[0];
        const trackTable = {
            body: [
                ["Title", item.title],
                ["Artist", item.artist],
                ["Duration", formatDuration(item.duration)]
            ]
        };
        if (item.writer) {
            trackTable.body.push(["Writer/Composer", item.writer]);
        }
        if (item.master_recording_owner) {
            trackTable.body.push(["Master recording owner", item.master_recording_owner]);
        }
        const content = [
            {text: "Licence Agreement: "+item.name, style: "h1"},
            {text: item.description, style: "h3"},
            {text: "APPLICABLE TO A DOWNLOAD PURCHASE FROM SYNC-AUDIO AND YOU WILL BE BOUND BY THESE.", style: "h4"},
            {stack: [
                {text: "Track Information", style: "h2"},
                {table: trackTable}
            ],
            fontSize: 9
            },
            {text:"Definitions", style:"h2"},
            {ol: [
                {stack: [
                    {text:"Licence to Use", style: "h3"},
                    "We grant you a non-exclusive licence to use the Service for "+item.name+" to use in all audio and visual media and mobile platforms which may include, but are not limited to, CDs, DVDs, UGC, MP3’s, MP4’s, Internet Streaming, Podcasts, Streaming on Smart TV, Inter-Computer Streaming and File Sharing, Mobile File Sharing, Emails and Cloud Accounts as FREE File Sharing and Streaming service, and every branch and medium and formats known or presently unknown in the Territory of the world. You may NOT transfer, assign, sublicense, or otherwise distribute or enable a third party to use the Service or any part of Sync-Audio rights in the Track(s) for commercial purposes. You may NOT directly or indirectly contribute or provide any Licensed content for the purpose of artificial intelligence, machine learning and algorithmic development. Furthermore, you may NOT alter the fundamental character of the Track(s), remix, or make foreign adaptation of the Track(s). You further agree that all ISRC (International Standard Record Code) Encrypted and Embedded codes generated by Sync-Audio are the property of Sync-Audio and where physically possible all original file details must at all times include the full Title of the Track(s), the names of Authors, Performers, and Publishers where applicable."
                ],
                unbreakable: true},
                {stack: [
                    {text:"Default to Commercial Use Licence", style: "h3"},
                    "You accept that in the event that the Track(s) being a part of your Video or Film Sync which through internet exposure may derive so-called commercial interest as a so-called “internet hit” you agree that such occurrence will automatically invoke a ‘Commercial Use Licence’ which is neither negotiable nor transferable whether initiated directly by you or via any third parties that Sync-Audio and its licensors are properly credited and remunerated in accordance to Clause 5 on Royalty Rights in this Policy. You further agree to waiver any rights to any fees and advances eligible to any ‘original rights owners’ whereas Sync-Audio will have full rights to such fees and advances paid by any prospective commercial interest as it applies to Royalty Rights."
                ],
                unbreakable: true},
                {stack: [
                    {text:"Download Purchase", style: "h3"},
                    "You can purchase Track(s) as Downloads (so-called) at any time subject to the Purchase Prices determined by Sync-Audio from time to time. Until further notice the current Sync-Audio price is TBA (view receipt) per download of each Track. Sync-Audio maintains that its prices will be competitive to all users. There are no limits to the number of Track(s) you can purchase from the Audio Library under the terms and conditions of this Policy. All downloads and Licence purchases are perpetual and are subject to the “30-day policy” as stipulated in the Sync-Audio Payment Policy provided on the site."
                ],
                unbreakable: true},
                {stack: [
                    {text:"Fair Use Policy", style: "h3"},
                    "We and/or our licensors as the case may be, own all the copyright in sound recording, mechanical rights, digital rights performing rights and other intellectual property rights in and to the Service. By supplying you with the Service we have permitted you to use it strictly on the terms and conditions of this licence in accordance to Clause 2 above and therefore should not be treated as a transfer of any of our or our Licensors statutory rights."
                ],
                unbreakable: true},
                {stack: [
                    {text:"Royalty Rights", style: "h3"},
                    "We and/or our licensors as the case may be, will be entitled to receive or collect so-called Mechanical, Digital, Performance, Synchronisation and Licensing Rights (collectively the Statutory Rights so-called) applicable to all Rights Owners credited on each Track with respect to royalties derived from so-called ‘streaming’ from online websites. Sync-Audio reserve the right to receive advances (so-called) where applicable from activities derived from any ‘commercial use licence’ as stated in Clause 2 above. Sync-Audio reserves the right to register, assign all Tracks from its Audio Library for such collection from appropriate collection agencies societies and organisations in the territory."
                ],
                unbreakable: true},
                {stack: [
                    {text:"Customer Services", style: "h3"},
                    "If you need any help with the Service email us on info@sync-audio.com"
                ],
                unbreakable: true},
                {stack: [
                    {text:"Exclusion of warranties", style: "h3"},
                    "To the fullest extent permitted by applicable law, the Service is furnished to you \"as is\" without any warranty, conditions, representations or other terms regarding the Service from our licensors. Neither we nor our licensors warrant that the Service will meet your requirements or that the operation of the Service will be uninterrupted or error free. To the extent permitted by law we and our licensors disclaim and exclude all warranties, representations, conditions and other terms of any kind, express or implied or whether arising by statute, common law or otherwise. This clause does not affect your statutory rights."
                ],
                unbreakable: true},
                {stack: [
                    {text:"Limitation of Liability", style: "h3"},
                    "We or our licensors will not be liable to you for any compensation reimbursement or damages on account of the loss of present or prospective profits, loss of revenue, turnover of sales; loss of good will; loss or damage to reputation; loss of contracts or customers; loss of anticipated savings; loss of or damages to data or programs or any other reasons whatsoever or indirect, special, incidental or consequential damages whether arising in tort (including negligence) or contract and even if we or our licensors have been informed of the possibility of such losses or damages."
                ],
                unbreakable: true},
                {stack: [
                    {text:"Prohibition", style: "h3"},
                    "We or our licensors reserve the right to prohibit use of its songs/tracks downloaded from the Sync-Audio website or via any other websites in any combination or format as content in any rendered composite synchronisation of audio visual production caused by you where any such rendition of Sync-Audio contents is depicted in a derogatory or defamatory form causing discrimination or misrepresentation of any individuals or groups commonly known as ‘protected characteristics’ under the Equality Act 2010 and the Human Rights Acts 1998 you will be liable to any third parties seeking compensation reimbursement or damages for any such demeanour in breach of this prohibition clause."
                ],
                unbreakable: true},
                {stack: [
                    {text:"Termination", style: "h3"},
                    "This Licence shall terminate immediately without notice if “you” breach this Licence."
                ],
                unbreakable: true},
                {stack: [
                    {text:"Law and Jurisdiction", style: "h3"},
                    "These terms and conditions shall be governed by the laws of England and the parties hereby irrevocably submit to the exclusive jurisdiction of the English courts."
                ],
                unbreakable: true}
            ]}
        ];
        res.locals.pdfFile = createPDF(content);
        res.locals.trackPath = __dirname+"/static/tracks/"+item.checksum+"."+fileType;
        res.locals.trackFilename = item.file_name+"."+fileType;
    }

    function prepareLicencePdf(commercial) {
        return async function(req, res, next) {
            try {
                if (commercial) {
                    await prepareCommercialLicencePdf(req, res)
                } else {
                    await prepareNonCommercialLicencePdf(req, res)
                }
                next()
            } catch (error) {
                onError(res)(error)
            }
        }
    }

    async function getOrCreateArtist (artistName){
            const existingArtist = await db.query("SELECT id from featured_artists where artist = ?", [artistName]);
            if(existingArtist?.[0]?.id){
                return existingArtist?.[0]?.id;
            } else {
              const result = await db.query("INSERT INTO featured_artists (artist, job, text, priority, image_url) VALUES (?,?,?,?,?)", [artistName, "", "", null, ""]);
                return result.insertId;
            }
    }

    router.get("/", paypalLogin.login, getUserUploadLimit, (_req, res) => {
        const email = res.locals.paypalUserInfo.email;
        getUserPurchases(email).then(tracks => {
            res.locals.uploadPermitted = false;
            res.render("account", {"purchases":tracks.nonCommercial, "comPurchases":tracks.commercial});
        }).catch(onError(res));
    });

    router.get("/shortlists", paypalLogin.login, async (req, res) => {
        const shortlists = await getUserShortlists(res.locals.paypalUserInfo.email);
        res.json(shortlists);
    });

    router.get("/download/com_:licenceId/:transactionId/:trackId.:fileType.zip", paypalLogin.login, prepareLicencePdf(true), zipDownload);

    router.get("/download/:licenceId/:transactionId/:trackId.:fileType.zip", paypalLogin.login, prepareLicencePdf(false), zipDownload);

    router.get("/download/com_:licenceId/:transactionId/:trackId.pdf", paypalLogin.login, prepareLicencePdf(true), pdfDownload);

    router.get("/download/:licenceId/:transactionId/:trackId.pdf", paypalLogin.login, prepareLicencePdf(false), pdfDownload);

    router.get("/download/(*).(*)", paypalLogin.login, (req, res) => {
        const email = res.locals.paypalUserInfo.email;
        getUserPurchases(email).then(tracks => {
            const purchases = tracks.nonCommercial;
            const comPurchases = tracks.commercial;
            let index = purchases.findIndex(val => {
                return val.checksum == req.params[0];
            });
            let track;
            if (index < 0) {
                index = comPurchases.findIndex(val => {
                    return val.checksum == req.params[0];
                });
                if (index < 0) {
                    res.sendStatus(403);
                    return;
                }
                track = comPurchases[index];
            } else {
                track = purchases[index];
            }
            const fileType = req.params[1] == "wav" ? "wav" : (req.params[1] == "mp3" ? "mp3" : null);
            if (!fileType) {
                res.sendStatus(404);
                return;
            }
            const contentType = "audio/"+fileType;
            res.setHeader("Content-Type", contentType);
            res.setHeader("Content-Disposition", "attachment; filename="+track.file_name+"."+fileType);
            res.sendFile(__dirname+"/static/tracks/"+track.checksum+"."+fileType);
        });
    });
    router.get("/submissions", (req, res, next) => {
        res.locals.redirectUrl = req.protocol+"://"+req.hostname+(process.env.PORT ? ":"+process.env.PORT : "")+"/account/submissions";
        next()
    }, paypalLogin.login, getUserUploadLimit, (_req, res) => {
        const email = res.locals.paypalUserInfo.email;
        getUserTracks(email).then((tracks) => {
            const moods = require("./moods.json");
            const genres = require("./genres.json");
            res.render("account", {"submissions": tracks, "moods": moods, "genres": genres});
        }).catch(onError(res));
    });
    router.get("/logout", paypalLogin.logout, (_req, res) => {
        res.redirect("/");
    });
    router.get("/delete_track/(*)", paypalLogin.login, (req, res) => {
        let query = "DELETE FROM tracks WHERE track_id = ?";
        const params = [req.params[0]];
        if (!res.locals.isAdminUser) {
            query += " AND email = ?";
            params.push(res.locals.paypalUserInfo.email);
        }
        db.query(query, params, (err) => {
            if (err) {
                res.render("error", {"error": JSON.stringify(err)});
            } else {
                res.redirect("/account");
            }
        });
    });
    router.post("/upload", multerUpload.fields([
        { name: 'track', maxCount: 1 },
        { name: 'image', maxCount: 1 }
      ]), paypalLogin.login, async(req, res, next) => {
        const artistId = await getOrCreateArtist(req.body.artist);
        res.locals.artistId = artistId;
        next();
    }, upload.uploadArtistImage,  upload.uploadTrack, (_req, res) => {
        res.render("uploaded", {"tracks":[res.locals.track]});
    });

    const multerStem = multer({ dest: "./tmp/", limits: { fileSize: 500 * 1024 * 1024 } });
    const STEM_TYPES = ["Instrumental", "Drums & Bass", "Acapella"];

    router.get("/stems/:trackId", paypalLogin.login, async (req, res) => {
        try {
            const email = res.locals.paypalUserInfo.email;
            const trackId = req.params.trackId;
            const tracks = await db.query(
                "SELECT track_id AS id, title, artist FROM tracks WHERE track_id = ? AND email = ?",
                [trackId, email]
            );
            if (tracks.length === 0) { res.sendStatus(403); return; }
            const existingStems = await db.query(
                "SELECT stem_type FROM stems WHERE track_id = ?", [trackId]
            );
            const uploadedTypes = existingStems.map(s => s.stem_type);
            res.render("stems", { track: tracks[0], stemTypes: STEM_TYPES, uploadedTypes, saved: !!req.query.saved });
        } catch (e) { res.render("error", { error: e }); }
    });

    router.post("/stems/:trackId", multerStem.fields(
        STEM_TYPES.map(t => ({ name: t, maxCount: 1 }))
    ), paypalLogin.login, async (req, res) => {
        try {
            const email = res.locals.paypalUserInfo.email;
            const trackId = req.params.trackId;
            const tracks = await db.query(
                "SELECT track_id AS id, title, artist FROM tracks WHERE track_id = ? AND email = ?",
                [trackId, email]
            );
            if (tracks.length === 0) { res.sendStatus(403); return; }
            const stemsDir = require("path").resolve(__dirname, "static/stems");
            if (!fs.existsSync(stemsDir)) fs.mkdirSync(stemsDir);
            for (const stemType of STEM_TYPES) {
                const fileArr = req.files && req.files[stemType];
                if (!fileArr || fileArr.length === 0) continue;
                const file = fileArr[0];
                const ext = require("path").extname(file.originalname).toLowerCase() || ".wav";
                const checksum = require("uuid/v4")();
                const destPath = require("path").join(stemsDir, checksum + ext);
                fs.renameSync(file.path, destPath);
                await db.query("DELETE FROM stems WHERE track_id = ? AND stem_type = ?", [trackId, stemType]);
                await db.query(
                    "INSERT INTO stems (track_id, stem_type, file_name, checksum) VALUES (?, ?, ?, ?)",
                    [trackId, stemType, file.originalname, checksum + ext]
                );
            }
            res.redirect("/account/stems/" + trackId + "?saved=1");
        } catch (e) { res.render("error", { error: e }); }
    });

    return router;
}