//npm dependencies
var enet    = require('enet');        //Connecting to the server, obviously
var buf2hex = require("hex");         //Packet analysis
var colors  = require("colors");      //Colors!
var ansi    = require("ansi")         //Carriage return doesn't seem to work, so why not
   ,cursor  = ansi(process.stdout);
var zlib    = require("zlib");        //For inflating the map when we finish downloading it
var iconv   = require("iconv-lite");  //For converting our CP437 string to whatever encoding node uses
iconv.extendNodeEncodings();          //Now we can use Buffer.toString() with the encoding cp437.
var merge   = require("merge");       //Merging two player objects together instead of overwriting them

//Local files
var mapFuncs        = require("./map");
var gameFuncs       = require("./packets_game");
var packetHandling  = require("./packetHandling");

var id = 3855533061;
var port = 32887;

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
	client.start(17); //17ms intervals
	client.enableCompression(); //YES!! YES!!! COMPRESSION!!
	console.log("ENet client initialized.");
}

/**
  * Connect to server.
  * Previously we had to do this through a proxy generously donated by BR_, 
  * but now that the enet bindings support compression, we can connect directly.
*/
function connect(id, port) {
	//Convert our URL to an IP address
	var serverIP = [ id & 0xFF, (id >> 8) & 0xFF, (id >> 16) & 0xFF, (id >> 24) & 0xFF ].join('.');
	serverAddr = new enet.Address(serverIP, port);
	serverAddr.hostToString = function(){return [ serverAddr._host & 0xFF, (serverAddr._host >> 8) & 0xFF, (serverAddr._host >> 16) & 0xFF, (serverAddr._host >> 24) & 0xFF ].join('.');};
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
	global.peer = peer;
}

initClient();
connect(id, port);

peer.on("connect", function connectCallback() {
	//Connection success
	console.log("Connection established to " + serverAddr.hostToString() + " through port " + serverAddr.port());
	peer.ping();
	
	peer.session = {};
	peer.session.packetQueue = [];
});

var packetArgs = {
	NONE: 0,
	PACKET_PEER: 1,         //packet, peer
	PACKET_SESSION: 2,      //packet, peer.session
	PACKET_PLAYERS: 3,      //packet, peer.session.players
	PACKET_SELF: 4,         //packet, peer.session.getPlayer()
	PACKET_MAP: 5,          //packet, peer.session.map
	PACKET_SELF_PLAYERS: 6  //packet, peer.session.getPlayer(), peer.session.players
}

//Basically a jump table to clear up the big switch/case that we had earlier.
//function {} = no-op.
var packetList = {
	"18": [packetHandling.mapStart,     packetArgs.PACKET_PEER],     //Client join or map change
	"19": [packetHandling.mapData,      packetArgs.PACKET_PEER],     //Map data packet
	//Gamemode-related packets
	"15": [packetHandling.gamemodeData, packetArgs.PACKET_PEER],     //Gamemode data
	                                                                 //(We can also use it as a way to tell us when to
	                                                                 //stop downloading the map.)
	"23": [packetHandling.intelCap,     packetArgs.PACKET_SESSION],  //Intel capture
	"24": [packetHandling.intelPickup,  packetArgs.PACKET_SESSION],  //Intel pickup
	"25": [packetHandling.intelDropped, packetArgs.PACKET_SESSION],  //Intel dropped
	"21": [function() {return;},        packetArgs.NONE],            //Territory captured (nobody plays TC anymore :( )
	"22": [function() {return;},        packetArgs.NONE],            //Territory capture progress bar
	//Player-related packets

	//Create player (as response to the packet #9 that we sent).
	//Sent when a player joins after we've joined as opposed to packet #9 below.
	"12": [packetHandling.createPlayer,       packetArgs.PACKET_PLAYERS],
	"9":  [packetHandling.existingPlayer,     packetArgs.PACKET_PLAYERS],
	"10": [packetHandling.shortPlayerData,    packetArgs.PACKET_PLAYERS],
	"0":  [packetHandling.selfPosition,       packetArgs.PACKET_SELF],     //Our own position, sent back from the server
	"2":  [packetHandling.playerPositions,    packetArgs.PACKET_PLAYERS],
	"29": [packetHandling.teamChange,         packetArgs.PACKET_SESSION],
	"30": [packetHandling.weaponChange,       packetArgs.PACKET_PLAYERS],
	"7":  [packetHandling.setTool,            packetArgs.PACKET_PLAYERS],
	"8":  [packetHandling.setBlockColor,      packetArgs.PACKET_PLAYERS],
	"3":  [packetHandling.inputData,          packetArgs.PACKET_PLAYERS],  //Input data
	"4":  [packetHandling.weaponInput,        packetArgs.PACKET_PLAYERS],  //Weapon fire
	"28": [packetHandling.weaponReload,       packetArgs.PACKET_PLAYERS],  //Weapon reload
	"26": [packetHandling.restock,            packetArgs.PACKET_SELF],     //Restock. If it's us, resupply everything. If not, we don't really care.
	"27": [function() {return;},              packetArgs.NONE],            //Fog color
	"16": [packetHandling.killAction,         packetArgs.PACKET_SELF_PLAYERS], //For printing out killfeed.
	"20": [packetHandling.playerLeft,         packetArgs.PACKET_PLAYERS],
	"13": [packetHandling.blockAction,        packetArgs.PACKET_MAP],
	"14": [packetHandling.blockLine,          packetArgs.PACKET_MAP],      //Block line. We need the *exact* line algorithm for us to do this correctly. (PySnip code)
	"17": [packetHandling.chatMessage,        packetArgs.PACKET_PLAYERS],
	"5":  [packetHandling.setHealth,          packetArgs.PACKET_SELF],
	"6":  [packetHandling.spawnGrenade,       packetArgs.PACKET_MAP]
}

