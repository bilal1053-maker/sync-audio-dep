$(function(){
	var maxMoodCount = 3;
	$("input[name='mood[]']").on("change", function() {
		if ($(this).prop("checked") && $("input[name='mood[]']:checked").length > maxMoodCount) {
			$(this).prop("checked", false);
			alert("Please select up to "+maxMoodCount+" moods");
		}
	});
});