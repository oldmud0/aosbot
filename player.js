var iconv	= require("iconv-lite");	//For converting our CP437 string to whatever encoding node uses
iconv.extendNodeEncodings();			//Now we can use Buffer.toString() with the encoding cp437.
var colors 	= require("colors");		//Colors!
var merge	= require("merge");		//Merging two player objects together instead of overwriting them

/**
  * Handle packet 12, which indicates that a player joined (after we've joined). Sent as a response to packet 9.
*/
module.exports.createPlayer = function createPlayer(packet, players) {
	players[packet.data().readUInt8(1)] = merge(players[packet.data().readUInt8(1)], {
		weapon: packet.data().readUInt8(2),
		team: packet.data().readInt8(3),
		pos: {
			x: packet.data().readFloatLE(4),
			y: packet.data().readFloatLE(8),
			z: packet.data().readFloatLE(12)
		},
		name: packet.data().toString("cp437", 13, 29),
	});
	
	console.log(
	players[packet.data().readUInt8(1)].team === 0 ? players[packet.data().readUInt8(1)].name.blue.bold :
	players[packet.data().readUInt8(1)].team === 1 ? players[packet.data().readUInt8(1)].name.green.bold :
	players[packet.data().readUInt8(1)].name.bold
	+ " has joined the server.");
}

/**
  * Handle packet 9, which describes a single player's data. When we join, the server sends one packet 9 for each player currently online.
  * This packet is also sent to the server on join.
*/
module.exports.existingPlayer = function existingPlayer(packet, players) {
	players[packet.data().readUInt8(1)] = merge(players[packet.data().readUInt8(1)], {
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
		pos: {},
		orient: {}
	});
}

/**
  * Handle packet 10, which describes a player in short form. (???)
*/
module.exports.shortPlayerData = function shortPlayerData(packet, players) {
	var id = packet.data().readUInt8(1);
	
	players[id].team = packet.data().readInt8(2);
	players[id].weapon = packet.data().readUInt8(3);
}

/**
  * Handle packet 0, which returns our bot's position.
*/
module.exports.selfPosition = function selfPosition(packet, player) {
	player.pos = {
		x: packet.data().readFloatLE(1),
		y: packet.data().readFloatLE(5),
		z: packet.data().readFloatLE(9)
	};
}

/**
  * Handle packet 2, which carries an array of all players on the server and their orientations and positions.
*/
module.exports.playerPositions = function playerPositions(packet, players) {
	var offset = 1; //Offset increments by 24 bytes, the size of each player pos data part
	var id; //id indicates player number.
	
	for(id = 1; id <= 32; id++) {
		//If the id exists, process it. If not, nothing will happen.
		if(typeof players[id] != "undefined") {
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
}

/**
  * Handle packet 29, which announces when a player has changed team.
*/
module.exports.teamChange = function teamChange(packet, session) {
	var player = session.players[packet.data().readUInt8(1)];
	
	console.log( 
	((player.name)[player.team === 0 ? "blue" : "green"].bold)
	+ " joined "
	+ (packet.data().readInt8(2) === 0 ? session.game.team1.name : packet.data().readInt8(2) === 1 ? session.game.team2.name : "Spectator")
	);
	
	//Set player's team
	player.team = packet.data().readInt8(2);
}

/**
  * Handle packet 30, which announces when a player has changed weapon.
*/
module.exports.weaponChange = function weaponChange(packet, players) {
	players[packet.data().readUInt8(1)].weapon = packet.data().readUInt8(2);
}

/**
  * Handle packet 7, which sets a player's currently equipped tool.
*/
module.exports.setTool = function setTool(packet, players) {
	players[packet.data().readUInt8(1)].heldItem = packet.data().readInt8(2); //0 = spade, 1 = block, 2 = gun, 3 = grenade
}

/**
  * Handle packet 8, which sets a player's block color.
*/
module.exports.setBlockColor = function setBlockColor(packet, players) {
	var id = packet.data().readUInt8(1);
	
	players[id].color.b = packet.data().readUInt8(2);
	players[id].color.g = packet.data().readUInt8(3);
	players[id].color.r = packet.data().readUInt8(4);
}

/**
  * Handle packet 26, which announces that a player has restocked/resupplied.
  * Currently, we only care if the packet is directed towards the bot.
*/
module.exports.restock = function restock(packet, player) {
	if(packet.data().readUInt8(1) === player.id) {
		//TODO: uh, we don't have any weapon info.
	}
}

/**
  * Handle packet 16, which announces when a player has been slain.
  * Currently, we only care if the packet is directed towards the bot.
*/
module.exports.killAction = function killAction(packet, player, players) {
	if(packet.data().readUInt8(1) === player.id) {
		var weapon = (
		packet.data().readUInt8(3) === 0 && players[packet.data().readUInt8(2)].weapon === 0 ? "rifle" :
		packet.data().readUInt8(3) === 0 && players[packet.data().readUInt8(2)].weapon === 1 ? "SMG" :
		packet.data().readUInt8(3) === 0 && players[packet.data().readUInt8(2)].weapon === 2 ? "shotgun" :
		packet.data().readUInt8(3) === 1 ? "headshot" :
		packet.data().readUInt8(3) === 2 ? "spade" :
		packet.data().readUInt8(3) === 3 ? "grenade" :
		packet.data().readUInt8(3) === 4 ? "fall" :
		packet.data().readUInt8(3) === 5 ? "team change" :
		packet.data().readUInt8(3) === 6 ? "class change" :
		"anomaly"
		);

		console.log( player.name + " was killed by " + players[packet.data().readUInt8(2)].name + " with a " + weapon + ". Respawn in " + packet.data().readUInt8(4) + " seconds." );

		player.alive = false;

		//After the respawn time is depleted, we'll say that our bot is alive again
		setTimeout(function respawnPlayer() {
			player.alive = true;
		}, packet.data().readUInt8(4)*1000);
	}
}

/**
  * Handle packet 20, which announces when a player has left the server.
*/
module.exports.playerLeft = function playerLeft(packet, players) {
	console.log( 
	((players[packet.data().readUInt8(1)].name).white.bold)
	+ " left the server."
	);
	
	delete players[packet.data().readUInt8(1)]; //Delete vs null vs undefined? Who cares, they all just dereference.
}

/**
  * Handle packet 5, which changes the bot's health due to damage taken.
*/
module.exports.setHealth = function setHealth(packet, player) {
	player.hp = packet.readUInt8(1);
	if(packet.readUInt8(2) === 1) {
		//TODO: trigger something that will tell the bot that damage just occurred and tell the bot to pay attention to wherever it came from.
	}
}