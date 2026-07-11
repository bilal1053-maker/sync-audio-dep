$(function() {
	var submitButton = $("a.button.submit");
	var tncCheckbox = $("input[name='tnc']");
	var uploadButton = $(":submit");
	function updateUploadButton() {
		submitButton.toggleClass("disabled", !tncCheckbox.prop("checked") || !audioProcessed);
		uploadButton.prop("disabled", !audioProcessed);
	}
	tncCheckbox.on("change", updateUploadButton);
	submitButton.on("click", function(){
		if ($("input[name='style']:checked").length == 0) {
			alert("Please select a style for your track.");
			return false;
		}
		if (!$("input[name='title']").val().trim()) {
			alert("Please enter a track title");
			return false;
		}
		if (!$("input[name='artist']").val().trim()) {
			alert("Please enter artist");
			return false;
		}
		if (!$("input[name='writer']").val().trim()) {
			alert("Please enter writer/composer");
			return false;
		}
		if (!$("input[name='master_recording_owner']").val().trim()) {
			alert("Please enter master recording owner");
			return false;
		}
		if (!tncCheckbox.prop("checked")) {
			alert("You must accept the terms and conditions before submitting your tracks.");
		} else if (!audioProcessed) {
			alert("Please wait for the audio track to finish processing");
		} else {
			formDiv.hide();
			processingDiv.text("Uploading. Please wait.").show();
			$("form.upload").submit();
		}
	});
	$(":submit, a.button.submit:not(.disabled)").on("click", function(){
		$(".uploading").show();
		$(".uploadForm").hide();
	});
	$(window).bind("pageshow", updateUploadButton);
	var audioProcessed = false;
	function getPeaks(data) {
		// What we're going to do here, is to divide up our audio into parts.
		
		// We will then identify, for each part, what the loudest sample is in that
		// part.
		
		// It's implied that that sample would represent the most likely 'beat'
		// within that part.
		
		// Each part is 0.5 seconds long - or 22,050 samples.
		
		// This will give us 60 'beats' - we will only take the loudest half of
		// those.
		
		// This will allow us to ignore breaks, and allow us to address tracks with
		// a BPM below 120.
		
		var partSize = 22050,
			parts = data[0].length / partSize,
			peaks = [];
		
		for (var i = 0; i < parts; i++) {
			var max = 0;
			for (var j = i * partSize; j < (i + 1) * partSize; j++) {
			var volume = Math.max(Math.abs(data[0][j]), Math.abs(data[1][j]));
			if (!max || (volume > max.volume)) {
				max = {
				position: j,
				volume: volume
				};
			}
			}
			peaks.push(max);
		}
		
		// We then sort the peaks according to volume...
		
		peaks.sort(function(a, b) {
			return b.volume - a.volume;
		});
		
		// ...take the loundest half of those...
		
		peaks = peaks.splice(0, peaks.length * 0.5);
		
		// ...and re-sort it back based on position.
		
		peaks.sort(function(a, b) {
			return a.position - b.position;
		});
		
		return peaks;
	}
	
	function getIntervals(peaks) {
	
		// What we now do is get all of our peaks, and then measure the distance to
		// other peaks, to create intervals.  Then based on the distance between
		// those peaks (the distance of the intervals) we can calculate the BPM of
		// that particular interval.
		
		// The interval that is seen the most should have the BPM that corresponds
		// to the track itself.
		
		var groups = [];
		
		peaks.forEach(function(peak, index) {
			for (var i = 1; (index + i) < peaks.length && i < 10; i++) {
				var group = {
					tempo: (60 * 44100) / (peaks[index + i].position - peak.position),
					count: 1
				};
			
				while (group.tempo < 90) {
					group.tempo *= 2;
				}
			
				while (group.tempo > 180) {
					group.tempo /= 2;
				}
			
				group.tempo = Math.round(group.tempo);
			
				if (!(groups.some(function(interval) {
					return (interval.tempo === group.tempo ? interval.count++ : 0);
				}))) {
					groups.push(group);
				}
			}
		});
		return groups;
	}

	var fileInput = $("input[name='track']");
	var formDiv = $("div.uploadForm");
	var processingDiv = $("div.processing");
	fileInput.on("change", function() {
		formDiv.hide();
		processingDiv.show();
		audioProcessed = false;
		updateUploadButton();
		var file = this.files[0];
		var reader = new FileReader();
		reader.onerror = function(e) {
			formDiv.hide();
			processingDiv.show();
			fileInput.value = ""
			alert("Failed to process audio file")
		}
		reader.onload = function(e) {
			var arraybuffer = e.target.result;
			var arraybufferCopy = arraybuffer.slice(0);
			var OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
			var sampleRate = 44100;
			var offlineContext = new OfflineContext(2, 30 * sampleRate, sampleRate);

			offlineContext.decodeAudioData(arraybuffer, function(buffer) {

				// Create buffer source
				var source = offlineContext.createBufferSource();
				source.buffer = buffer;
		
				// Beats, or kicks, generally occur around the 100 to 150 hz range.
				// Below this is often the bassline.  So let's focus just on that.
		
				// First a lowpass to remove most of the song.
		
				var lowpass = offlineContext.createBiquadFilter();
				lowpass.type = "lowpass";
				lowpass.frequency.value = 150;
				lowpass.Q.value = 1;
		
				// Run the output of the source through the low pass.
		
				source.connect(lowpass);
		
				// Now a highpass to remove the bassline.
		
				var highpass = offlineContext.createBiquadFilter();
				highpass.type = "highpass";
				highpass.frequency.value = 100;
				highpass.Q.value = 1;
		
				// Run the output of the lowpass through the highpass.
		
				lowpass.connect(highpass);
		
				// Run the output of the highpass through our offline context.
		
				highpass.connect(offlineContext.destination);
		
				// Start the source, and render the output into the offline conext.
		
				source.start(0);
				offlineContext.startRendering();
			});
		
			offlineContext.oncomplete = function(e) {
				var buffer = e.renderedBuffer;
				var peaks = getPeaks([buffer.getChannelData(0), buffer.getChannelData(1)]);
				var groups = getIntervals(peaks);
		
				var top = groups.sort(function(intA, intB) {
					return intB.count - intA.count;
				}).splice(0, 1);

				$("input[name='tempo']").val(top[0].tempo);

				audioProcessed = true;
				formDiv.show();
				processingDiv.hide();
				updateUploadButton();
			};
		};
		if (file) {
			reader.readAsArrayBuffer(file);
		}
	});

	$(document).on("click", "button[id^='artistName_']", function () {
		const buttonId = this.id;
	
		console.log("Button ID:", buttonId);
		$.ajax({
			url: "/admin/add-artist",
			type: "POST",
			contentType: "application/json",
			data: JSON.stringify({
			artist: buttonId?.split('_')?.[1]
		 }),
		success: function(response) {
			if(response?.success){
				console.log("Artist Added Successfully", response);
				window.location.href = "/admin/featured_artists";
			} else {
				alert('Error while adding artist');
			}
		},
		error: function(xhr, status, error) {
			console.error("Error while Adding Artist", error);
			alert('Error while adding artist');
		}
		});
	});
});