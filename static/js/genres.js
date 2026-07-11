$(function(){
	function addTag(element) {
		var tag = $('<div class="tag"><span>'+element+'</span></div>');
		var removeLink = $('<a href="javascript:void(0)">&times;</a>');
		tag.append(removeLink)
		removeLink.on("click",()=>{
			removeTag(element);
		});
		var hiddenInput = $('<input />').attr("type", "hidden").attr("name", "genres[]").val(element);
		tagContainer.append(tag);
		tag.append(hiddenInput);
	}
	function removeTag(element) {
		tagContainer.find("input[type='hidden'][value='"+element+"']").each((index,element)=>{
			$(element).parents("div.tag").remove();
		});
		input.focus();
	}
	var container = $("div.tags");
	var allTags = [];
	container.find("datalist.tags option").each((index,element)=>{
		allTags.push($(element).attr("value"));
	});
	var projectTags = [];
	container.find("datalist.projectTags option").each((index,element)=>{
		projectTags.push($(element).attr("value"));
	});
	var tagContainer = $('<div></div>');
	container.append(tagContainer);
	projectTags.forEach(element => {
		addTag(element);
	});
	var inputContainer = $('<div style="position:relative"></div>');
	container.append(inputContainer);
	var input = $('<input type="text" placeholder="enter genre" />');
	var selectList = $('<ul class="select" style="display:block"></ul>').hide();
	inputContainer.append(input);
	inputContainer.append(selectList);
	input.on("keydown",(e)=>{
		var code = e.keyCode || e.which;
		var index = selectList.children().index($("li.selected"));
		if (code == 40) {
			// Down arrow
			if (index + 1 < selectList.find("li").length) {
				index += 1;
			} else {
				index = 0;
			}
		} else if (code == 38) {
			// Up arrow
			if (index > 0) {
				index -= 1;
			} else {
				index = selectList.find("li").length - 1;
			}
		} else if (code == 13) {
			e.preventDefault();
			// Enter
			if (index != -1) {
				addTag(selectList.children().eq(index).text());
				selectList.empty().hide();
			}
			input.val("").focus();
			return false;
		}
		if (index > -1) {
			selectList.children().removeClass("selected").eq(index).addClass("selected");
		}
	});
	input.on("input",()=>{
		var val = input.val().replace(/[^0-9a-z_]/i,'');
		input.val(val);
		selectList.empty();
		if (!val) {
			selectList.hide();
			return;
		}
		var addedTags = [];
		tagContainer.find("input[type='hidden']").each((index,element)=>{
			addedTags.push($(element).val());
		});
		var available = allTags.filter(function(tag){
			return addedTags.indexOf(tag) == -1;
		});
		available = available.map(function(tag){
			return {"genre":tag};
		});
		var fuse = new Fuse(available, {
			"keys": ["genre"],
			"id": "genre"
		});
		var matching = fuse.search(input.val());
		// var regex = new RegExp(val);
		// var matching = allTags.filter((tag)=>{
		// 	return regex.test(tag) && addedTags.indexOf(tag) == -1;
		// });
		selectList.toggle(matching.length > 0);
		matching.forEach(element=>{
			var listItem = $('<li></li>').text(element);
			selectList.append(listItem);
			listItem.on("click", ()=>{
				addTag(listItem.text());
				selectList.empty().hide();
				input.val("").focus();
			});
		});
		selectList.children().eq(0).addClass("selected");
	});
});