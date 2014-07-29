var iconv	= require("iconv-lite");	//For converting our CP437 string to whatever encoding node uses
iconv.extendNodeEncodings();			//Now we can use Buffer.toString() with the encoding cp437.

/**
  * Get team data from packet 15.
*/
function getTeamData(game, packet) {
	game.team1 = {
		blue:	packet.data().readUInt8(5),
		green:	packet.data().readUInt8(6),
		red:	packet.data().readUInt8(7),
		name:	packet.data().toString("cp437", 11, 21)
	};
	
	game.team2 = {
		blue:	packet.data().readUInt8(8),
		green:	packet.data().readUInt8(9),
		red:	packet.data().readUInt8(10),
		name:	packet.data().toString("cp437", 22, 31)
	}
}

/**
  * Get data about CTF from packet 15, assuming that the gamemode is CTF.
*/
function getCTFData(game, packet) {
	game.state = {
		gamemode: packet.data().readUInt8(31),
		captureLimit: packet.data().readUInt8(34),
		intelFlags: packet.data().readUInt8(35),
			
		team1: {
			score: packet.data().readUInt8(32),
			
			//We need to check if the position data is just padding. If it is, then a player has the intel.
			intel: packet.data().readUInt8(37) === packet.data().readUInt8(38) && packet.data().readUInt8(38) === packet.data().readUInt8(39) ?
			{
				player: packet.data().readUInt8(36)
			} : //If not, then it's just xyz coordinates.
			{
				x: packet.data().readFloatLE(36),
				y: packet.data().readFloatLE(40),
				z: packet.data().readFloatLE(44)
			},
			
			base: {
				x: packet.data().readFloatLE(60),
				y: packet.data().readFloatLE(64),
				z: packet.data().readFloatLE(68)
			}
		},
				
		team2: {
			score: packet.data().readUInt8(33),
			
			intel: packet.data().readUInt8(49) === packet.data().readUInt8(50) && packet.data().readUInt8(50) === packet.data().readUInt8(51) ?
			{
				player: packet.data().readUInt8(48)
			} :
			{
				x: packet.data().readFloatLE(48),
				y: packet.data().readFloatLE(52),
				z: packet.data().readFloatLE(56)
			},
				
			base: {
				x: packet.data().readFloatLE(72),
				y: packet.data().readFloatLE(76),
				z: packet.data().readFloatLE(80)
			}
		}
	};
}

module.exports.getTeamData = getTeamData;
module.exports.getCTFData = getCTFData;