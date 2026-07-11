$(function(){
	$("select[name='licence_id']").on("change", function(){
		var licenceId = this.options[this.options.selectedIndex].value;
		$("p.licenceDescription").hide();
		if (licenceId) {
			$("#licence_"+licenceId).show();
			$("#submit").toggleClass("disabled", false);
		} else {
			$("#submit").toggleClass("disabled", true);
		}
	});
	if (selectedLicenceId) {
		$("select[name='licence_id']").val(selectedLicenceId);
	}
	$("#submit").on("click", function(){
		if ($("select[name='licence_id']").val()) {
			$("form.licence").get(0).submit();
		}
	});
	$("img.checkbox").on("click", function(){
		$("img.checkbox").not($(this)).attr({
			"src":"/images/checkbox-unchecked.png",
			"srcset": "/images/checkbox-unchecked@2x.png 2x, /images/checkbox-unchecked@3x.png 3x"
		});
		$(this).attr({
			"src":"/images/checkbox-checked.png",
			"srcset": "/images/checkbox-checked@2x.png 2x, /images/checkbox-checked@3x.png 3x"
		});
		var licenceId = $(this).data("licence_id");
		$("form.licence input[name='licence_id']").val(licenceId);
		$("form.licence").get(0).submit();
	});
});