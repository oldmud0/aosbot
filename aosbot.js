var enet 	= require('enet');
var buf2hex 	= require('hex');
var colors 	= require('colors');

var id = 16777343;
var port = 51253;

var client, peer, serverAddr;

//Initialize client
function initClient() {
	client = new enet.Host(new enet.Address('localhost', 51254), 128, 1, 100000, 100000, "client");
	client.start(17);
	console.log("ENet client initialized.");
}

//Connect to server
function connect(id, port) {
	//Convert our URL to an IP address
	var serverIP = [ id & 0xFF, (id >> 8) & 0xFF, (id >> 16) & 0xFF, (id >> 24) & 0xFF ].join('.');
	serverAddr = new enet.Address(serverIP, port);
	serverAddr.hostToString = function(){return [ serverAddr._host & 0xFF, (serverAddr._host >> 8) & 0xFF, (serverAddr._host >> 16) & 0xFF, (serverAddr._host >> 24) & 0xFF ].join('.');}
	console.log("Got server address.");
	
	//Establish connection to our server
	console.log("Connecting to server " + serverAddr.hostToString() + ":" + serverAddr.port() + "...");
	peer = client.connect(
		serverAddr,
		1, //Channels we're going to use (does it even matter?)
		3, //Data
		function(err) {
			if(err) {
				console.log(err);
				return;
			}
		}
	);
}

initClient();
connect(id, port);

peer.on("connect", function() {
	//Connection success
	console.log("Connection established to " + serverAddr.hostToString() + " through port " + serverAddr.port());
	peer.ping();
	
	peer.session = {};
});

//18 (client joins)
//19 (mapdata)
//15 (end mapdata?)
//17 (chat msg)
//2 (constant feed of all player positions)

peer.on("message", function(packet, channel) {
	packetID = packet.data().readUInt8(0);
	
	//Event based package handling (terrible)
	switch(packetID) {
		case 18: //Client join
			console.log("--- Map start ---".bold.yellow.cyanBG)
			peer.session.map = {};
			peer.session.map.currentlyGrabbing = true;
			
			//buf2hex(packet.data());
			
			//break;
			peer.session.map.size = packet.data().readUInt32LE(1);
			console.log("Map size: " + peer.session.map.size);
			
			peer.session.map.data = new Buffer(peer.session.map.size);
			peer.session.map.progress = 0;
			break;
		case 19: //Map data packet
			//For each index till the end of the packet (excluding ID), push that to the map data
			packet.data().copy(peer.session.map.data, peer.session.map.data.length-1, 1);
			peer.session.map.progress += packet.data().length-1;
			process.stdout.write(peer.session.map.progress + "/" + peer.session.map.size + '\r');
			break;
		case 15: //End map data
			peer.session.map.currentlyGrabbing = false;
			process.stdout.write('\n');
			console.log("Done downloading map.");
			buf2hex(peer.session.map.data);
			break;
	}
});

peer.on("disconnect", function() {
	//Disconnected
	console.log("dang it");
	client.stop();
});
