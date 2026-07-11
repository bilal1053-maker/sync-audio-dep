$(function(){
	var checkoutButton = $("a.button.checkout");
	$("input.tnc").on("change", function(){
		if ($(this).prop("checked")) {
			checkoutButton.removeClass("disabled");
		} else {
			checkoutButton.addClass("disabled");
		}
	});
	checkoutButton.on("click", function(){
		if ($(this).hasClass("disabled")) {
			alert("You must agree to the licence terms and conditions before checking out.");
			return false;
		} else {
			return true;
		}
	});
	var quoteButton = $("a.button.quote");
	var nameInput = $("input[name='name']");
	var emailInput = $("input[name='email']");
	var companyInput = $("input[name='company']");
	var useInput = $("textarea[name='use']");
	var name = localStorage.getItem("name");
	var email = localStorage.getItem("email");
	var company = localStorage.getItem("company");
	var use = localStorage.getItem("use");
	nameInput.val(name);
	companyInput.val(company);
	emailInput.val(email);
	useInput.val(use);
	nameInput.add(emailInput).add(companyInput).add(useInput).on("keyup", function(){
		name = nameInput.val();
		email = emailInput.val();
		company = companyInput.val();
		use = useInput.val();
		if (name) {
			localStorage.setItem("name", name);
		} else {
			localStorage.removeItem("name");
		}
		if (email) {
			localStorage.setItem("email", email);
		} else {
			localStorage.removeItem("email");
		}
		if (company) {
			localStorage.setItem("company", company);
		} else {
			localStorage.removeItem("company");
		}
		if (use) {
			localStorage.setItem("use", use);
		} else {
			localStorage.removeItem("use");
		}
		quoteButton.toggleClass("disabled", !name || !company || !email || !use);		
	});
	quoteButton.toggleClass("disabled", !name || !company || !email || !use);
	quoteButton.on("click", function(){
		if (!$(this).hasClass("disabled")) {
			$("form.quote").submit();
		}
	});
});