var http = require("http");

module.exports.startMapServer = function (map) {
	module.exports.map = map;
	module.exports.server = http.createServer(function(req, resp) {
		console.log("Got response from map server ("+req.method+")");
		if(req.method === "OPTIONS") { //Preflight CORS
			resp.writeHead(200, 
			{"Access-Control-Allow-Origin": "*", //Same-origin-policy stupidity.
			 "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
			 "Access-Control-Allow-Credentials": false,
			 "Access-Control-Max-Age": "86400",
			 "Access-Control-Allow-Headers": "Origin, Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers"
			});
			resp.end();
			return;
		}
		resp.writeHead(200, 
			{"Content-Type": "application/json",
			 "Access-Control-Allow-Origin": "*", //Same-origin-policy stupidity.
			 "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
			 "Access-Control-Allow-Headers": "Origin, Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers"}
		);
		resp.write(JSON.stringify(module.exports.map));
		resp.end();
	});
	module.exports.server.listen(9876);
	console.log("Map server started at port 9876.")
};