peer.on("message", function messageCallback(packet, channel) {
	packetID = packet.data().readUInt8(0);
	
	if(typeof peer.session.map !== "undefined") {
		//If the map is decompressing, throw the block action packets into a queue.
		if(peer.session.map.decompressing && packetID === 13) {
			//We have to copy the packet data since the packet object itself is bound by pointer to the callback.
			peer.session.packetQueue.push(new enet.Packet(packet.data()));
			return;
		}

		//If we just finished decompressing the map and the packet queue is not empty, let's run some recursion to handle each one.
		if(!peer.session.map.decompressing && peer.session.packetQueue.length !== 0) {
			var pop = peer.session.packetQueue.shift();
			messageCallback(pop, channel);
		}
	}
	
	//Use above jump table to handle packets by event.
	if(packetID in packetList) {
		var packetEvent = packetList[packetID];

		//Determine what arguments we're supposed to pass.
		//I mean we could just have every packet event have a uniform number of arguments but that would be tedious.
		switch(packetEvent[1]) {
			case packetArgs.NONE:
				packetEvent[0]();
				break;
			case packetArgs.PACKET_PEER:
				packetEvent[0](packet, peer);
				break;
			case packetArgs.PACKET_SESSION:
				packetEvent[0](packet, peer.session);
				break;
			case packetArgs.PACKET_PLAYERS:
				packetEvent[0](packet, peer.session.players);
				break;
			case packetArgs.PACKET_SELF:
				packetEvent[0](packet, peer.session.getPlayer());
				break;
			case packetArgs.PACKET_MAP:
				packetEvent[0](packet, peer.session.map);
				break;
			case packetArgs.PACKET_SELF_PLAYERS:
				packetEvent[0](packet, peer.session.getPlayer(), peer.session.players);
				break;
		}
	} else { //Any packets that we've missed?
		console.log("Incoming unknown packet "+ packet.data().readUInt8(0));
		buf2hex(packet.data());
	}
});

peer.on("disconnect", function disconnectCallback() {
	//Disconnected
	console.log("DISCONNECTED".bold.red.bgWhite);
	client.stop();
});

process.on('uncaughtException', function (error) {
   console.log(error.stack);
});

function botCompute() {
	if(typeof peer.session.getPlayer().pos !== "undefined" && peer.session.getPlayer().alive) {
		var inputBuffer = new Buffer(3);
		inputBuffer.writeUInt8(3,0); //ID is 3
		inputBuffer.writeUInt8(peer.session.getPlayer().id,1); //Player ID
		inputBuffer.writeUInt8(1,2); //Key 'up'
		
		var posBuffer = new Buffer(13);
		posBuffer.writeUInt8(0,0); //ID is 3
		posBuffer.writeFloatLE(peer.session.getPlayer().pos.x + 1,1); //X
		posBuffer.writeFloatLE(peer.session.getPlayer().pos.y,5); //Y
		posBuffer.writeFloatLE(peer.session.getPlayer().pos.z,9); //Z
		
		var done1 = false, done2 = false;
		
		peer.send(0, new enet.Packet(inputBuffer, enet.Packet.FLAG_RELIABLE), function(err) {
			if(err) console.error( ("ERROR: " + err).bold.yellow.redBG );
			done1 = true;
		});
		
		peer.send(0, new enet.Packet(posBuffer, enet.Packet.FLAG_RELIABLE), function(err) {
			if(err) console.error( ("ERROR: " + err).bold.yellow.redBG );
			done2 = true;
		});
		
		//Wait until both packets are done sending
		//while(!done1 && !done2) {}
	}
}