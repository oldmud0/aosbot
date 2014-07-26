//npm dependencies
var enet 	= require('enet');
var buf2hex 	= require("hex");
var colors 	= require("colors");
var ansi	= require("ansi")
   ,cursor	= ansi(process.stdout);
var zlib	= require("zlib");

//Local files
var mapFuncs	= require("./map");

var id = 16777343;
var port = 51253;

var client, peer, serverAddr;

//Initialize client
function initClient() {
	client = new enet.Host(new enet.Address('localhost', 0), 128, 1, 256000, 256000, "client");
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
		1, //Channels we're going to use (AoS does not work in surround)
		3, //Data
		function peerConnectCallback(err) {
			if(err) {
				console.log(err);
				return;
			}
		}
	);
}

initClient();
connect(id, port);

peer.on("connect", function connectCallback() {
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

peer.on("message", function messageCallback(packet, channel) {
	packetID = packet.data().readUInt8(0);
	
	//Event based package handling (terrible)
	switch(packetID) {
		case 18: //Client join
			console.log("--- Map start ---".bold.yellow.cyanBG);
			peer.session.map = {};
			peer.session.map.currentlyGrabbing = true;
			
			//buf2hex(packet.data());
			
			//break;
			peer.session.map.size = packet.data().readUInt32LE(1);
			console.log("Map size: " + peer.session.map.size + " bytes.");
			
			peer.session.map.dataRaw = new Buffer(peer.session.map.size);
			peer.session.map.progress = 0;
			break;
		case 19: //Map data packet
			//Copy packet data (except the packet ID) to the map data
			packet.data().copy(peer.session.map.dataRaw, peer.session.map.progress, 1);
			
			//Add packet's length to the progress
			peer.session.map.progress += packet.data().length-1;
			
			//Show our current progress. However, we don't want to slow down the download by waiting for the console, so we'll write back every few bytes.
			if( Math.round(peer.session.map.progress % 30000 * 0.001) === 0) {
				process.stdout.write(peer.session.map.progress + "/" + peer.session.map.size);
				cursor.horizontalAbsolute(0);
			}
			break;
		case 15: //Gamemode data
			//For now we'll also use it as a way to tell us when to stop downloading the map.
			peer.session.map.currentlyGrabbing = false;
			console.log("Done downloading map. Got " + peer.session.map.progress + " bytes.");
			
			///////////////////////////////
			//Let's decompress this map! :D
			///////////////////////////////
			cursor.horizontalAbsolute(0).write("Decompressing map...")
			var err = zlib.inflate(peer.session.map.dataRaw, function inflateCallback(err, result) {
				
				//If we got an error, print it out and stop
				if(err) {
					console.log( ("DECOMPRESSION ERROR: " + err).bold.yellow.redBG );
					return err;
				}
				
				//Tell the user that decompression's done and assign the result to map data
				console.log("Decompression completed. Map size: " + result.length + " bytes.");
				peer.session.map.data = result;
			
				//We don't need dataRaw anymore. Delete it.
				delete peer.session.map.dataRaw;
			
				////////////
				//Decode RLE
				////////////
				
				//But first, let's take a moment to create a 3D array that will hold our voxels.
				//Basically, all we need to know is if a voxel is an open voxel (false) or a solid voxel (true).
				mapFuncs.initVoxelArray(peer.session.map);
				
				cursor.horizontalAbsolute(0).write("Decoding RLE from map...");
				mapFuncs.loadMap(peer.session.map);
				console.log("RLE decode complete.");
				
				console.log("--- Map load complete ---".bold.yellow.cyanBG);
				
				///////////////
				//Get game data
				///////////////
				
				//Initialize player and game info objects
				peer.session.player = {};
				peer.session.game = {};
				
				/*
				ROAD WORK AHEAD
				   _       _
				  |0|     |0|
				 =/=\==!==/=\=
				 // \\   // \\
				//   \\ //   \\
				*/
				
				//TODO: Get game data and spawn the player. 
			});
			
			break;
	}
});

peer.on("disconnect", function disconnectCallback() {
	//Disconnected
	console.log("dang it");
	client.stop();
});
