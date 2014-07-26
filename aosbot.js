//npm dependencies
var enet 	= require('enet');		//Connecting to the server, obviously
var buf2hex 	= require("hex");		//Packet analysis
var colors 	= require("colors");		//Colors!
var ansi	= require("ansi")		//Carriage return doesn't seem to work, so why not
   ,cursor	= ansi(process.stdout);
var zlib	= require("zlib");		//For inflating the map when we finish downloading it
var iconv	= require("iconv-lite");	//For converting our CP437 string to whatever encoding node uses
iconv.extendNodeEncodings();			//Now we can use Buffer.toString() with the encoding cp437.

//Local files
var mapFuncs	= require("./map");

var id = 16777343;
var port = 51253;

var client, peer, serverAddr;

/**
  * Initialize client (technically a host) at port 0 (any free port that the OS feels like giving us).
  * Max peers	- 128
  * Channels	- 1
  * Max up/down	- 256 Kbps
  * Interval	- 17 ms
*/
function initClient() {
	client = new enet.Host(new enet.Address('localhost', 0), 128, 1, 256000, 256000, "client");
	client.start(17);
	console.log("ENet client initialized.");
}

/**
  * Connect to server.
  * We can't connect to a server directly because the enet bindings that we're using
  * don't support compression. So we have to use a sort of proxy server (generously donated by BR_)
  * to send/receive the packets to/from the server for us.
*/
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
			//We can also use it as a way to tell us when to stop downloading the map.
			
			//If we're downloading a map and we just got packet 15, stop downloading and process the map
			if(peer.session.map.currentlyGrabbing === true) {
				peer.session.map.currentlyGrabbing = false;
				console.log("Done downloading map. Got " + peer.session.map.progress + " bytes.");
				
				///////////////////////////////
				//Let's decompress this map! :D
				///////////////////////////////
				cursor.horizontalAbsolute(0).write("Decompressing map...")
				var err = zlib.inflate(peer.session.map.dataRaw, function inflateCallback(err, result) {
					
					//If we got an error, print it out and stop
					if(err) {
						console.error( ("DECOMPRESSION ERROR: " + err).bold.yellow.redBG );
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
				});
			}
			
			///////////////
			//Get game data
			///////////////
			
			//Initialize player and game info objects
			peer.session.game = {};
			
			//Construct fog and team objects
			peer.session.game.fog = {
				blue:	packet.data().readUInt8(1),
				green:	packet.data().readUInt8(2),
				red:	packet.data().readUInt8(3)
			};
			
			peer.session.game.team1 = {
				blue:	packet.data().readUInt8(4),
				green:	packet.data().readUInt8(5),
				red:	packet.data().readUInt8(6),
				name:	packet.data().toString("cp437", 10, 20)
			};
			
			peer.session.game.team2 = {
				blue:	packet.data().readUInt8(7),
				green:	packet.data().readUInt8(8),
				red:	packet.data().readUInt8(9),
				name:	packet.data().toString("cp437", 20, 30)
			}
			
			//If the gamemode is CTF, make a game state object with CTF-related data
			if(packet.data().readUInt8(30) === 0x0) {
				console.log("Gamemode: CTF");
				peer.session.game.state = {
					gamemode: packet.data().readUInt8(30),
					captureLimit: packet.data().readUInt8(33),
					intelFlags: packet.data().readUInt8(34),
					
					team1: {
						score: packet.data().readUInt8(31),
						
						//We need to check if the position data is just padding. If it is, then a player has the intel.
						intel: packet.data().readUInt8(36) === packet.data().readUInt8(37) && packet.data().readUInt8(37) === packet.data().readUInt8(38) ?
						{
							player: packet.data().readUInt8(35)
						} : //If not, then it's just xyz coordinates.
						{
							x: packet.data().readFloatLE(35),
							y: packet.data().readFloatLE(39),
							z: packet.data().readFloatLE(43)
						},
						
						base: {
							x: packet.data().readFloatLE(53),
							y: packet.data().readFloatLE(57),
							z: packet.data().readFloatLE(61)
						}
					},
					
					team2: {
						score: packet.data().readUInt8(32),
						
						intel: packet.data().readUInt8(48) === packet.data().readUInt8(49) && packet.data().readUInt8(50) === packet.data().readUInt8(51) ?
						{
							player: packet.data().readUInt8(47)
						} :
						{
							x: packet.data().readFloatLE(47),
							y: packet.data().readFloatLE(48),
							z: packet.data().readFloatLE(49)
						},
						
						base: {
							x: packet.data().readFloatLE(65),
							y: packet.data().readFloatLE(69),
							z: packet.data().readFloatLE(73)
						}
					}
				};
			//If it's TC, there's a problem because I haven't added that part yet.
			} else if(packet.data().readUInt8(30) === 0x1) {
				console.error( ("ERROR: TC has not been implemented yet. Continue at your own risk...").bold.yellow.redBG );
				peer.session.game.state = {
					gamemode: packet.data().readUInt8(30)
					
					//TODO: Add TC data here.
				};
			//If it's something else, we have another problem.
			} else {
				console.error( ("ERROR: Gamemode "+packet.data().readUInt8(30)+" is unknown. Continue at your own risk...").bold.yellow.redBG );
				peer.session.game.state = {
					gamemode: packet.data().readUInt8(30)
				};
			}
			
			console.log("Object data:");
			console.log(peer.session.game.state);
			
			/*
			ROAD WORK AHEAD
			   _       _
			  |0|     |0|
			 =/=\==!==/=\=
			 // \\   // \\
			//   \\ //   \\
			*/
			
			//TODO: Spawn the player. 
			
			break;
		case 2: //Player positions
			//TODO
			break;
		case 17: //Chat message
			console.log(
			( packet.data().readUInt8(2) === 0 ? "<GLOBAL>".bold.white 
			: packet.data().readUInt8(2) === 1 ? "<TEAM>".bold.blue
			: packet.data().readUInt8(2) === 2 ? "<SYSTEM>".bold.yellow
			: "<?>" )
			+ "\t" 
			+ ("#" + packet.data().readUInt8(1) + ": ").bold
			+ packet.data().toString("cp437", 3)
			);
			
			//TODO: Parse player ID into name.
			
			break;
		default: //Any packets that we've missed?
			console.log(packet.data());
			buf2hex(packet.data());
			break;
	}
});

peer.on("disconnect", function disconnectCallback() {
	//Disconnected
	console.log("dang it");
	client.stop();
});
