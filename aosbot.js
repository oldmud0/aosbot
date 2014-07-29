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
var gameFuncs	= require("./game");

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
			peer.session.joining = true;
			
			//Read the map size
			peer.session.map.size = packet.data().readUInt32LE(1);
			console.log("Map size: " + peer.session.map.size + " bytes.");
			
			//Create a temporary buffer to hold the map data as it's coming through
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
			
		//////////////////////////
		//Gamemode-related packets
		//////////////////////////
		//{
		
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
			
			//Initialize game info object
			if(peer.session.joining)
				peer.session.game = {};
			
			//Construct fog and team objects
			peer.session.game.fog = {
				blue:	packet.data().readUInt8(2),
				green:	packet.data().readUInt8(3),
				red:	packet.data().readUInt8(4)
			};
			
			gameFuncs.getTeamData(peer.session.game, packet);
			
			//If the gamemode is CTF, make a game state object with CTF-related data
			if(packet.data().readUInt8(30) === 0x0) {
				//We don't want the console to get hectic since this packet could get sent multiple times.
				if(peer.session.joining) 
					console.log("Gamemode: CTF");
				gameFuncs.getCTFData(peer.session.game, packet);
			//If it's TC, there's a problem because I haven't added that part yet.
			} else if(packet.data().readUInt8(30) === 0x1) {
				if(peer.session.joining) 
					console.error( ("ERROR: TC has not been implemented yet. Continue at your own risk...").bold.yellow.redBG );
				peer.session.game.state = {
					gamemode: packet.data().readUInt8(30)
					
					//TODO: Add TC data here.
				};
			//If it's something else, we have another problem.
			} else {
				if(peer.session.joining) 
					console.error( ("ERROR: Gamemode "+packet.data().readUInt8(30)+" is unknown. Continue at your own risk...").bold.yellow.redBG );
				peer.session.game.state = {
					gamemode: packet.data().readUInt8(30)
				};
			}
			
			if(peer.session.joining) {
				//////////////////
				//Spawn the player
				//////////////////
					
				//Initialize player object
				peer.session.player = {};
				
				//Initialize player list. Note that an object declaration *may* be more efficient than an array declaration.
				peer.session.players = {};
				
				//Get our ID
				peer.session.player.id = packet.data().readUInt8(1);
				
				console.log( "ID is " + (peer.session.player.id.toString()).bold );
				
				//Set our name
				peer.session.player.name = "MyFirstBot";
				
				//Also, let's link our player to peer.session.players in case we are called out by the server.
				peer.session.players[id] = peer.session.player;
				
				//Let's create an "existing player" packet and send it to the server. (Despite the name, this is our only way in.)
				var newPlayerBuffer = new Buffer(28);
				
				//Write the packet
				newPlayerBuffer.writeUInt8(     9,                        0) ; //Packet #9
				newPlayerBuffer.writeUInt8(     peer.session.player.id,   1);  //Player ID. Server probably doesn't care about it.
				newPlayerBuffer.writeInt8(      0,                        2);  //What team to choose? Who cares since the server will probably balance us. (-1 = spec, 0 = team1, 1 = team2)
				newPlayerBuffer.writeUInt8(     0,                        3);  //(0 = rifle, 1 = smg, 2 = shotgun)
				newPlayerBuffer.writeUInt8(     0,                        4);  //Held item; discarded by server. Only used server -> client. (0 = spade, 1 = block, 2 = gun, 3 = grenade)
				newPlayerBuffer.writeUInt32LE(  0,                        5);  //Kills; also discarded by server.
				newPlayerBuffer.writeUInt8(     0,                        9);  //Block color. Again, discarded by server. (Blue)
				newPlayerBuffer.writeUInt8(     0,                        10); //(Green)
				newPlayerBuffer.writeUInt8(     0,                        11); //(Red)
				newPlayerBuffer.write(          peer.session.player.name, 12, 16, "cp437"); //Our name
				
				peer.send(0, new enet.Packet(newPlayerBuffer, enet.Packet.FLAG_RELIABLE), function(err) {
					if(err)
						console.error( ("ERROR: " + err).bold.yellow.redBG );
					else
						console.log("We have a bot on ground.".bold.yellow.cyanBG);
						peer.session.player.alive = true;
				});
				
				//Marks the end of the joining process
				peer.session.joining = false;
			}
			
			break;
		
		case 23: //Intel capture
			var capper = peer.session.players[packet.data().readUInt8(1)];
			
			console.log( 
			((capper.name)[capper.team === 0 ? "blue" : "green"].bold)
			+ " just captured the intel for " + peer.session.game[capper.team === 0 ? "team1" : "team2"].name + "!" 
			+ (packet.data().readUInt8(2) === 1 ? "(win)" : "") 
			);
			break;
		
		case 24: //Intel pickup
			var capper = peer.session.players[packet.data().readUInt8(1)];
			
			console.log( 
			((capper.name)[capper.team === 0 ? "blue" : "green"].bold)
			+ " picked up the intel for " + peer.session.game[capper.team === 0 ? "team1" : "team2"].name + "!"
			);
			
			//Set intel position to the player id
			peer.session.game.state[capper.team === 0 ? "team1" : "team2"].intel = {
				player: packet.data().readUInt8(1)
			};
			break;
		
		case 25: //Intel dropped
			var capper = peer.session.players[packet.data().readUInt8(1)];
			
			console.log( 
			((capper.name)[capper.team === 0 ? "blue" : "green"].bold)
			+ " dropped the intel."
			);
			
			//Set intel position according to packet
			peer.session.game.state[capper.team === 0 ? "team1" : "team2"].intel = {
				x: packet.data().readInt32LE(2),
				y: packet.data().readInt32LE(6),
				z: packet.data().readInt32LE(10)
			};
			break;
		
		case 21: //Territory captured
			//nobody plays TC anymore :(
			break;
		
		case 22: //TC progress bar
			//no-op
			break;
		
		//}
			
		////////////////////////
		//Player-related packets 
		////////////////////////
		//{
		
		case 12: //Create player (as response to the packet #9 that we sent). Sent when a player joins after we've joined as opposed to packet #9 below.
			peer.session.players[packet.data().readUInt8(1)] = {
				weapon: packet.data().readUInt8(2),
				team: packet.data().readInt8(3),
				pos: {
					x: packet.data().readFloatLE(4),
					y: packet.data().readFloatLE(8),
					z: packet.data().readFloatLE(12)
				},
				name: packet.data().toString("cp437", 13, 29),
				
				//We'll need these later
				orient: {},
				color: {}
			};
			break;
		
		case 9: //Existing player. Sent when we join while there are players online.
			peer.session.players[packet.data().readUInt8(1)] = {
				team: packet.data().readInt8(2),
				weapon: packet.data().readUInt8(3),
				heldItem: packet.data().readUInt8(4),
				kills: packet.data().readUInt32LE(5),
				color: {
					b: packet.data().readUInt8(9),
					g: packet.data().readUInt8(10),
					r: packet.data().readUInt8(11)
				},
				name: packet.data().toString("cp437", 12, 29),
				
				//We'll need these later
				pos: {},
				orient: {}
			};
			break;
		
		case 10: //Short player data. Used when player switches teams or weapon.
			var id = packet.data().readUInt8(1);
			
			peer.session.players[id].team = packet.data().readInt8(2);
			peer.session.players[id].weapon = packet.data().readUInt8(3);
			break;
			
		case 2: //Player positions. 0.76 does a lot nicer job in doing this, but right now we are only working with 0.75 data.
			var offset = 1; //Offset increments by 24 bytes, the size of each player pos data part
			var id; //id indicates player number.
			
			for(id = 1; id <= 32; id++) {
				//If the id exists, process it. If not, nothing will happen.
				if(typeof peer.session.players[id] != "undefined") {
					//Position data
					peer.session.players[id].pos.x = packet.data().readFloatLE(offset + 0);
					peer.session.players[id].pos.y = packet.data().readFloatLE(offset + 4);
					peer.session.players[id].pos.z = packet.data().readFloatLE(offset + 8);
					
					//Orientation data
					peer.session.players[id].orient.x = packet.data().readFloatLE(offset + 12);
					peer.session.players[id].orient.y = packet.data().readFloatLE(offset + 16);
					peer.session.players[id].orient.z = packet.data().readFloatLE(offset + 20);
				}
				offset += 24;
			}
			
			break;
		
		case 29: //Change team
			var player = peer.session.players[packet.data().readUInt8(1)];
			
			console.log( 
			((player.name)[player.team === 0 ? "blue" : "green"].bold)
			+ " joined "
			+ (packet.data().readInt8(2) === 0 ? peer.session.game.team1.name : packet.data().readInt8(2) === 1 ? peer.session.game.team2.name : "Spectator")
			);
			
			//Set player's team
			player.team = packet.data().readInt8(2);
			break;
			
		case 30: //Change weapon
			peer.session.players[packet.data().readUInt8(1)].weapon = packet.data().readUInt8(2);
			break;
		
		case 7: //Set player's currently equipped tool
			peer.session.players[packet.data().readUInt8(1)].heldItem = packet.data().readInt8(2); //0 = spade, 1 = block, 2 = gun, 3 = grenade
			break;
		
		case 8: //Set player's block color
			var id = packet.data().readUInt8(1);
			
			peer.session.players[id].color.b = packet.data().readUInt8(2);
			peer.session.players[id].color.g = packet.data().readUInt8(3);
			peer.session.players[id].color.r = packet.data().readUInt8(4);
			break;
			
		case 3: //Input data
			//no-op for now
			break;
			
		case 4: //Weapon fire
			//no-op for now
			break;
			
		case 28: //Weapon reload
			//no-op for now
			break;
		
		case 26: //Restock
			//If it's us, resupply everything. If not, we don't care.
			if(packet.data().readUInt8(1) === peer.session.player.id) {
				//TODO: uh, we don't have any weapon info.
			}
			break;
		
		case 27: //Fog color
			//We don't really care about fog
			//no-op
			break;
			
		case 16: //Kill action
			//If it was our bot, print it out. If not, don't do anything.
			if(packet.data().readUInt8(1) === peer.session.player.id) {
				var weapon = (
				packet.data().readUInt8(3) === 0 && peer.session.players[packet.data().readUInt8(2)].weapon === 0 ? "rifle" :
				packet.data().readUInt8(3) === 0 && peer.session.players[packet.data().readUInt8(2)].weapon === 1 ? "SMG" :
				packet.data().readUInt8(3) === 0 && peer.session.players[packet.data().readUInt8(2)].weapon === 2 ? "shotgun" :
				packet.data().readUInt8(3) === 1 ? "headshot" :
				packet.data().readUInt8(3) === 2 ? "spade" :
				packet.data().readUInt8(3) === 3 ? "grenade" :
				packet.data().readUInt8(3) === 4 ? "fall" :
				packet.data().readUInt8(3) === 5 ? "team change" :
				packet.data().readUInt8(3) === 6 ? "class change" :
				"anomaly"
				);
				
				console.log( peer.session.player.name + " was killed by " + peer.session.players[packet.data().readUInt8(2)].name + " with a " + weapon + ". Respawn in " + packet.data().readUInt8(4) + " seconds." );
				
				peer.session.player.alive = false;
				
				//After the respawn time is depleted, we'll say that our bot is alive again
				setTimeout(function respawnPlayer() {
					peer.session.player.alive = true;
				}, packet.data().readUInt8(4)*1000);
			}
			break;
		
		case 20: //Player leaves
			console.log( 
			((peer.session.players[packet.data().readUInt8(1)].name).white.bold)
			+ " left the server."
			);
		
			delete peer.session.players[packet.data().readUInt8(1)]; //Delete vs null vs undefined? Who cares, they all just dereference.
			break;
			
		//}
		
		case 13: //Block action
			var action = {
				type: packet.data().readUInt8(2), //0 = build, 1 = bullet, 2 = spade, 3 = grenade
				x: packet.data().readInt32LE(3),
				y: packet.data().readInt32LE(7),
				z: packet.data().readInt32LE(11)
			};
			
			if(action.type === 0)
				peer.session.map.voxeldata[x][y][z] = true;
			else
				peer.session.map.voxeldata[x][y][z] = false;
			
			break;
		
		case 14: //Block line
			//TODO: steal algorithm from secret facility
			break;
		
		case 17: //Chat message
			console.log(
			( packet.data().readUInt8(2) === 0 ? "<GLOBAL>".bold.white 
			: packet.data().readUInt8(2) === 1 ? "<TEAM>".bold.blue
			: packet.data().readUInt8(2) === 2 ? "<SYSTEM>".bold.yellow
			: "<?>" )
			+ (typeof peer.session.players[packet.data().readUInt8(1)] != "undefined" ? peer.session.players[packet.data().readUInt8(1)].name : "")
			+ "\t"
			+ ("(#" + packet.data().readUInt8(1) + "): ").bold
			+ packet.data().toString("cp437", 3)
			);
			
			//TODO: Parse player ID into name.
			break;
		
		default: //Any packets that we've missed?
			console.log("Incoming unknown packet "+ packet.data().readUInt8(0));
			buf2hex(packet.data());
			break;
	}
});

peer.on("disconnect", function disconnectCallback() {
	//Disconnected
	console.log("dang it");
	client.stop();
});
