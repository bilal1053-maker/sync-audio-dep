const SIGNATURE = "\n\nThe Sync-Audio Team\n\n124 City Road,\nLondon EC1V 2NX\nUnited Kingdom\n\nJoin: sync-audio.com\nE: info@sync-audio.com\n\nThis email is the property of Sync-Audio and may contain information that is confidential, privileged or otherwise protected from disclosure. It is intended for the sole use of the person or entity to whom it is addressed and if you are not the person or organisation to whom it is addressed, you must not copy, distribute, or take any action in reliance upon it. If you have received this communication in error, please notify Sync-Audio immediately. Sync-Audio runs anti-virus software, Please ensure that you have adequate virus protection before you open or detach any documents from this transmission. Sync-Audio does not accept any liability for viruses and cannot be held responsible for any infected files that you may receive.";

module.exports = function withSignature(text) {
	return (text || "") + SIGNATURE;
};
