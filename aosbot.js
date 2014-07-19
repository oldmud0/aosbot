var enet = require('enet');

//Initialize client
var client = enet.createClient({
	peers: 1, //only 1 outgoing connection allowed
	channels: 1, //channels 0 and 1
	down: 100000, //Download
	up: 100000, //Upload
});
client.start();

console.log("ENet client initialized.");

//Establish connection to our server
var id = 3322578207;
var serverIP = [ id & 0xFF, (id >> 8) & 0xFF, (id >> 16) & 0xFF, (id >> 24) & 0xFF ].join('.');
var serverAddr = new enet.Address(serverIP, 32887);
serverAddr.hostToString = function(){return [ serverAddr._host & 0xFF, (serverAddr._host >> 8) & 0xFF, (serverAddr._host >> 16) & 0xFF, (serverAddr._host >> 24) & 0xFF ].join('.');}
console.log("Got server address.");

console.log("Connecting to server " + serverAddr.hostToString() + ":" + serverAddr.port() + "...");
var peer = client.connect(
	serverAddr,
	1, //Channels we're going to use (does it even matter?)
	0x6e390fac, //Data
	function(err, peer) {
		if(err) {
			console.log(err);
			return;
		}
		console.log("Oh my gosh we're on")
		
		peer.ping();
	}
);

var packet1 = new enet.Packet( new Buffer("HELLOWORLD"),enet.Packet.FLAG_RELIABLE);
peer.send(0, packet1);
var packet2 = new enet.Packet( new Buffer("\x83\x7b\x88\xb1\xfd\xf1\xdf\x57\x6b\x99"),enet.Packet.FLAG_RELIABLE);
peer.send(0, packet2);

peer.on("connect", function(connectedPeer, incomingPacket, isOutgoing) {
	//Connection success
	console.log("Connection established to " + serverAddr.host + " through port " + serverAddr.port);
	peer.ping();
});

peer.on("message", function(connectedPeer, packet, channel) {
	console.log("Incoming packet from channel " + channel);
	console.log(packet.data);
});

peer.on("disconnect", function() {
	//Disconnected
	console.log("dang it");
});