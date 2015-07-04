var iconv   = require("iconv-lite");      //For converting our CP437 string to whatever encoding node uses
iconv.extendNodeEncodings();              //Now we can use Buffer.toString() with the encoding cp437.
var colors  = require("colors");          //Colors!

var Player  = require("./player").Player;

module.exports = {
/**
  * Handle packet 12, which indicates that a player joined (after we've joined). Sent as a response to packet 9.
*/
createPlayer: function createPlayer(packet, players) {
	var id = packet.data().readUInt8(1), justJoined = false, player;
	
	//You have to differentiate between whether createPlayer is being used
	//for spawning or for joining.
	if(!players[id].inUse) {
		players[id] = new Player(id);
		player      = players[id];
		justJoined  = true;
		player.name = packet.data().toString("cp437", 16).trim();
	}
	
	//Applies to both spawning and joining
	player = players[id];
	player.weapon = packet.data().readUInt8(2);
	player.team   = packet.data().readInt8(3);
	
	/*
	 * All right, since there's not really anywhere to write this I'll write it here.
	 * Do not try to "compress" the structure declaration by using object notation.
	 * The reason for this is that it will create a new structure instead of changing only what's in it,
	 * causing the old data to be dereferenced. This means that any monitor that has a reference to player.pos will stop working when pos
	 * is updated via object notation.
	 * So don't go the lazy route and it'll fix problems in the future :)
	*/
	player.pos.x  = packet.data().readFloatLE(4);
	player.pos.y  = packet.data().readFloatLE(8);
	player.pos.z  = packet.data().readFloatLE(12);
	
	player.alive = true;
	player.respawnTime = 0;
	
	if(justJoined) {
		console.log(
		(player.team === 0 ? player.name.blue.bold :
		player.team === 1 ? player.name.green.bold :
		player.name.bold)
		+ " has joined the server.");
	}
},

/**
  * Handle packet 9, which describes a single player's data. When we join, the server sends one packet 9 for each player currently online.
  * This packet is also sent to the server on join.
*/
existingPlayer: function existingPlayer(packet, players) {
	var id = packet.data().readUInt8(1);
	if(typeof players[id] === "undefined" || !players[id].inUse)
		players[id] = new Player(id);
	var player = players[id];
	
	player.team     = packet.data().readInt8(2);
	player.weapon   = packet.data().readUInt8(3);
	player.heldItem = packet.data().readUInt8(4);
	player.kills    = packet.data().readUInt32LE(5);
	player.color.b  = packet.data().readUInt8(9);
	player.color.g  = packet.data().readUInt8(10);
	player.color.r  = packet.data().readUInt8(11);
	
	player.name     = packet.data().toString("cp437", 12).trim();
},

/**
  * Handle packet 10, which describes a player in short form. (???)
*/
shortPlayerData: function shortPlayerData(packet, players) {
	var id = packet.data().readUInt8(1);
	
	players[id].team   = packet.data().readInt8(2);
	players[id].weapon = packet.data().readUInt8(3);
},

/**
  * Handle packet 0, which returns our bot's position.
*/
selfPosition: function selfPosition(packet, player) {
	player.pos.x = packet.data().readFloatLE(1);
	player.pos.y = packet.data().readFloatLE(5);
	player.pos.z = packet.data().readFloatLE(9);
},

/**
  * Handle packet 2, which carries an array of all players on the server and their orientations and positions.
  * 0.76 does a lot nicer job in doing this, but right now we are only working with 0.75 data.
*/
playerPositions: function playerPositions(packet, players) {
	var offset = 1; //Offset increments by 24 bytes, the size of each player pos data part
	var id; //id indicates player number.
	
	for(id = 0; id <= 31; id++) {
		//If the id exists, process it. If not, nothing will happen.
		if(typeof players[id] !== "undefined") {
			//Position data
			players[id].pos.x = packet.data().readFloatLE(offset + 0);
			players[id].pos.y = packet.data().readFloatLE(offset + 4);
			players[id].pos.z = packet.data().readFloatLE(offset + 8);
			
			//Orientation data
			players[id].orient.x = packet.data().readFloatLE(offset + 12);
			players[id].orient.y = packet.data().readFloatLE(offset + 16);
			players[id].orient.z = packet.data().readFloatLE(offset + 20);
		}
		offset += 24;
	}
},

/**
  * Handle packet 29, which announces when a player has changed team.
*/
teamChange: function teamChange(packet, session) {
	var player = session.players[packet.data().readUInt8(1)];
	
	console.log( 
	((player.name)[player.team === 0 ? "blue" : "green"].bold)
	+ " joined "
	+ (packet.data().readInt8(2) === 0 ? session.game.team1.name : packet.data().readInt8(2) === 1 ? session.game.team2.name : "Spectator")
	);
	
	//Set player's team
	player.team = packet.data().readInt8(2);
},

/**
  * Handle packet 30, which announces when a player has changed weapon.
*/
weaponChange: function weaponChange(packet, players) {
	players[packet.data().readUInt8(1)].weapon = packet.data().readUInt8(2);
},

/**
  * Handle packet 7, which sets a player's currently equipped tool.
*/
setTool: function setTool(packet, players) {
	players[packet.data().readUInt8(1)].heldItem = packet.data().readInt8(2); //0 = spade, 1 = block, 2 = gun, 3 = grenade
},

/**
  * Handle packet 8, which sets a player's block color.
*/
setBlockColor: function setBlockColor(packet, players) {
	var id = packet.data().readUInt8(1);
	
	players[id].color.b = packet.data().readUInt8(2);
	players[id].color.g = packet.data().readUInt8(3);
	players[id].color.r = packet.data().readUInt8(4);
},

/**
  * Handle packet 26, which announces that a player has restocked/resupplied.
  * Currently, we only care if the packet is directed towards the bot.
*/
restock: function restock(packet, player) {
	if(packet.data().readUInt8(1) === player.id) {
		//TODO: uh, we don't have any weapon info.
	}
},

/**
  * Handle packet 16, which announces when a player has been slain.
*/
killAction: function killAction(packet, player, players) {
	var cause = packet.data().readUInt8(3),
	victim = players[packet.data().readUInt8(1)], killer = players[packet.data().readUInt8(2)], time = packet.data().readUInt8(4);
	
	
	if(cause < 4) {
		var weapon = (
			cause === 0 && killer.weapon === 0 ? "Rifle" :
			cause === 0 && killer.weapon === 1 ? "SMG" :
			cause === 0 && killer.weapon === 2 ? "Shotgun" :
			cause === 1 ? "Headshot" :
			cause === 2 ? "Spade" :
			cause === 3 ? "Grenade" :
			"Block" //:P
		);
		console.log( (killer.name + " killed " + victim.name + " ("+weapon+")")[killer.team === 0 ? "blue" : "green"].bold );
	}
	if(cause === 4)
		console.log( victim.name + " fell too far");
	if(cause === 5)
		console.log( victim.name + " changed teams");
	if(cause === 6)
		console.log( victim.name + " changed weapons");
	
	victim.alive = false;
	victim.respawnTime = time;
	killer.kills++;

	//Decrement respawn timer every second
	setTimeout(function respawnTimer(ply) {
		ply.respawnTime--;
		if(ply.alive || ply.respawnTime <= 0) {
			ply.alive = true;
			ply.respawnTime = 0;
		} else 
			setTimeout(respawnTimer, 1000, ply);
	}, 1000, victim);
},

/**
  * Handle packet 20, which announces when a player has left the server.
*/
playerLeft: function playerLeft(packet, players) {
	console.log( 
	((players[packet.data().readUInt8(1)].name).white.bold)
	+ " left the server."
	);
	
	//We should not set to undefined because there may be packets left that are dependent on this player
	//e.g. grenades, death
	players[packet.data().readUInt8(1)].inUse = false;
},

/**
  * Handle packet 5, which changes the bot's health due to damage taken.
*/
setHealth: function setHealth(packet, player) {
	player.hp = packet.data().readUInt8(1);
	if(packet.data().readUInt8(2) === 1) {
		//TODO Play hit sound, show where it came from
	} else {
		//TODO Play fall damage sound
	}
},

weaponInput: function weaponInput(packet, players) {
	var player = players[packet.data().readUInt8(1)];
	var type   = packet.data().readUInt8(2);
	player.keyStates.primary   = type & 1;        //AND 00000001 (base 2) to get the first bit only
	player.keyStates.secondary = (type & 2) >> 1; //AND 00000010 to get the second bit and shift it over
},

inputData: function inputData(packet, players) {
	var player    = players[packet.data().readUInt8(1)];
	var type = packet.data().readUInt8(2);
	
	player.keyStates.up      = (type & 1)   >> 0; //Similar to weaponInput.
	player.keyStates.down    = (type & 2)   >> 1;
	player.keyStates.left    = (type & 4)   >> 2;
	player.keyStates.right   = (type & 8)   >> 3;
	player.keyStates.jump    = (type & 16)  >> 4;
	player.keyStates.crouch  = (type & 32)  >> 5;
	player.keyStates.sneak   = (type & 64)  >> 6;
	player.keyStates.sprint  = (type & 128) >> 7;
},

spawnGrenade: function spawnGrenade(packet, map) {
	var grenade = new Grenade();
	grenade.playerId   = packet.data().readUInt8(1);
	grenade.fuseLength = packet.data().readFloatLE(2);
	
	grenade.pos.x      = packet.data().readFloatLE(6);
	grenade.pos.z      = packet.data().readFloatLE(10);
	grenade.pos.y      = packet.data().readFloatLE(14);
	
	grenade.vel.x      = packet.data().readFloatLE(18);
	grenade.vel.z      = packet.data().readFloatLE(22);
	grenade.vel.y      = packet.data().readFloatLE(26);
},

weaponReload: function weaponReload(packet, players) {
	//TODO play reload sound
}
}