module.exports.Player = Player;
module.exports.OwnPlayer = OwnPlayer;

/**
  * The Player object safely encases a multitude of properties related to the
  * identity of a single player.
*/
function Player(id) {
	this.id        = id;
	this.name      = ""; //~12 characters, cp437
	this.team      = 0; //0 = blue, 1 = green, 2 = spec
	this.weapon    = 0; //Denotes which gun the player has equipped. (0 = rifle, 1 = smg, 2 = shotgun)
	this.heldItem  = 0; //Denotes which tool the player is holding right now. (0 = spade, 1 = block, 2 = gun, 3 = grenade)
	this.ammo      = 0;
	this.keyStates = {
		forward: 0, back: 0, left: 0, right: 0,
		crouch: 0, jump: 0, sneak: 0, sprint: 0,
		primary: 0, secondary: 0
	};
	this.color     = {b: 0, g: 0, r: 0};
	               
	this.pos       = {x: 0, y: 0, z: 0};
	this.oldPos    = {x: 0, y: 0, z: 0};
	this.newPosTime = Date.now();
	this.oldPosTime = this.newPosTime;
	this.orient    = {x: 0, y: 0, z: 0};
	this.oldOrient = {x: 0, y: 0, z: 0};
	this.newOrientTime = Date.now();
	this.oldOrientTime = this.newPosTime;
	
	this.kills     = 0;
	//this.deaths    = 0;
	
	this.alive     = true;
	this.respawnTime = 0;
	this.inUse     = true; //No longer in use when player leaves.
}

Player.prototype.getX = function getX() {
	var posDeltaT = this.newPosTime - this.oldPosTime;
	if(Date.now() > posDeltaT + this.newPosTime) return this.pos.x;
	
	var scale = (this.pos.x - this.oldPos.x) / posDeltaT;
	var position = (Date.now() - this.newPosTime) * scale;
	return position + this.oldPos.x;
}

Player.prototype.getY = function getY() {
	var posDeltaT = this.newPosTime - this.oldPosTime;
	if(Date.now() > posDeltaT + this.newPosTime) return this.pos.y;
	
	var scale = (this.pos.y - this.oldPos.y) / posDeltaT;
	var position = (Date.now() - this.newPosTime) * scale;
	return position + this.oldPos.y;
}

Player.prototype.getZ = function getZ() {
	var posDeltaT = this.newPosTime - this.oldPosTime;
	if(Date.now() > posDeltaT + this.newPosTime) return this.pos.z;
	
	var scale = (this.pos.z - this.oldPos.z) / posDeltaT;
	var position = (Date.now() - this.newPosTime) * scale;
	return position + this.oldPos.z;
}

Player.prototype.getAngX = function getAngX() {return this.orient.x;}
Player.prototype.getAngY = function getAngY() {return this.orient.y;}
Player.prototype.getAngZ = function getAngZ() {return this.orient.z;}

Player.prototype.isMoving = function isMoving() {
	//Stupid FPM.
	if(Math.abs(this.pos.x - this.oldPos.x).toFixed(10) > 0. || Math.abs(this.pos.z - this.oldPos.z).toFixed(10) > 0.) {
		//TODO play sound for walking
		return true;
	}
	return false;
}

function OwnPlayer(id) {
	var ply = new Player(id);
	ply.hp          = 0;
	
	//We can use -1 to determine when to prompt for choosing teams.
	ply.team        = -1;
	
	ply.clipAmmo    = 0;
	ply.reserveAmmo = 0;
	
	ply.lastDamageSource = {x: 0, y: 0, z: 0};
	return ply;
}