$(function(){
	// function search(query) {
	// 	query = query.trim();
	// 	// fetch(`/music?search=${encodeURIComponent(query)}`, { headers: { "X-Requested-With": "XMLHttpRequest" } })
    //     // .then(response => response.json()) // Expect JSON response
    //     // .then(data => {
	// 	// 	console.log('data===>', data)
    //     //     // const trackList = document.getElementById("trackList");
    //     //     // trackList.innerHTML = ""; // Clear previous list

    //     //     // if (data.tracks.length === 0) {
    //     //     //     trackList.innerHTML = "<li>No results found</li>";
    //     //     //     return;
    //     //     // }

    //     //     // data.tracks.forEach(track => {
    //     //     //     const li = document.createElement("li");
    //     //     //     li.textContent = `${track.title} - ${track.artist}`;
    //     //     //     trackList.appendChild(li);
    //     //     // });
    //     // })
    //     // .catch(error => {console.error("Error:", error)});
	// 	if (query.length == 0 && filtered.length == allTracks.length) {
	// 		$("div.track").hide();
	// 		$("div.track.featured").show();
	// 	} else if (query.length == 0) {
	// 		var tracks = filtered.map(function(track){
	// 			return track.id;
	// 		});
	// 		$("div.track").hide().filter(function(index,track) {
	// 			return tracks.indexOf(track.id) > -1;
	// 		}).show();
	// 	} else {
	// 		// var fuse = new Fuse(filtered, {
	// 		// 	"keys":["artist","title"],
	// 		// 	"id":"id"
	// 		// });
	// 		// console.log('in if===>111fuse===>', fuse, filtered)
	// 		// var tracks = fuse.search(query);
	// 		const lowerQuery = query.toLowerCase();
	// 		var tracks = filtered.map((val, ind) => {
	// 			if(val.artist.toLowerCase().includes(lowerQuery) || val.title.toLowerCase().includes(lowerQuery)){
	// 				return val.id;
	// 			}
	// 		}).filter((val) => val >=0)
	// 		$("div.track").hide().filter(function(index,track) {
	// 			return tracks.indexOf(track.id) > -1;
	// 		}).show();
	// 	}
	// }
	function search(query) {
		query = query.trim();
		const lowerQuery = query.toLowerCase();
		const paginationEle = $('#custom_pagination');
		var currentUrl = new URL(window.location.href);    
		const currentPage = currentUrl.searchParams.get('page') || 1;

		if(filtered?.length !== allTracks?.length || query?.length > 0){
			paginationEle.hide();
		} else {
			paginationEle.show();
		}


		if(!query && filtered?.length !== allTracks?.length){
			const filteredIds = filtered.map((val) => val?.id);
			$("div.track").each(function () {
				const track = $(this);
				track.attr("data-show", filteredIds.includes(track.data("id")?.toString()) ? "show-it" : "hide-it");
			})
			return;
		}
	
		if (!query) {
			// Reset to show only first 20 tracks (default view)
			$("div.track").each(function (index) {
				if(currentPage === 1){
					$(this).attr("data-show", index < 20 ? "show-it" : "hide-it");
				} else {
					$(this).attr("data-show", index>=(currentPage - 1)*20 && index < currentPage * 20 ? "show-it" : "hide-it");
				}
			});
			return;
		}
	
		// Otherwise, do normal search
		$("div.track").each(function () {
			const track = $(this);
			const artist = track.data("artist")?.toString().toLowerCase();
			const title = track.data("title")?.toString().toLowerCase();
			const id = track.data("id")?.toString();
	
			let matches = artist?.includes(lowerQuery) || title?.includes(lowerQuery);
			const filteredIds = filtered.map((val) => val.id);
			if(filtered?.length > 0 && !filteredIds.includes(id)){
				matches = false;
			}
			track.attr("data-show", matches ? "show-it" : "hide-it");
		});

	}
	var currentUrl = new URL(window.location.href);  
	var genres = [];
	var moods = [];
	var styles = [];
	var tempos = [];
	var filtered = [];
	function filterTracks() {
		const isModalOpen = $('.modal-overlay2')?.css('display') === "block";
		if(!isModalOpen){
			$("div.filters ul").hide();
		}
		$("div.filterTabs ul li").removeClass("selected");
		var appliedFiltersDiv = $("div.appliedFilters");
		appliedFiltersDiv.empty();
		if (styles.length == 0 && genres.length == 0 && moods.length == 0 && tempos.length == 0) {
			filtered = allTracks;
		} else {
			function addAppliedFilters(array, type) {
				for (var i=0; i<array.length; i++) {
					var filterElementName = $('<span></span>').text(array[i]);
					var filterElement = $('<div class="filter '+type+'"></div>');
					var filterElementRemove = $('<a href="javascript:void(0)" data-type="'+type+'"></a>');
					filterElementRemove.html("&times;");
					// filterElementRemove.on("click", function(){
					// 	var toRemove = $(this).parent().find("span").text();
					// 	var filterType = $(this).data("type");
					// 	$("div.filters ul li input."+filterType).each(function(){
					// 		if ($(this).val() == toRemove) {
					// 			$(this).trigger("click");
					// 			return;
					// 		}
					// 	});
					// });
					filterElementRemove.on("click", function(){
					console.log('in else===>', $(this).parent().find("span").text())
						var toRemove = $(this).parent().find("span").text();
						var filterType = $(this).data("type");
					
						$("div.filters ul li input."+filterType).each(function(){
							if ($(this).val() == toRemove) {
								$(this).prop("checked", false).trigger("change"); // Uncheck and trigger change
							}
						});
					
						// Re-run the filtering logic
						filterTracks();
						updateFilterCount();
					});
					filterElement.on("click", function(){
						$(this).find("a").trigger("click");
					});
					filterElement.append(filterElementName);
					filterElement.append(filterElementRemove);
					appliedFiltersDiv.append(filterElement);
				}
			}
			addAppliedFilters(genres, "genre");
			addAppliedFilters(moods, "mood");
			addAppliedFilters(styles, "style");
			addAppliedFilters(tempos, "tempo");
			filtered = allTracks.filter(function(track) {
				var included = styles.length == 0 || styles.indexOf(track.style) > -1;
				if (!included) {
					return false;
				}
				included = false;
				if (genres.length > 0) {
					for (var i=0; i<genres.length; i++) {
						if (track.genres.indexOf(genres[i]) > -1) {
							included = true;
							break;
						}
					}
				} else {
					included = true;
				}
				if (!included) {
					return false;
				}
				included = false;
				if (moods.length > 0) {
					for (var i=0; i<moods.length; i++) {
						if (track.moods.indexOf(moods[i]) > -1) {
							included = true;
							break;
						}
					}
				} else {
					included = true;
				}
				if (!included) {
					return false;
				}
				included = false;
				if (styles.length > 0) {
					for (var i=0; i<styles.length; i++) {
						if (track.style == styles[i]) {
							included = true;
							break;
						}
					}
				} else {
					included = true;
				}
				if (!included) {
					return false;
				}
				included = false;
				if (tempos.length > 0) {
					for (var i=0; i<tempos.length; i++) {
						var match = tempos[i].match(/(\d+)–(\d+) BPM/i);
						if (!match) {
							return false;
						}
						var min = parseInt(match[1]);
						var max = parseInt(match[2]);
						var trackTempo = parseInt(track.tempo);
						if (trackTempo >= min && trackTempo <= max) {
							included = true;
							break;
						}
					}
				} else {
					included = true;
				}
				return included;
			});
		}
		const modalOverlay = document.querySelector('.modal-overlay2');
		if(modalOverlay){
			modalOverlay.style.display = 'none';
			document.body.style.overflow = 'auto'
		}
		search(searchInput.val());
	}
	var allTracks = filtered = $("div.track").map(function(index,track){
		return {
			"id":$(track).attr("id"),
			// "title":$(track).find("li.title").text(),
			"title":$(track).data("title"),
			// "artist":$(track).find("li.artist").text(),
			"artist":$(track).data("artist"),
			"genres":$(track).data("genre").split(/, */),
			"moods":$(track).data("mood").split(/, */),
			"style":$(track).data("style"),
			"tempo":$(track).data("tempo")
		};
	}).get();
	let debounceTimer;

	function debouncedSearch(val) {
		clearTimeout(debounceTimer); // Clear previous timer
		debounceTimer = setTimeout(() => {
			// performSearch();
			search(val);
		}, 500); // Wait 500ms after user stops typing
	}
	var searchInput = $("div.search div.input input[type='text']");
	searchInput.on("keyup", function(){
		// search(this.value);
		debouncedSearch(this.value);
	});
	function updateFilterCount() {
		var filterCount = $("div.filters input:checked").length;
		if ($("div.filters:visible").length == 0) {
			if (filterCount > 0) {
				$("a.filters").text("Show filters ("+filterCount+")");
			} else {
				$("a.filters").text("Show filters");
			}
		} else {
			$("a.filters").text("Hide filters");
		}
	}
	if(genres?.length > 0){
		$("div.filters input.genre").each(function(){
			if(genres.includes($(this).val())){
				$(this).prop("checked", true);
			}
		});
	}
	$("div.track ul li.artist a.artist").on("click", function(){
		var name = $(this).text();
		searchInput.val(name);
		searchByArtist(name);
		return false;
	});
	$("div.search a.clear").on("click", function(){
		searchInput.val("");
		search("");
	});
	$("div.filters input.genre").on("change", function(e){
		genres = $("div.filters input.genre:checked").map(function(){
			return $(this).val();
		}).get()
		// const updatedG = JSON.parse(JSON.stringify(genres))
		// currentUrl.searchParams.set('genres',[...new Set(updatedG)].join(','));
		// window.location.href = currentUrl?.toString();
			filterTracks();
		updateFilterCount();
		searchInput.focus();
	});
	$("div.filters input.mood").on("change", function(){
		moods = $("div.filters input.mood:checked").map(function(){
			return $(this).val();
		}).get();
		filterTracks();
		updateFilterCount();
		searchInput.focus();
	});
	$("div.filters input.style").on("change", function(){
		styles = $("div.filters input.style:checked").map(function(){
			return $(this).val();
		}).get();
		filterTracks();
		updateFilterCount();
		searchInput.focus();
	});
	$("div.filters input.tempo").on("change", function(){
		tempos = $("div.filters input.tempo:checked").map(function(){
			return $(this).val();
		}).get();
		filterTracks();
		updateFilterCount();
		searchInput.focus();
	});
	$("a.filters").on("click", function(){
		if ($("div.filters:visible").length > 0) {
			$("div.filters").hide();
		} else {
			$("div.filters").show();
		}
		updateFilterCount();
	});
	$("div.filterTabs ul li a").on("click", function(){
		const isModalOpen = $('.modal-overlay2')?.css('display') === "block";
		if(!isModalOpen){
			$("div.filters ul").hide();
		}
		$(this).parent().toggleClass("selected");
		if ($(this).parent().hasClass("selected")) {
			$("div.filters ul."+this.name).show();
		}
		$(this).closest("ul").find("li.selected").not($(this).parent()).removeClass("selected");
	});
	$(".pagination a").on("click", function(e){
		e?.preventDefault();
		const currentId = e.target.id;
		var currentUrl = new URL(window.location.href);    
		if(currentId === 'next-page'){
			const currentPage = currentUrl.searchParams.get('page');
			currentUrl.searchParams.set('page', Number(currentPage) + 1);
		}
		else if(currentId === 'prev-page'){
			const currentPage = currentUrl.searchParams.get('page');
			currentUrl.searchParams.set('page', Number(currentPage) - 1);
		}
		else if(!isNaN(currentId)){
			currentUrl.searchParams.set('page', currentId);
		}
		window.location.href = currentUrl?.toString();	
	});
});