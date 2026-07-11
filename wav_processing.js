const wav = require("node-wav");
const fs = require("fs");
const MusicTempo = require("music-tempo");

function Audio(path) {
	this.path = path;
	this.channelData;
	this.sampleRate;
	var _this = this;
	function convert(callback) {
		if (_this.channelData && _this.sampleRate) {
			callback();
			return;
		}
		fs.readFile(path, (err, buffer) => {
			if (!err && buffer) {
				var result = wav.decode(buffer);
				_this.channelData = result.channelData;
				_this.sampleRate = result.sampleRate;
				callback();
			} else {
				callback(err);
			}
		});
	};
	this.waveform = (callback) => {
		convert((err) => {
			if (err) {
				callback(err);
				return;
			}
			var i = 0;
			var chunked = [];
			var trackPixelWidth = 800;
			var chunkSize = Math.floor(_this.channelData[0].length / trackPixelWidth);
			_this.channelData[0].forEach((sample) => {
				if (chunked.length == trackPixelWidth) {
					return false;
				}
				var mod = i & chunkSize;
				if (mod == 0) {
					chunked.push(0);
				}
				chunked[chunked.length-1] += sample / chunkSize;
				i++;
			});
			var min = chunked.reduce((previous,current) => {
				return Math.min(previous, current);
			});
			var max = chunked.reduce((previous,current) => {
				return Math.max(previous, current);
			});
			var gamut = max - min;
			chunked = chunked.map((val,index,arr) => {
				return (val - min) / gamut;
			});
			callback(null, chunked);
		});
	};
	this.bpm = (callback) => {
		convert((err) => {
			if (err) {
				callback(err);
				return;
			}
			var tempo = new MusicTempo(_this.channelData[0]);
			callback(null, tempo.tempo);
		});
	}
}

module.exports = {
	"Audio": Audio
};