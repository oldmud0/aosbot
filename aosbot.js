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
var serverAddr = new enet.Address("50.103.252.249", 32887);
console.log("Got server address.");

console.log("Connecting to server...");
var peer = client.connect(
	serverAddr,
	1, //Channels we're going to use (does it even matter?)
	3, //Data
	function(err, peer) {
		if(err) {
			console.log(err);
			return;
		}
		console.log("Oh my gosh we're on")
		
		peer.ping();
	}
);

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