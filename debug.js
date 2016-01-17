var colors = require("colors");

module.exports.print = function(msg) {
	console.log(("[debug] " + msg).gray);
}