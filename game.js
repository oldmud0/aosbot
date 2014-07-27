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

module.exports.getTeamData = getTeamData;