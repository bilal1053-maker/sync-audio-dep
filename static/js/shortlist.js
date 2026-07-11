$(function(){

    $(document.body).append('<div id="shortlists"></div>');
    const shortlistDiv = $('#shortlists');

    async function decodeShortlists(str) {
        const lists = JSON.parse(str);
        const root = await protobuf.load("/proto/shortlist.proto");
        const Shortlist = root.lookupType("syncaudio.Shortlist");
        return lists.map(list => {
            const buffer = Uint8Array.from(atob(list), c => c.charCodeAt(0));
            const msg = Shortlist.decode(buffer);
            return Shortlist.toObject(msg);
        });
    }

    function getShortlists() {
        const encoded = $.cookie("shortlists");
        if (encoded) {
            return decodeShortlists(encoded);
        }
        return Promise.resolve([]);
    }

    $(document.body).on("mousedown", function(event){
        const x = event.pageX;
        const y = event.pageY;
        const trackOffset = shortlistDiv.offset();
        const trackRect = {
            "left": trackOffset.left,
            "top": trackOffset.top,
            "right": trackOffset.left + shortlistDiv.outerWidth(),
            "bottom": trackOffset.top + shortlistDiv.outerHeight()
        };
        if (x < trackRect.left || x > trackRect.right || y < trackRect.top || y > trackRect.bottom) {
            shortlistDiv.hide();
        }
    });

    $("a.add").on("click", function() {
        shortlistDiv.empty();
        shortlistDiv.append("<h3>Add to shortlist</h3>");
        shortlistDiv.show();
        const img = $(this).find("img");
        const trackId = $(this).parents("div.track").attr("id");
        shortlistDiv.innerHTML = "";
        const list = document.createElement("ul");
        list.style.listStyleType = "none";
        const newListItem = document.createElement("li");
        const newListItemName = document.createElement("input");
        newListItemName.setAttribute("type","text");
        newListItemName.setAttribute("placeholder", "Name a new shortlist");
        newListItemName.onkeypress = function(event) {
            if (event.key == "Enter") {
                const name = newListItemName.value;
                if (!name) {
                    return;
                }
                location.href = "/shortlist?name="+encodeURIComponent(name)+"&track="+trackId;
            }
        }
        newListItem.appendChild(newListItemName);
        list.appendChild(newListItem);
        if ("myShortlists" in window) {
            for (const shortlist of window.myShortlists) {
                const listItem = document.createElement("li");
                const listItemLink = document.createElement("a");
                listItemLink.setAttribute("href", "/shortlist?name="+encodeURIComponent(shortlist.name)+"&track="+trackId);
                listItemLink.appendChild(document.createTextNode(shortlist.name));
                listItem.appendChild(listItemLink);
                list.appendChild(listItem);
            }
        }
        shortlistDiv.css({
            "top": ($(this).offset().top - shortlistDiv.outerHeight() -50) + "px", // Adjust the offset as needed
            "left": ($(this).offset().left + (img.width() / 2) - (shortlistDiv.outerWidth() / 2)) + "px",
            "background-color": "white", // Light blue background color
            "color": "black"
        });
        shortlistDiv.append(list);
        newListItemName.focus();
        return false;
    });
});