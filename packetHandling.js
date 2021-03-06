var enet    = require('enet');		//We need to send some packets back to the server
var colors  = require("colors");		//Colors!
var ansi    = require("ansi")		//Carriage return doesn't seem to work, so why not
   ,cursor  = ansi(process.stdout);
var zlib    = require("zlib");		//For inflating the map when we finish downloading it
var iconv   = require("iconv-lite");	//For converting our CP437 string to whatever encoding node uses
var buf2hex = require("hex");

var mapFuncs      = require("./map");
var gameFuncs     = require("./packets_game");
var playerFuncs   = require("./packets_player");
var mapServer     = require("./interface");
var Player        = require("./player").Player;
var OwnPlayer     = require("./player").OwnPlayer;
var dbg           = require("./debug");

module.exports = {
/**
  * Handle packet 18, which signals map start (supports 0.75 only)
*/
mapStart: function mapStart(packet, peer) {
	//If our compute hook/interval is still running, quick, unload it!
	if(typeof peer.session.getPlayer != "undefined" && typeof peer.session.getPlayer().computeHook != "undefined") {
		clearInterval(peer.session.getPlayer().computeHook);
		delete peer.session.getPlayer().computeHook;
	}
	
	console.log("--- Map start ---".bold.yellow.cyanBG);
	peer.session.map = {};
	peer.session.map.currentlyGrabbing = true;
	peer.session.map.decompressing = false;
	peer.session.joining = true;
	
	//Initialize our objects. It's imperative that we do it immediately in case we are sent something before we join successfully.
	//Initialize player list. Note that an object declaration *may* be more efficient than an array declaration.
	peer.session.players = new Array(36);
	for(var i = 0; i < peer.session.players.length; i++)
		peer.session.players[i] = new Player(i);
	//Initialize game info object
	peer.session.game = {};
	
	//Read the map size
	peer.session.map.size = packet.data().readUInt32LE(1);
	console.log("Map size: " + peer.session.map.size + " bytes.");
	
	//Create a temporary buffer to hold the map data as it's coming through
	peer.session.map.dataRaw = new Buffer(peer.session.map.size);
	peer.session.map.progress = 0;
},

/**
  * Handle packet 19, which carries a chunk of the map
*/
mapData: function mapData(packet, peer) {
	//Copy packet data (except the packet ID) to the map data
	packet.data().copy(peer.session.map.dataRaw, peer.session.map.progress, 1);
	
	//Add packet's length to the progress
	peer.session.map.progress += packet.data().length-1;
	
	//Show our current progress. However, we don't want to slow down the download by waiting for the console, so we'll write back every few bytes.
	if( Math.round(peer.session.map.progress % 30000 * 0.001) === 0) {
		//process.stdout.write(peer.session.map.progress + "/" + peer.session.map.size);
		process.stdout.write(peer.session.map.progress.toString(16) + "/" + peer.session.map.size.toString(16));
		cursor.horizontalAbsolute(0);
	}
},

/**
  * Handle packet 15, which is gamemode data. This also signals when the map download process has completed.
  * Packet 9 is also sent to the server to spawn the bot.
*/
gamemodeData: function gamemodeData(packet, peer) {
	//If we're downloading a map and we just got packet 15, stop downloading and process the map
	if(peer.session.map.currentlyGrabbing === true) {
		peer.session.map.currentlyGrabbing = false;
		console.log("Done downloading map. Got " + peer.session.map.progress + " bytes.");
		
		///////////////////////////////
		//Let's decompress this map! :D
		///////////////////////////////
		cursor.horizontalAbsolute(0).write("Decompressing map...")
		peer.session.map.decompressing = true;
		console.time("map_decompress");
		var err = zlib.inflate(peer.session.map.dataRaw, function inflateMapCallback(err, result) {
			
			//If we got an error, print it out and stop
			if(err) {
				console.error( ("DECOMPRESSION ERROR: " + err).bold.yellow.redBG );
				
				console.timeEnd("map_decompress");
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
			
			//We don't need the zlib'd info anymore. Destroy it.
			delete peer.session.map.data;

			console.log("--- Map load complete ---".bold.yellow.cyanBG);
			peer.session.map.decompressing = false;
			console.timeEnd("map_decompress");
			
			//////////////////
			//Spawn the player
			//////////////////
			
			//Let's create an "existing player" packet and send it to the server. (Despite the name, this is our only way in.)
			var newPlayerBuffer = new Buffer( new Array(28) ); //Making an array first helps zero out any stray values in memory.
			
			//Write the packet
			newPlayerBuffer.writeUInt8(     9,                        0) ; //Packet #9
			newPlayerBuffer.writeUInt8(     peer.session.getPlayer().id,   1);  //Player ID. Server probably doesn't care about it.
			newPlayerBuffer.writeInt8(      0,                        2);  //What team to choose? Who cares since the server will probably balance us. (-1 = spec, 0 = team1, 1 = team2)
			newPlayerBuffer.writeUInt8(     0,                        3);  //(0 = rifle, 1 = smg, 2 = shotgun)
			newPlayerBuffer.writeUInt8(     0,                        4);  //Held item; discarded by server. Only used server -> client. (0 = spade, 1 = block, 2 = gun, 3 = grenade)
			newPlayerBuffer.writeUInt32LE(  0,                        5);  //Kills; also discarded by server.
			newPlayerBuffer.writeUInt8(     0,                        9);  //Block color. Again, discarded by server. (Blue)
			newPlayerBuffer.writeUInt8(     0,                        10); //(Green)
			newPlayerBuffer.writeUInt8(     0,                        11); //(Red)
			iconv.encode(peer.session.getPlayer().name, "cp437").copy(newPlayerBuffer, 12, 0, 16); //Our name
			newPlayerBuffer[27] = 0x0; //String must be null-terminated. We need to make sure our string ends in 0x0.
			
			peer.send(0, new enet.Packet(newPlayerBuffer, enet.Packet.FLAG_RELIABLE), function sendNewPlayerBufferCallback(err) {
				if(err)
					console.error( ("ERROR: " + err).bold.yellow.redBG );
				else
					console.log("We have a bot on ground.".bold.yellow.cyanBG);
					peer.session.getPlayer().alive = true;
			});
			
			//Load compute hook. We can unload it at any time.
			//peer.session.players.computeHook = setInterval(botCompute, 50);
			
			//Marks the end of the joining process
			peer.session.joining = false;
			mapServer.startMapServer(peer.session.map.voxeldata);
		});
	}
	
	//Get our ID
	peer.session.playerID = packet.data().readUInt8(1);
	
	peer.session.players[peer.session.playerID] = new OwnPlayer(peer.session.playerID);
	
	peer.session.getPlayer = function getPlayer() {
		return peer.session.players[peer.session.playerID];
	}
	
	console.log( "ID is " + (peer.session.getPlayer().id.toString()).bold );
	
	//Set our name
	peer.session.getPlayer().name = "MyFirstBot";
	
	///////////////
	//Get game data
	///////////////
	
	//Construct fog and team objects
	peer.session.game.fog = {
		b: packet.data().readUInt8(2),
		g: packet.data().readUInt8(3),
		r: packet.data().readUInt8(4)
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
	
	
},

//Intel funcs (link to game.js)
intelCap:          gameFuncs.intelCap,
intelPickup:       gameFuncs.intelPickup,
intelDropped:      gameFuncs.intelDropped,

//Player funcs (link to player.js)
createPlayer:      playerFuncs.createPlayer,
existingPlayer:    playerFuncs.existingPlayer,
shortPlayerData:   playerFuncs.shortPlayerData,
selfPosition:      playerFuncs.selfPosition,
playerPositions:   playerFuncs.playerPositions,
teamChange:        playerFuncs.teamChange,
weaponChange:      playerFuncs.weaponChange,
setTool:           playerFuncs.setTool,
setBlockColor:     playerFuncs.setBlockColor,
restock:           playerFuncs.restock,
killAction:        playerFuncs.killAction,
playerLeft:        playerFuncs.playerLeft,
setHealth:         playerFuncs.setHealth,
weaponInput:       playerFuncs.weaponInput,
inputData:         playerFuncs.inputData,
spawnGrenade:      playerFuncs.spawnGrenade,
weaponReload:      playerFuncs.weaponReload,

/**
  * Handle packet 13, which contains information about a block that has changed.
*/
blockAction: function blockAction(packet, players, map) {
	if(packet.data().readUInt8(0) !== 13) return; //Dunno why it's putting some packets in here.
	
	var player = players[packet.data().readUInt8(1)];
	var action = {
		type: packet.data().readUInt8(2), //0 = build, 1 = bullet, 2 = spade, 3 = grenade
		x: packet.data().readInt32LE(3),
		z: packet.data().readInt32LE(7),
		y: packet.data().readInt32LE(11)
	};
	
	if(action.type === 0)
		map.voxeldata[action.x][action.y][action.z] = [1, {b: player.color.b, g: player.color.g, r: player.color.r}];
	else
		map.voxeldata[action.x][action.y][action.z] = [0, {}];
},

/**
  * Handle packet 17, which is a chat message.
*/
chatMessage: function chatMessage(packet, players) {
	console.log(
		( packet.data().readUInt8(2) === 0 ? "<GLOBAL> ".bold.white 
		: packet.data().readUInt8(2) === 1 ? "<TEAM> ".bold.blue
		: packet.data().readUInt8(2) === 2 ? "<SYSTEM> ".bold.yellow
		: "<?>" )
		+ players[packet.data().readUInt8(1)].name
		+ "\t"
		+ ("(#" + packet.data().readUInt8(1) + "): ").bold
		+ iconv.decode(packet.data().slice(3), "cp437")
	);
},

fogColor: function fogColor(packet, session) {
	session.game.fog = {
		b: packet.data().readUInt8(1),
		g: packet.data().readUInt8(2),
		r: packet.data().readUInt8(3)
	};
},

blockLine: function blockLine(packet, players, map) {
	var player = players[packet.data().readUInt8(1)];
	var start = {
		x: packet.data().readInt32LE(2),
		z: packet.data().readInt32LE(6),
		y: packet.data().readInt32LE(10)
	};
	var end = {
		x: packet.data().readInt32LE(14),
		z: packet.data().readInt32LE(18),
		y: packet.data().readInt32LE(22)
	};
}
}

