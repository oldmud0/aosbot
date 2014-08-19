//npm dependencies
var enet 	= require('enet');		//Connecting to the server, obviously
var buf2hex 	= require("hex");		//Packet analysis
var colors 	= require("colors");		//Colors!
var ansi	= require("ansi")		//Carriage return doesn't seem to work, so why not
   ,cursor	= ansi(process.stdout);
var zlib	= require("zlib");		//For inflating the map when we finish downloading it
var iconv	= require("iconv-lite");	//For converting our CP437 string to whatever encoding node uses
iconv.extendNodeEncodings();			//Now we can use Buffer.toString() with the encoding cp437.
var merge	= require("merge");		//Merging two player objects together instead of overwriting them

//Local files
var mapFuncs	= require("./map");
var gameFuncs	= require("./game");
var packetHandling	= require("./packetHandling");

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

peer.on("message", function messageCallback(packet, channel) {
	packetID = packet.data().readUInt8(0);
	
	//Event based package handling (terrible)
	switch(packetID) {
		case 18: //Client join or map change
			packetHandling.mapStart(packet, peer);
			break;
		
		case 19: //Map data packet
			packetHandling.mapData(packet, peer);
			break;
			
		//////////////////////////
		//Gamemode-related packets
		//////////////////////////
		//{
		
		case 15: //Gamemode data
			//We can also use it as a way to tell us when to stop downloading the map.
			packetHandling.gamemodeData(packet, peer);
			break;
		
		case 23: //Intel capture
			packetHandling.intelCap(packet, peer.session);
			break;
		
		case 24: //Intel pickup
			packetHandling.intelPickup(packet, peer.session);
			break;
		
		case 25: //Intel dropped
			packetHandling.intelDropped(packet, peer.session);
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
			packetHandling.createPlayer(packet, peer.session.players);
			break;
		
		case 9: //Existing player. Sent when we join while there are players online.
			packetHandling.existingPlayer(packet, peer.session.players);
			break;
		
		case 10: //Short player data. Used when player switches teams or weapon.
			packetHandling.shortPlayerData(packet, peer.session.players);
			break;
			
		case 0: //Our own position, sent back from the server
			packetHandling.selfPosition(packet, peer.session.getPlayer());
			break;
		
		case 2: //Player positions. 0.76 does a lot nicer job in doing this, but right now we are only working with 0.75 data.
			packetHandling.playerPositions(packet, peer.session.players);
			break;
		
		case 29: //Change team
			packetHandling.teamChange(packet, peer.session);
			break;
			
		case 30: //Change weapon
			packetHandling.weaponChange(packet, peer.session.players);
			break;
		
		case 7: //Set player's currently equipped tool
			packetHandling.setTool(packet, peer.session.players);
			break;
		
		case 8: //Set player's block color
			packetHandling.setBlockColor(packet, peer.session.players);
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
			packetHandling.restock(packet, peer.session.getPlayer());
			break;
		
		case 27: //Fog color
			//We don't really care about fog
			//no-op
			break;
			
		case 16: //Kill action
			//If it was our bot, print it out. If not, don't do anything.
			packetHandling.killAction(packet, peer.session.getPlayer(), peer.session.players);
			break;
		
		case 20: //Player leaves
			packetHandling.playerLeft(packet, peer.session.players);
			break;
			
		//}
		
		case 13: //Block action
			packetHandling.blockAction(packet, peer.session.map);
			break;
		
		case 14: //Block line
			//TODO: steal algorithm from secret facility
			break;
		
		case 17: //Chat message
			packetHandling.chatMessage(packet, peer.session.players);
			break;
		
		case 5: //Set health
			packetHandling.setHealth(packet, peer.session.player);
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

function botCompute() {
	if(typeof peer.session.getPlayer().pos != "undefined" && peer.session.getPlayer().alive) {
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